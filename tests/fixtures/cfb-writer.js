"use strict";
// كاتب OLE2/CFB مصغّر للاختبارات فقط: يبني ملفات مركّبة صناعية (إصدار 3 بقطاعات 512 أو إصدار 4 بقطاعات 4096)
// لاختبار ole.js في حالات لا تنتجها msoffcrypto: القطاعات 4096، سلسلة DIFAT الإضافية، والملفات التالفة.
//
// buildCfb({ version, entries, minFatSectors, sizeHighGarbage })
//   entries: [{ name, data: Uint8Array } | { name, children: [...] }] — أبناء الجذر
//   minFatSectors: يفرض عددًا أدنى من قطاعات FAT (أكثر من 109 ← يلزم قطاع DIFAT إضافي)
//   sizeHighGarbage: يكتب قيمة غير صفرية في الـ 32 بت العليا لحجم التيار (يجب تجاهلها في الإصدار 3)
// يعيد { bytes, sectorSize, fatSectors, streamStart: { "path": sector }, setFat(sector, value) }

const MAXREGSECT = 0xfffffffa, DIFSECT = 0xfffffffc, FATSECT = 0xfffffffd, ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;
const MINI_CUTOFF = 4096, MINI_SIZE = 64;

// ترتيب CFB للأسماء: الأقصر أولًا، ثم مقارنة الأحرف الكبيرة
function cfbCompare(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  const A = a.toUpperCase(), B = b.toUpperCase();
  return A < B ? -1 : A > B ? 1 : 0;
}

function buildCfb(opts) {
  const version = opts.version || 3;
  const ss = version === 4 ? 4096 : 512;
  const perSector = ss / 4;

  // 1) تسطيح الشجرة إلى مدخلات دليل (الجذر = 0)
  const dir = [{ name: "Root Entry", type: 5, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, start: ENDOFCHAIN, size: 0 }];
  const streams = []; // { idx, path, data }
  function addChildren(parentIdx, children, prefix) {
    const idxs = children.map((c) => {
      const e = { name: c.name, type: c.children ? 1 : 2, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, start: ENDOFCHAIN, size: 0 };
      dir.push(e);
      const idx = dir.length - 1;
      if (c.children) addChildren(idx, c.children, prefix + c.name + "/");
      else streams.push({ idx, path: prefix + c.name, data: c.data });
      return idx;
    });
    // شجرة ثنائية متوازنة من الإخوة مرتبة بترتيب CFB
    idxs.sort((x, y) => cfbCompare(dir[x].name, dir[y].name));
    const balance = (lo, hi) => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >> 1;
      dir[idxs[mid]].left = balance(lo, mid - 1);
      dir[idxs[mid]].right = balance(mid + 1, hi);
      return idxs[mid];
    };
    dir[parentIdx].child = balance(0, idxs.length - 1);
  }
  addChildren(0, opts.entries || [], "");

  // 2) توزيع القطاعات: الدليل، ثم التيارات الكبيرة، ثم التيار المصغّر وجدوله؛ FAT وDIFAT في النهاية
  const fat = [];
  const sectors = []; // محتوى كل قطاع (Uint8Array بطول ss)
  function allocChain(data) {
    const n = Math.ceil(data.length / ss);
    if (n === 0) return ENDOFCHAIN;
    const start = sectors.length;
    for (let i = 0; i < n; i++) {
      const s = new Uint8Array(ss);
      s.set(data.subarray(i * ss, Math.min((i + 1) * ss, data.length)));
      sectors.push(s);
      fat.push(i === n - 1 ? ENDOFCHAIN : start + i + 1);
    }
    return start;
  }

  const miniFat = [];
  const miniParts = [];
  let miniLen = 0;
  const streamStart = {};
  streams.forEach((st) => {
    const e = dir[st.idx];
    e.size = st.data.length;
    if (st.data.length === 0) { e.start = ENDOFCHAIN; }
    else if (st.data.length < MINI_CUTOFF) {
      const n = Math.ceil(st.data.length / MINI_SIZE);
      const start = miniLen / MINI_SIZE;
      for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? ENDOFCHAIN : start + i + 1);
      const padded = new Uint8Array(n * MINI_SIZE);
      padded.set(st.data);
      miniParts.push(padded);
      miniLen += padded.length;
      e.start = start;
    }
    streamStart[st.path] = e.start;
  });
  // التيارات الكبيرة تُخصَّص بعد معرفة الصغيرة (ترتيب القطاعات لا يهم القارئ)
  streams.forEach((st) => {
    if (st.data.length >= MINI_CUTOFF) {
      dir[st.idx].start = allocChain(st.data);
      streamStart[st.path] = dir[st.idx].start;
    }
  });
  if (miniLen > 0) {
    const mini = new Uint8Array(miniLen);
    let p = 0;
    miniParts.forEach((m) => { mini.set(m, p); p += m.length; });
    dir[0].start = allocChain(mini);
    dir[0].size = miniLen;
  }
  let firstMiniFat = ENDOFCHAIN, numMiniFat = 0;
  if (miniFat.length) {
    const mf = new Uint8Array(Math.ceil((miniFat.length * 4) / ss) * ss).fill(0xff);
    const dv = new DataView(mf.buffer);
    miniFat.forEach((v, i) => dv.setUint32(i * 4, v, true));
    firstMiniFat = allocChain(mf);
    numMiniFat = mf.length / ss;
  }

  // الدليل
  const perDirSector = ss / 128;
  const dirBytes = new Uint8Array(Math.ceil(dir.length / perDirSector) * ss);
  const ddv = new DataView(dirBytes.buffer);
  for (let i = 0; i < dirBytes.length / 128; i++) {
    const o = i * 128;
    const e = dir[i];
    ddv.setUint32(o + 68, NOSTREAM, true);
    ddv.setUint32(o + 72, NOSTREAM, true);
    ddv.setUint32(o + 76, NOSTREAM, true);
    if (!e) continue;
    for (let c = 0; c < e.name.length; c++) ddv.setUint16(o + c * 2, e.name.charCodeAt(c), true);
    ddv.setUint16(o + 64, (e.name.length + 1) * 2, true);
    dirBytes[o + 66] = e.type;
    dirBytes[o + 67] = 1; // أسود
    ddv.setUint32(o + 68, e.left, true);
    ddv.setUint32(o + 72, e.right, true);
    ddv.setUint32(o + 76, e.child, true);
    ddv.setUint32(o + 116, e.start, true);
    ddv.setUint32(o + 120, e.size, true);
    ddv.setUint32(o + 124, opts.sizeHighGarbage && e.type === 2 ? 0xdeadbeef : 0, true);
  }
  const firstDir = allocChain(dirBytes);
  const numDirSectors = dirBytes.length / ss;

  // عدد قطاعات FAT وDIFAT حتى يستقر (كل منهما يحتاج مدخلًا في FAT)
  const used = sectors.length;
  let nFat = 1, nDifat = 0;
  for (;;) {
    const needFat = Math.max(opts.minFatSectors || 0, Math.ceil((used + nFat + nDifat) / perSector));
    const needDifat = needFat > 109 ? Math.ceil((needFat - 109) / (perSector - 1)) : 0;
    if (needFat === nFat && needDifat === nDifat) break;
    nFat = needFat; nDifat = needDifat;
  }
  const fatSectors = [];
  for (let i = 0; i < nFat; i++) { fatSectors.push(used + i); fat.push(FATSECT); }
  const difatSectors = [];
  for (let i = 0; i < nDifat; i++) { difatSectors.push(used + nFat + i); fat.push(DIFSECT); }
  while (fat.length < nFat * perSector) fat.push(FREESECT);

  const total = used + nFat + nDifat;
  const out = new Uint8Array(ss * (total + 1));
  const dv = new DataView(out.buffer);
  // الرأس
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((v, i) => { out[i] = v; });
  dv.setUint16(24, 0x3e, true);
  dv.setUint16(26, version, true);
  dv.setUint16(28, 0xfffe, true);
  dv.setUint16(30, version === 4 ? 12 : 9, true);
  dv.setUint16(32, 6, true);
  dv.setUint32(40, version === 4 ? numDirSectors : 0, true);
  dv.setUint32(44, nFat, true);
  dv.setUint32(48, firstDir, true);
  dv.setUint32(56, MINI_CUTOFF, true);
  dv.setUint32(60, firstMiniFat, true);
  dv.setUint32(64, numMiniFat, true);
  dv.setUint32(68, nDifat ? difatSectors[0] : ENDOFCHAIN, true);
  dv.setUint32(72, nDifat, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i < nFat ? fatSectors[i] : FREESECT, true);
  // القطاعات
  sectors.forEach((s, i) => out.set(s, (i + 1) * ss));
  fatSectors.forEach((loc, k) => {
    for (let i = 0; i < perSector; i++) dv.setUint32((loc + 1) * ss + i * 4, fat[k * perSector + i], true);
  });
  let rest = fatSectors.slice(109);
  difatSectors.forEach((loc, k) => {
    const base = (loc + 1) * ss;
    for (let i = 0; i < perSector - 1; i++) dv.setUint32(base + i * 4, i < rest.length ? rest[i] : FREESECT, true);
    rest = rest.slice(perSector - 1);
    dv.setUint32(base + ss - 4, k + 1 < difatSectors.length ? difatSectors[k + 1] : ENDOFCHAIN, true);
  });

  function setFat(sector, value) {
    const loc = fatSectors[Math.floor(sector / perSector)];
    dv.setUint32((loc + 1) * ss + (sector % perSector) * 4, value, true);
  }
  return { bytes: out, sectorSize: ss, fatSectors, difatSectors, firstDir, streamStart, setFat };
}

module.exports = { buildCfb, MAXREGSECT, DIFSECT, FATSECT, ENDOFCHAIN, FREESECT, NOSTREAM };

"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core.xlsx = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { xlsxError, parseZipEntries } = require("./zip.js");
const { hasPrecisionLoss } = require("./text.js");

/* =====================================================================
 * قارئ ملفات Excel (.xlsx / .xlsm) — بلا أي تبعيات أو طلبات خارجية.
 * قارئ ZIP (STORE + DEFLATE عبر DecompressionStream المدمج) ثم تحليل XML.
 * كل الدوال نقيّة وقابلة للاختبار في Node (DecompressionStream عام في Node ≥18).
 * ===================================================================== */

/* ---------- مساعدات XML خفيفة (بلا مكتبات) ---------- */

// فكّ ترميز كيانات XML (& < > " ' والكيانات الرقمية العشرية والست عشرية)
function decodeXml(s) {
  if (s == null) return "";
  return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
    switch (e) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return "\"";
      case "apos": return "'";
    }
    const code = (e[1] === "x" || e[1] === "X") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return isNaN(code) ? m : String.fromCodePoint(code);
  });
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// قيمة سمة من نص سمات وسم (يدعم علامتَي الاقتباس المفردة والمزدوجة)
function getAttr(attrStr, name) {
  if (attrStr == null) return null;
  const re = new RegExp("(?:^|\\s)" + escapeRe(name) + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1");
  const m = re.exec(attrStr);
  return m ? m[2] : null;
}

// المحتوى الداخلي لأول وسم <tag ...>...</tag> (أو "" لوسم ذاتي الإغلاق، أو null إن لم يوجد)
function extractTag(xml, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*?(?:/>|>([\\s\\S]*?)</" + tag + ">)");
  const m = re.exec(xml);
  if (!m) return null;
  return m[1] == null ? "" : m[1];
}

// دمج نصوص كل عناصر <t> داخل مقطع (سلسلة مشتركة أو inlineStr مع تشغيلات النص الغني <r>)
function concatText(xml) {
  let out = "";
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m;
  while ((m = re.exec(xml))) out += m[1] == null ? "" : decodeXml(m[1]);
  return out;
}

/* ---------- تحليل أجزاء المصنّف ---------- */

// xl/sharedStrings.xml → مصفوفة سلاسل (كل <si> قد يحوي <t> أو عدة <r><t>)
function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] == null ? "" : concatText(m[1]));
  return out;
}

// xl/workbook.xml → [{ name, rid }] بترتيب الأوراق
function parseWorkbookSheets(xml) {
  const sheets = [];
  const re = /<sheet\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const name = decodeXml(getAttr(attrs, "name") || "");
    const rid = getAttr(attrs, "r:id") || getAttr(attrs, "id") || getAttr(attrs, "relationshipId");
    sheets.push({ name, rid });
  }
  return sheets;
}

// xl/_rels/workbook.xml.rels → { rId: target }
function parseRels(xml) {
  const map = {};
  const re = /<Relationship\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const id = getAttr(attrs, "Id");
    const target = getAttr(attrs, "Target");
    if (id && target) map[id] = decodeXml(target);
  }
  return map;
}

// xl/styles.xml → { cellXfs: [numFmtId...], numFmts: { id: formatCode } }
function parseStyles(xml) {
  const numFmts = {};
  const nfBlock = extractTag(xml, "numFmts");
  if (nfBlock) {
    const re = /<numFmt\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(nfBlock))) {
      const id = parseInt(getAttr(m[1], "numFmtId"), 10);
      const code = decodeXml(getAttr(m[1], "formatCode") || "");
      if (!isNaN(id)) numFmts[id] = code;
    }
  }
  const cellXfs = [];
  const xfBlock = extractTag(xml, "cellXfs");
  if (xfBlock) {
    const re = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
    let m;
    while ((m = re.exec(xfBlock))) {
      const id = parseInt(getAttr(m[1], "numFmtId"), 10);
      cellXfs.push(isNaN(id) ? 0 : id);
    }
  }
  return { cellXfs, numFmts };
}

/* ---------- المراجع والتواريخ ---------- */

// حرف عمود إلى فهرس صفري: A→0، Z→25، AA→26 (يتجاهل رقم الصف مثل "C5")
function colRefToIndex(ref) {
  let n = 0;
  const s = String(ref);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch >= 65 && ch <= 90) n = n * 26 + (ch - 64);
    else if (ch >= 97 && ch <= 122) n = n * 26 + (ch - 96);
    else break;
  }
  return n - 1;
}

// تصنيف نوع التنسيق الرقمي إلى تاريخ/وقت: "date" | "datetime" | "time" | null
function classifyNumFmt(id, code) {
  if (id === 14 || id === 15 || id === 16 || id === 17) return "date";
  if (id === 18 || id === 19 || id === 20 || id === 21 || id === 45 || id === 46 || id === 47) return "time";
  if (id === 22) return "datetime";
  if (id != null && id >= 0 && id <= 13) return null; // أرقام/عملة/نِسَب مبنية مسبقًا
  if (id === 49) return null; // نص
  if (!code) return null;
  // خذ المقطع الأول وأزل الحرفيات والأقواس (مع إبقاء علامات الوقت المنقضي [h] [m] [s])
  let c = String(code).split(";")[0];
  c = c.replace(/\\./g, "").replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, function (mm) {
    return /^\[[hms]+\]$/i.test(mm) ? mm.replace(/[\[\]]/g, "") : "";
  });
  const hasY = /y/i.test(c);
  const hasD = /d/i.test(c);
  const hasH = /h/i.test(c);
  const hasS = /s/i.test(c);
  const hasM = /m/i.test(c);
  const dateComp = hasY || hasD || (hasM && !hasH && !hasS);
  const timeComp = hasH || hasS;
  if (dateComp && timeComp) return "datetime";
  if (dateComp) return "date";
  if (timeComp) return "time";
  return null;
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

// تحويل الرقم التسلسلي لتاريخ Excel إلى نص. kind: "date" | "datetime" | "time".
// يعالج نظام 1900 (المسار الطبيعي للأرقام ≥ 61) ونظام 1904 (date1904).
function excelSerialToText(serial, kind, date1904) {
  const s = Number(serial);
  if (!isFinite(s)) return String(serial);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(s * 86400) * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const MM = pad2(d.getUTCMonth() + 1);
  const DD = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  if (kind === "time") return hh + ":" + mm + ":" + ss;
  if (kind === "datetime") return yyyy + "-" + MM + "-" + DD + " " + hh + ":" + mm + ":" + ss;
  return yyyy + "-" + MM + "-" + DD;
}

/* ---------- تحليل الأوراق ---------- */

// قيمة خلية واحدة كنص، حسب نوعها (t) وتنسيقها (للتواريخ).
// flag اختياري: يُستدعى بـ "date" لخلية رقمية حُوّلت إلى تاريخ، وبـ "lossy" لخلية رقمية فقدت دقتها.
function cellValue(t, content, sst, sAttr, styleFmts, date1904, flag) {
  if (t === "s") {
    const idx = parseInt(extractTag(content, "v") || "", 10);
    return (sst && sst[idx] != null) ? sst[idx] : "";
  }
  if (t === "inlineStr") {
    const is = extractTag(content, "is");
    return is != null ? concatText(is) : "";
  }
  if (t === "str") return decodeXml(extractTag(content, "v") || "");
  if (t === "b") return ((extractTag(content, "v") || "").trim() === "1") ? "TRUE" : "FALSE";
  if (t === "e") return ""; // خلية خطأ → فراغ
  // رقمي (t === "n" أو غير محدد) — قد يكون تاريخًا حسب التنسيق
  const raw = extractTag(content, "v");
  if (raw == null || raw === "") return "";
  const num = decodeXml(raw).trim();
  if (sAttr != null && styleFmts && styleFmts.cellXfs) {
    const numFmtId = styleFmts.cellXfs[parseInt(sAttr, 10)];
    if (numFmtId != null) {
      const kind = classifyNumFmt(numFmtId, styleFmts.numFmts[numFmtId]);
      if (kind) {
        if (flag) flag("date");
        return excelSerialToText(num, kind, date1904);
      }
    }
  }
  if (flag && hasPrecisionLoss(num)) flag("lossy");
  return num;
}

// إزالة الصفوف والأعمدة الفارغة من نهاية الورقة فقط
function trimTrailingEmpty(rows) {
  const isBlank = (c) => (c == null ? "" : String(c)).trim() === "";
  let last = rows.length;
  while (last > 0 && rows[last - 1].every(isBlank)) last--;
  rows = rows.slice(0, last);
  let maxCol = 0;
  rows.forEach((r) => {
    for (let i = r.length - 1; i >= 0; i--) {
      if (!isBlank(r[i])) { if (i + 1 > maxCol) maxCol = i + 1; break; }
    }
  });
  return rows.map((r) => {
    const nr = r.slice(0, maxCol);
    while (nr.length < maxCol) nr.push("");
    return nr;
  });
}

// تحليل XML ورقة إلى صفوف نصية — يملأ الفراغات حسب مرجع الخلية r ويقصّ الفراغ الخلفي.
// flags اختياري { lossy: [], date: [] }: يُضاف إليه { row, col } (فهارس صفرية في الصفوف الناتجة) لكل خلية معلَّمة.
function parseSheet(xml, sst, styleFmts, date1904, flags) {
  const found = []; // { kind, row, col } قبل القصّ
  const rowsByIndex = [];
  let maxRow = 0, maxCol = 0, nextRow = 0;
  // [^>]*? كسول: وإلا تبتلع "/" في <row …/> فيُعامل كوسم مفتوح ويلتهم الصف التالي
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = getAttr(rm[1], "r");
    const rIdx = rAttr ? parseInt(rAttr, 10) - 1 : nextRow;
    nextRow = rIdx + 1;
    const content = rm[2] || "";
    const cells = [];
    let autoCol = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(content))) {
      const cAttrs = cm[1];
      const ref = getAttr(cAttrs, "r");
      const colIdx = ref ? colRefToIndex(ref) : autoCol;
      autoCol = colIdx + 1;
      if (colIdx < 0) continue;
      const t = getAttr(cAttrs, "t") || "n";
      const sAttr = getAttr(cAttrs, "s");
      const flag = flags ? (kind) => { found.push({ kind, row: rIdx, col: colIdx }); } : undefined;
      cells[colIdx] = cellValue(t, cm[2] || "", sst, sAttr, styleFmts, date1904, flag);
      if (colIdx + 1 > maxCol) maxCol = colIdx + 1;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    rowsByIndex[rIdx] = cells;
    if (rIdx + 1 > maxRow) maxRow = rIdx + 1;
  }
  const rows = [];
  for (let r = 0; r < maxRow; r++) {
    const src = rowsByIndex[r] || [];
    const row = [];
    for (let i = 0; i < maxCol; i++) row.push(src[i] == null ? "" : src[i]);
    rows.push(row);
  }
  const trimmed = trimTrailingEmpty(rows);
  if (flags) {
    // القصّ يحذف من النهاية فقط، فالفهارس تبقى صحيحة؛ نُسقط ما وقع خارج الصفوف الناتجة
    const width = trimmed.length ? trimmed[0].length : 0;
    found.forEach((f) => {
      if (f.row < trimmed.length && f.col < width) flags[f.kind].push({ row: f.row, col: f.col });
    });
  }
  return trimmed;
}

// يحلّل بايتات .xlsx/.xlsm إلى [{ sheetName, rows, flags: { lossy, date } }] لكل ورقة بترتيب المصنّف
async function parseXlsx(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // ملفات .xls القديمة (OLE2) غير مدعومة
  if (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw xlsxError("OLE2", "ملفات .xls القديمة غير مدعومة — افتح الملف في Excel واحفظه بصيغة .xlsx ثم أعد رفعه.");
  }
  if (!(b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b)) {
    throw xlsxError("BADXLSX", "الملف ليس ملف Excel صالحًا (.xlsx) — تأكد من الصيغة وأعد المحاولة.");
  }
  let list;
  try {
    list = await parseZipEntries(b);
  } catch (e) {
    throw xlsxError("BADXLSX", "تعذّرت قراءة ملف Excel — قد يكون الملف تالفًا. جرّب فتحه في Excel وحفظه من جديد بصيغة .xlsx.");
  }
  const map = new Map();
  list.forEach((e) => map.set(e.name, e.data));
  const dec = new TextDecoder("utf-8");
  const readXml = (path) => { const d = map.get(path); return d ? dec.decode(d) : null; };

  const workbookXml = readXml("xl/workbook.xml");
  if (!workbookXml) throw xlsxError("BADXLSX", "ملف Excel غير مكتمل (لا يحتوي على xl/workbook.xml) — احفظه من جديد بصيغة .xlsx.");

  const relsXml = readXml("xl/_rels/workbook.xml.rels");
  const sstXml = readXml("xl/sharedStrings.xml");
  const stylesXml = readXml("xl/styles.xml");

  const sst = sstXml ? parseSharedStrings(sstXml) : [];
  const styleFmts = stylesXml ? parseStyles(stylesXml) : { cellXfs: [], numFmts: {} };
  const date1904 = /date1904\s*=\s*["'](1|true)["']/i.test(workbookXml);
  const rels = relsXml ? parseRels(relsXml) : {};
  const sheets = parseWorkbookSheets(workbookXml);

  const out = [];
  sheets.forEach((sh, i) => {
    let target = sh.rid ? rels[sh.rid] : null;
    let path;
    if (target) {
      target = target.replace(/^\.\//, "");
      path = target.charAt(0) === "/" ? target.slice(1) : "xl/" + target;
    } else {
      path = "xl/worksheets/sheet" + (i + 1) + ".xml"; // بديل احتياطي لو تعذّر ربط rId
    }
    const sheetXml = readXml(path);
    if (sheetXml == null) return;
    const flags = { lossy: [], date: [] };
    const rows = parseSheet(sheetXml, sst, styleFmts, date1904, flags);
    out.push({ sheetName: sh.name || ("ورقة " + (i + 1)), rows, flags });
  });

  if (out.length === 0) throw xlsxError("BADXLSX", "لم يتم العثور على أوراق قابلة للقراءة في ملف Excel.");
  return out;
}

// حوّل أوراق مصنّف إلى فئات ملفات: يتخطى الأوراق الفارغة تمامًا ويسمّي حسب عددها.
// ورقة واحدة غير فارغة → باسم الملف؛ عدة أوراق → «اسم الملف — اسم الورقة».
function xlsxSheetsToFiles(fileName, sheets) {
  const nonEmpty = (sheets || []).filter((s) => s.rows.some((r) => r.some((c) => String(c).trim() !== "")));
  return nonEmpty.map((s) => ({
    name: nonEmpty.length === 1 ? fileName : `${fileName} — ${s.sheetName}`,
    sheetName: s.sheetName,
    rows: s.rows,
  }));
}

return { decodeXml, getAttr, extractTag, concatText, parseSharedStrings, parseWorkbookSheets, parseRels, parseStyles, colRefToIndex, classifyNumFmt, excelSerialToText, cellValue, trimTrailingEmpty, parseSheet, parseXlsx, xlsxSheetsToFiles };
});

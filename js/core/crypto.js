"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.crypto = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function () {
/* =====================================================================
 * تشفير نقي متزامن بلا تبعيات: SHA-512، فك AES-CBC، وفك Base64.
 * لماذا لا نستخدم crypto.subtle؟
 *  - فك AES-CBC فيه يفرض إزالة حشو PKCS#7، وأجزاء ملفات Excel المشفّرة بلا حشو.
 *  - اشتقاق المفتاح يحتاج 100000 استدعاء SHA-512 متتالية؛ الاستدعاء غير المتزامن بطيء جدًا.
 * الأعداد 64-بت تُمثَّل بزوج (أعلى، أدنى) من أعداد 32-بت داخل Int32Array — بلا BigInt.
 * ===================================================================== */

/* ---------- SHA-512 (FIPS 180-4) ---------- */

// الثوابت K: أول 64 بت من الأجزاء الكسرية للجذور التكعيبية لأول 80 عددًا أوليًا — أزواج (أعلى، أدنى)
const K512 = new Int32Array([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]);

// القيم الابتدائية: الأجزاء الكسرية للجذور التربيعية لأول 8 أعداد أولية
const IV512 = new Int32Array([
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);

const TWO32 = 4294967296;

// دالة الضغط: st = الحالة (16 عددًا = 8 أزواج)، w = 160 عددًا أولها 32 تحمل كتلة الرسالة (big-endian).
// الجمع 64-بت: نجمع الأجزاء الدنيا كأعداد موجبة (مجموعها أقل من 2^53 فيبقى دقيقًا)
// ثم نضيف الحمل (المجموع ÷ 2^32) إلى الأجزاء العليا.
function compress512(st, w) {
  for (let j = 32; j < 160; j += 2) {
    let xh = w[j - 30], xl = w[j - 29];
    // σ0 = rotr1 ^ rotr8 ^ shr7
    const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
    const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
    xh = w[j - 4]; xl = w[j - 3];
    // σ1 = rotr19 ^ rotr61 ^ shr6
    const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
    const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
    const lo = (w[j - 31] >>> 0) + (s0l >>> 0) + (w[j - 13] >>> 0) + (s1l >>> 0);
    w[j] = w[j - 32] + s0h + w[j - 14] + s1h + ((lo / TWO32) | 0);
    w[j + 1] = lo;
  }

  let ah = st[0], al = st[1], bh = st[2], bl = st[3], ch = st[4], cl = st[5], dh = st[6], dl = st[7];
  let eh = st[8], el = st[9], fh = st[10], fl = st[11], gh = st[12], gl = st[13], hh = st[14], hl = st[15];
  for (let j = 0; j < 160; j += 2) {
    // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
    const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
    const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
    const chH = (eh & fh) ^ (~eh & gh);
    const chL = (el & fl) ^ (~el & gl);
    let lo = (hl >>> 0) + (S1l >>> 0) + (chL >>> 0) + (K512[j + 1] >>> 0) + (w[j + 1] >>> 0);
    const t1h = (hh + S1h + chH + K512[j] + w[j] + ((lo / TWO32) | 0)) | 0;
    const t1l = lo >>> 0;
    // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
    const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
    const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
    const majH = (ah & bh) ^ (ah & ch) ^ (bh & ch);
    const majL = (al & bl) ^ (al & cl) ^ (bl & cl);
    lo = (S0l >>> 0) + (majL >>> 0);
    const t2h = (S0h + majH + ((lo / TWO32) | 0)) | 0;
    const t2l = lo >>> 0;

    hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
    lo = (dl >>> 0) + t1l;
    eh = (dh + t1h + ((lo / TWO32) | 0)) | 0; el = lo | 0;
    dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
    lo = t1l + t2l;
    ah = (t1h + t2h + ((lo / TWO32) | 0)) | 0; al = lo | 0;
  }

  const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
  for (let i = 0; i < 16; i += 2) {
    const lo = (st[i + 1] >>> 0) + (v[i + 1] >>> 0);
    st[i] = st[i] + v[i] + ((lo / TWO32) | 0);
    st[i + 1] = lo;
  }
}

// تحميل كتلة 128 بايت من b بدءًا من off إلى w[0..31] ككلمات big-endian
function loadBlock(w, b, off) {
  for (let i = 0; i < 32; i++, off += 4) {
    w[i] = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
  }
}

function wordsToBytes(words) {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const x = words[i];
    out[4 * i] = x >>> 24; out[4 * i + 1] = x >>> 16; out[4 * i + 2] = x >>> 8; out[4 * i + 3] = x;
  }
  return out;
}

// SHA-512 لمصفوفة بايتات → Uint8Array(64)
function sha512(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = b.length;
  const st = new Int32Array(IV512);
  const w = new Int32Array(160);
  const full = n - (n % 128);
  for (let off = 0; off < full; off += 128) { loadBlock(w, b, off); compress512(st, w); }

  // الذيل: البايتات المتبقية + 0x80 + أصفار + الطول بالبتات (128 بت big-endian)
  const rem = n - full;
  const tail = new Uint8Array(rem + 17 <= 128 ? 128 : 256);
  tail.set(b.subarray(full), 0);
  tail[rem] = 0x80;
  const bitsHi = Math.floor(n / 0x20000000); // (n × 8) ÷ 2^32
  const bitsLo = (n << 3) >>> 0;
  const L = tail.length;
  tail[L - 8] = bitsHi >>> 24; tail[L - 7] = bitsHi >>> 16; tail[L - 6] = bitsHi >>> 8; tail[L - 5] = bitsHi;
  tail[L - 4] = bitsLo >>> 24; tail[L - 3] = bitsLo >>> 16; tail[L - 2] = bitsLo >>> 8; tail[L - 1] = bitsLo;
  for (let off = 0; off < L; off += 128) { loadBlock(w, tail, off); compress512(st, w); }
  return wordsToBytes(st);
}

// تكرار التجزئة لاشتقاق مفتاح Excel (MS-OFFCRYPTO 2.3.4.11):
// لكل i من 0 إلى count-1: H = SHA512(LE32(i) || H). يعيد H الأخير (Uint8Array(64)).
// الرسالة دائمًا 68 بايت فتسع في كتلة واحدة؛ نبنيها مباشرة ككلمات بلا أي نسخ أو حجز ذاكرة داخل الحلقة.
function sha512Spin(hash, count) {
  if (!hash || hash.length !== 64) throw new Error("sha512Spin: التجزئة الابتدائية يجب أن تكون 64 بايت.");
  const h = new Int32Array(16);
  loadBlockWords(h, hash);
  const st = new Int32Array(16);
  const w = new Int32Array(160);
  w[17] = 0x80000000 | 0; // بايت الحشو 0x80 بعد 68 بايت
  w[31] = 68 * 8;         // طول الرسالة بالبتات
  for (let i = 0; i < count; i++) {
    // LE32(i) مقروءًا ككلمة big-endian = عكس ترتيب بايتات i
    w[0] = ((i & 0xff) << 24) | ((i & 0xff00) << 8) | ((i >>> 8) & 0xff00) | (i >>> 24);
    for (let k = 0; k < 16; k++) w[k + 1] = h[k];
    st.set(IV512);
    compress512(st, w);
    h.set(st);
  }
  return wordsToBytes(h);
}

function loadBlockWords(words, b) {
  for (let i = 0; i < words.length; i++) {
    words[i] = (b[4 * i] << 24) | (b[4 * i + 1] << 16) | (b[4 * i + 2] << 8) | b[4 * i + 3];
  }
}

/* ---------- AES (FIPS-197) — فك التشفير فقط، بجداول T لسرعة أكبر ---------- */

let AES_TABLES = null;
function aesTables() {
  if (AES_TABLES) return AES_TABLES;
  const rotl8 = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff;
  const sbox = new Uint8Array(256);
  const inv = new Uint8Array(256);
  // توليد S-box: p يمر على كل عناصر GF(2^8) بالضرب في 3، وq = معكوسه الضربي (القسمة على 3)
  let p = 1, q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q = (q ^ (q << 1)) & 0xff;
    q = (q ^ (q << 2)) & 0xff;
    q = (q ^ (q << 4)) & 0xff;
    if (q & 0x80) q ^= 0x09;
    sbox[p] = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63;
  } while (p !== 1);
  sbox[0] = 0x63;
  for (let i = 0; i < 256; i++) inv[sbox[i]] = i;

  // ضرب في GF(2^8) بمتعدد الحدود x^8+x^4+x^3+x+1
  const mul = (a, b) => {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
      b >>= 1;
    }
    return r;
  };
  // Td0[x] = InvSbox[x]·(0e,09,0d,0b)؛ Td1..Td3 تدويرات بايت واحد
  const td0 = new Int32Array(256), td1 = new Int32Array(256), td2 = new Int32Array(256), td3 = new Int32Array(256);
  for (let x = 0; x < 256; x++) {
    const s = inv[x];
    const v = (mul(s, 14) << 24) | (mul(s, 9) << 16) | (mul(s, 13) << 8) | mul(s, 11);
    td0[x] = v;
    td1[x] = (v >>> 8) | (v << 24);
    td2[x] = (v >>> 16) | (v << 16);
    td3[x] = (v >>> 24) | (v << 8);
  }
  AES_TABLES = { sbox, inv, td0, td1, td2, td3 };
  return AES_TABLES;
}

// جدول مفاتيح فك التشفير (الشيفرة العكسية المكافئة): مفاتيح الجولات بترتيب معكوس
// مع تطبيق InvMixColumns على مفاتيح الجولات الوسطى.
function aesDecryptKeySchedule(key) {
  const { sbox, td0, td1, td2, td3 } = aesTables();
  const nk = key.length / 4;
  const nr = nk + 6;
  const total = 4 * (nr + 1);
  const subWord = (t) => (sbox[t >>> 24] << 24) | (sbox[(t >>> 16) & 255] << 16) | (sbox[(t >>> 8) & 255] << 8) | sbox[t & 255];
  const w = new Int32Array(total);
  for (let i = 0; i < nk; i++) {
    w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
  }
  let rcon = 1;
  for (let i = nk; i < total; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = subWord((t << 8) | (t >>> 24)) ^ (rcon << 24);
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) {
      t = subWord(t);
    }
    w[i] = w[i - nk] ^ t;
  }
  const dk = new Int32Array(total);
  for (let r = 0; r <= nr; r++) {
    for (let c = 0; c < 4; c++) {
      let v = w[4 * (nr - r) + c];
      if (r > 0 && r < nr) {
        v = td0[sbox[v >>> 24]] ^ td1[sbox[(v >>> 16) & 255]] ^ td2[sbox[(v >>> 8) & 255]] ^ td3[sbox[v & 255]];
      }
      dk[4 * r + c] = v;
    }
  }
  return { dk, nr };
}

// فك AES-CBC بلا إزالة حشو. المفتاح 16/24/32 بايت، IV = 16 بايت، طول البيانات من مضاعفات 16.
function aesDecryptCbc(keyBytes, ivBytes, dataBytes) {
  const key = keyBytes instanceof Uint8Array ? keyBytes : new Uint8Array(keyBytes);
  const iv = ivBytes instanceof Uint8Array ? ivBytes : new Uint8Array(ivBytes);
  const data = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(dataBytes);
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) throw new Error("AES: طول المفتاح يجب أن يكون 16 أو 24 أو 32 بايت.");
  if (iv.length !== 16) throw new Error("AES: متجه البداية (IV) يجب أن يكون 16 بايت.");
  if (data.length % 16 !== 0) throw new Error("AES: طول البيانات المشفّرة يجب أن يكون من مضاعفات 16.");

  const { inv, td0, td1, td2, td3 } = aesTables();
  const { dk, nr } = aesDecryptKeySchedule(key);
  const be32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const out = new Uint8Array(data.length);
  let p0 = be32(iv, 0), p1 = be32(iv, 4), p2 = be32(iv, 8), p3 = be32(iv, 12);

  for (let off = 0; off < data.length; off += 16) {
    const c0 = be32(data, off), c1 = be32(data, off + 4), c2 = be32(data, off + 8), c3 = be32(data, off + 12);
    let s0 = c0 ^ dk[0], s1 = c1 ^ dk[1], s2 = c2 ^ dk[2], s3 = c3 ^ dk[3];
    let k = 4;
    for (let r = 1; r < nr; r++, k += 4) {
      const t0 = td0[s0 >>> 24] ^ td1[(s3 >>> 16) & 255] ^ td2[(s2 >>> 8) & 255] ^ td3[s1 & 255] ^ dk[k];
      const t1 = td0[s1 >>> 24] ^ td1[(s0 >>> 16) & 255] ^ td2[(s3 >>> 8) & 255] ^ td3[s2 & 255] ^ dk[k + 1];
      const t2 = td0[s2 >>> 24] ^ td1[(s1 >>> 16) & 255] ^ td2[(s0 >>> 8) & 255] ^ td3[s3 & 255] ^ dk[k + 2];
      const t3 = td0[s3 >>> 24] ^ td1[(s2 >>> 16) & 255] ^ td2[(s1 >>> 8) & 255] ^ td3[s0 & 255] ^ dk[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    }
    // الجولة الأخيرة: InvShiftRows + InvSubBytes + مفتاح الجولة، ثم XOR مع الكتلة المشفّرة السابقة (CBC)
    const o0 = ((inv[s0 >>> 24] << 24) | (inv[(s3 >>> 16) & 255] << 16) | (inv[(s2 >>> 8) & 255] << 8) | inv[s1 & 255]) ^ dk[k] ^ p0;
    const o1 = ((inv[s1 >>> 24] << 24) | (inv[(s0 >>> 16) & 255] << 16) | (inv[(s3 >>> 8) & 255] << 8) | inv[s2 & 255]) ^ dk[k + 1] ^ p1;
    const o2 = ((inv[s2 >>> 24] << 24) | (inv[(s1 >>> 16) & 255] << 16) | (inv[(s0 >>> 8) & 255] << 8) | inv[s3 & 255]) ^ dk[k + 2] ^ p2;
    const o3 = ((inv[s3 >>> 24] << 24) | (inv[(s2 >>> 16) & 255] << 16) | (inv[(s1 >>> 8) & 255] << 8) | inv[s0 & 255]) ^ dk[k + 3] ^ p3;
    out[off] = o0 >>> 24; out[off + 1] = o0 >>> 16; out[off + 2] = o0 >>> 8; out[off + 3] = o0;
    out[off + 4] = o1 >>> 24; out[off + 5] = o1 >>> 16; out[off + 6] = o1 >>> 8; out[off + 7] = o1;
    out[off + 8] = o2 >>> 24; out[off + 9] = o2 >>> 16; out[off + 10] = o2 >>> 8; out[off + 11] = o2;
    out[off + 12] = o3 >>> 24; out[off + 13] = o3 >>> 16; out[off + 14] = o3 >>> 8; out[off + 15] = o3;
    p0 = c0; p1 = c1; p2 = c2; p3 = c3;
  }
  return out;
}

/* ---------- Base64 (بلا atob ليعمل بنفس الطريقة في Node والمتصفح) ---------- */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INDEX[B64_CHARS.charCodeAt(i)] = i;

// يتجاهل المسافات وأسطر الجديدة، ويتسامح مع غياب "=" في النهاية. يرمي خطأً عند وجود حرف غير صالح.
function base64ToBytes(s) {
  const clean = String(s == null ? "" : s).replace(/\s+/g, "").replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new Error("Base64: طول النص غير صالح.");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) throw new Error("Base64: حرف غير صالح في النص.");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}

return { sha512, sha512Spin, aesDecryptCbc, base64ToBytes };
});

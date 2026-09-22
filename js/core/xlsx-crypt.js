"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./ole.js" ← T.core.ole — نفس سطر require يعمل في المتصفح وفي Node
    T.core.xlsxCrypt = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { isOle, readOle, getStream } = require("./ole.js");
const { sha512, sha512Spin, aesDecryptCbc, base64ToBytes } = require("./crypto.js");
const { xlsxError } = require("./zip.js");

/* =====================================================================
 * فك تشفير ملفات Excel المحمية بكلمة سر (MS-OFFCRYPTO).
 * الملف المشفّر حاوية OLE فيها تياران: EncryptionInfo (وصف التشفير) وEncryptedPackage
 * (ملف .xlsx العادي مشفّرًا). ندعم Agile Encryption (Excel 2010 فما بعد) بـ SHA-512 وAES-CBC،
 * والناتج بايتات .xlsx عادية تمر إلى parseXlsx.
 * كل شيء متزامن: الاشتقاق (100000 دورة SHA-512) يستغرق جزءًا من الثانية.
 * كلمة السر لا تُحفظ ولا تُطبع في أي مكان.
 * ===================================================================== */

const PASSWORD_URI = "http://schemas.microsoft.com/office/2006/keyEncryptor/password";
// مفاتيح الكتل الثابتة في المواصفة (2.3.4.13)
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const SEGMENT_LENGTH = 4096;
const MAX_SPIN_COUNT = 10000000; // الحد الأقصى في المواصفة
const F_CRYPTOAPI = 0x04, F_EXTERNAL = 0x10;

const MSG = {
  NOPASSWORD: "هذا الملف محمي بكلمة سر — أدخل كلمة السر لفتحه.",
  BADPASSWORD: "كلمة السر غير صحيحة.",
  STANDARD_ENCRYPTION: "هذا الملف مشفّر بطريقة Excel 2007 القديمة — افتحه في Excel حديث واحفظه من جديد ثم أعد المحاولة.",
  LEGACY_XLS: "ملفات .xls القديمة غير مدعومة — افتح الملف في Excel واحفظه بصيغة .xlsx.",
  UNSUPPORTED_ENCRYPTION: "طريقة تشفير هذا الملف غير مدعومة — افتحه في Excel حديث واحفظه من جديد ثم أعد المحاولة.",
  BADENCRYPTION: "بيانات التشفير في هذا الملف تالفة أو غير مكتملة — جرّب فتحه في Excel وحفظه من جديد.",
  NOT_ENCRYPTED: "هذا الملف ليس ملف Excel محميًا بكلمة سر.",
};
// detail للمطوّر فقط (لا يحتوي كلمة السر أبدًا)
function fail(code, detail) {
  const e = xlsxError(code, MSG[code]);
  if (detail) e.detail = detail;
  return e;
}

function toBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/* ---------- تصنيف ملف OLE ---------- */

// يعيد { kind, version, info, pkg } — info/pkg بايتات التيارين إن وُجدا
function classify(ole) {
  const info = getStream(ole, "EncryptionInfo");
  const pkg = getStream(ole, "EncryptedPackage");
  if (!info || !pkg) return { kind: "legacy-xls" };
  if (info.length < 8) return { kind: "encrypted-other", version: "", info, pkg };
  const major = info[0] | (info[1] << 8);
  const minor = info[2] | (info[3] << 8);
  const flags = info[4] | (info[5] << 8) | (info[6] << 16) | (info[7] << 24);
  let kind = "encrypted-other"; // مثل Extensible Encryption (x.3)
  if (major === 4 && minor === 4) kind = "encrypted-agile";
  else if (minor === 2 && major >= 2 && major <= 4 && (flags & F_CRYPTOAPI) && !(flags & F_EXTERNAL)) kind = "encrypted-standard";
  return { kind, version: major + "." + minor, info, pkg };
}

// نوع الملف: "encrypted-agile" | "encrypted-standard" | "encrypted-other" | "legacy-xls" | "not-ole"
// يرمي BADOLE إن كان الملف يبدأ بتوقيع OLE لكن بنيته تالفة.
function inspectOle(bytes) {
  const b = toBytes(bytes);
  if (!isOle(b)) return { kind: "not-ole" };
  const c = classify(readOle(b));
  return c.version === undefined ? { kind: c.kind } : { kind: c.kind, version: c.version };
}

/* ---------- قراءة وصف التشفير (XML) بلا DOMParser ليعمل في Node أيضًا ---------- */

function attr(attrs, name) {
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrs))) if (m[1] === name) return m[2] != null ? m[2] : m[3];
  return null;
}

// يعيد خصائص عنصر keyData وعنصر encryptedKey التابع لمُشفِّر كلمة السر (أيًّا كانت بادئة النطاق)
function scanDescriptor(xml) {
  const re = /<([\w.-]+:)?([\w.-]+)\b([^>]*)>/g;
  let keyData = null, encryptedKey = null, inPassword = false, m;
  while ((m = re.exec(xml))) {
    const local = m[2];
    if (local === "keyData" && keyData === null) keyData = m[3];
    else if (local === "keyEncryptor") inPassword = attr(m[3], "uri") === PASSWORD_URI;
    else if (local === "encryptedKey" && inPassword && encryptedKey === null) encryptedKey = m[3];
  }
  return { keyData, encryptedKey };
}

// قارئ خصائص عنصر: نص / عدد صحيح / Base64 — غياب الخاصية أو فساد قيمتها ← BADENCRYPTION
function attrReader(attrs, what) {
  const str = (n) => {
    const v = attr(attrs, n);
    if (v == null) throw fail("BADENCRYPTION", `${what}: missing ${n}`);
    return v;
  };
  const num = (n) => {
    const v = str(n);
    if (!/^\d+$/.test(v)) throw fail("BADENCRYPTION", `${what}: bad ${n}`);
    return parseInt(v, 10);
  };
  const bin = (n) => {
    const v = str(n);
    try { return base64ToBytes(v); } catch (e) { throw fail("BADENCRYPTION", `${what}: bad base64 in ${n}`); }
  };
  return { str, num, bin };
}

// الخصائص المشتركة بين keyData وencryptedKey
function cipherParams(r, what) {
  const p = {
    saltSize: r.num("saltSize"), blockSize: r.num("blockSize"), keyBits: r.num("keyBits"), hashSize: r.num("hashSize"),
    cipherAlgorithm: r.str("cipherAlgorithm"), cipherChaining: r.str("cipherChaining"), hashAlgorithm: r.str("hashAlgorithm"),
    saltValue: r.bin("saltValue"),
  };
  // المدعوم: AES-CBC مع SHA-512 (ما ينتجه Excel 2013 فما بعد). غير ذلك (مثل SHA-1 في Excel 2010) ← رسالة واضحة.
  const supported = p.cipherAlgorithm === "AES" && p.cipherChaining === "ChainingModeCBC" && p.hashAlgorithm === "SHA512" &&
    p.blockSize === 16 && p.hashSize === 64 && (p.keyBits === 128 || p.keyBits === 192 || p.keyBits === 256);
  if (!supported) throw fail("UNSUPPORTED_ENCRYPTION", `${what}: ${p.cipherAlgorithm}/${p.cipherChaining}/${p.hashAlgorithm}/${p.keyBits}`);
  if (p.saltSize < 1 || p.saltValue.length < 1) throw fail("BADENCRYPTION", `${what}: empty salt`);
  return p;
}

function parseAgileInfo(info) {
  let xml = new TextDecoder("utf-8").decode(info.subarray(8));
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const found = scanDescriptor(xml);
  if (found.keyData === null) throw fail("BADENCRYPTION", "keyData element not found");
  if (found.encryptedKey === null) throw fail("UNSUPPORTED_ENCRYPTION", "no password key encryptor");
  const keyData = cipherParams(attrReader(found.keyData, "keyData"), "keyData");
  const r = attrReader(found.encryptedKey, "encryptedKey");
  const key = {
    params: cipherParams(r, "encryptedKey"),
    spinCount: r.num("spinCount"),
    encryptedVerifierHashInput: r.bin("encryptedVerifierHashInput"),
    encryptedVerifierHashValue: r.bin("encryptedVerifierHashValue"),
    encryptedKeyValue: r.bin("encryptedKeyValue"),
  };
  if (key.spinCount > MAX_SPIN_COUNT) throw fail("BADENCRYPTION", "spinCount above maximum");
  return { keyData, key };
}

/* ---------- مساعدات بايتات ---------- */

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// قص إلى n بايت أو إكمال بالقيمة 0x36 (كما تنص المواصفة)
function fit(bytes, n) {
  if (bytes.length >= n) return bytes.slice(0, n);
  const out = new Uint8Array(n).fill(0x36);
  out.set(bytes);
  return out;
}

function utf16le(s) {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >>> 8;
  }
  return out;
}

function le32(i) {
  return Uint8Array.from([i & 0xff, (i >>> 8) & 0xff, (i >>> 16) & 0xff, (i >>> 24) & 0xff]);
}

function aesCbc(key, iv, data, what) {
  if (data.length === 0 || data.length % 16 !== 0) throw fail("BADENCRYPTION", what + ": length not a multiple of 16");
  return aesDecryptCbc(key, iv, data);
}

/* ---------- الخوارزمية (MS-OFFCRYPTO 2.3.4.10–2.3.4.15) ---------- */

// كلمة السر ← المفتاح السري للحزمة. يرمي BADPASSWORD إن لم تتطابق قيمة التحقق.
function agileSecretKey(parsed, password) {
  const ek = parsed.key.params;
  const salt = ek.saltValue;
  // H0 = SHA512(salt || password) ثم spinCount دورة: H = SHA512(LE32(i) || H)
  const h = sha512Spin(sha512(concat(salt, utf16le(String(password)))), parsed.key.spinCount);
  const iv = fit(salt, ek.blockSize);
  const decryptWithBlockKey = (blockKey, data, what) => {
    const derived = fit(sha512(concat(h, Uint8Array.from(blockKey))), ek.keyBits / 8);
    return aesCbc(derived, iv, data, what);
  };

  const verifierInput = decryptWithBlockKey(BLOCK_VERIFIER_INPUT, parsed.key.encryptedVerifierHashInput, "verifier input");
  const verifierHash = decryptWithBlockKey(BLOCK_VERIFIER_VALUE, parsed.key.encryptedVerifierHashValue, "verifier hash");
  if (verifierInput.length < ek.saltSize || verifierHash.length < ek.hashSize) throw fail("BADENCRYPTION", "verifier too short");
  const expected = sha512(verifierInput.subarray(0, ek.saltSize));
  for (let i = 0; i < ek.hashSize; i++) {
    if (expected[i] !== verifierHash[i]) throw fail("BADPASSWORD");
  }

  const keyValue = decryptWithBlockKey(BLOCK_KEY_VALUE, parsed.key.encryptedKeyValue, "key value");
  const keyLen = parsed.keyData.keyBits / 8;
  if (keyValue.length < keyLen) throw fail("BADENCRYPTION", "key value too short");
  return keyValue.slice(0, keyLen);
}

// حجم الحزمة الأصلي (أول 8 بايت، LE64) — يُتحقق منه قبل الاشتقاق البطيء
function packageSize(pkg) {
  if (pkg.length < 8) throw fail("BADENCRYPTION", "package header missing");
  const size = (pkg[0] | (pkg[1] << 8) | (pkg[2] << 16) | (pkg[3] << 24)) >>> 0;
  const high = (pkg[4] | (pkg[5] << 8) | (pkg[6] << 16) | (pkg[7] << 24)) >>> 0;
  const available = pkg.length - 8;
  // البيانات المشفّرة محشوّة إلى مضاعفات 16؛ أي بايتات زائدة بعدها تُتجاهل
  if (high !== 0 || size > available - (available % 16)) throw fail("BADENCRYPTION", "package shorter than declared size");
  return size;
}

// فك الحزمة: أجزاء 4096 بايت، لكل جزء i متجه IV = أول blockSize بايت من SHA512(keyData.salt || LE32(i)).
// ملاحظة: لا نتحقق من سلامة البيانات عبر HMAC (dataIntegrity) — التحقق من كلمة السر يكفي لاكتشاف
// كلمة السر الخاطئة، وأي تلف في الحزمة سيظهر عند قراءة ملف ZIP الناتج.
function decryptPackage(pkg, size, keyData, key) {
  const data = pkg.subarray(8);
  const out = new Uint8Array(size);
  for (let i = 0, off = 0; off < size; i++, off += SEGMENT_LENGTH) {
    let end = Math.min(off + SEGMENT_LENGTH, data.length);
    end -= (end - off) % 16;
    const iv = fit(sha512(concat(keyData.saltValue, le32(i))), keyData.blockSize);
    const plain = aesDecryptCbc(key, iv, data.subarray(off, end));
    out.set(plain.subarray(0, Math.min(plain.length, size - off)), off);
  }
  return out;
}

/* ---------- الواجهة ---------- */

function kindError(kind) {
  if (kind === "legacy-xls") return fail("LEGACY_XLS");
  if (kind === "encrypted-standard") return fail("STANDARD_ENCRYPTION");
  if (kind === "not-ole") return fail("NOT_ENCRYPTED");
  return fail("UNSUPPORTED_ENCRYPTION", kind);
}

function openAgile(bytes) {
  const b = toBytes(bytes);
  if (!isOle(b)) throw kindError("not-ole");
  const c = classify(readOle(b));
  if (c.kind !== "encrypted-agile") throw kindError(c.kind);
  return c;
}

function decryptOpened(c, password) {
  const parsed = parseAgileInfo(c.info);
  const size = packageSize(c.pkg);
  const key = agileSecretKey(parsed, password);
  return decryptPackage(c.pkg, size, parsed.keyData, key);
}

// يفك ملف Agile ويعيد بايتات .xlsx (Uint8Array). أخطاء: BADPASSWORD، UNSUPPORTED_ENCRYPTION، BADENCRYPTION، BADOLE…
function decryptAgile(bytes, password) {
  return decryptOpened(openAgile(bytes), password);
}

// نقطة الدخول للواجهة (متزامنة): تتحقق من نوع الملف أولًا (لا نطلب كلمة سر لملف لن نستطيع فتحه)،
// ثم من وجود كلمة السر، ثم تفك التشفير.
function decryptXlsx(bytes, password) {
  const c = openAgile(bytes);
  if (password == null || String(password) === "") throw fail("NOPASSWORD");
  return decryptOpened(c, password);
}

return { inspectOle, decryptAgile, decryptXlsx };
});

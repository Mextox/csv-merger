"use strict";
// SHA-512 وفك AES-CBC وBase64 — تنفيذ JS نقي متزامن، يُقارن بمتجهات NIST القياسية وبوحدة crypto في Node
const nodeCrypto = require("crypto");
const C = require("../js/core/crypto.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });

const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const ascii = (s) => new Uint8Array(Buffer.from(s, "latin1"));

// مولّد بايتات شبه عشوائية ثابت (لتكرار نفس المدخلات في كل تشغيل)
function pseudoBytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}
const nodeSha512 = (b) => hex(nodeCrypto.createHash("sha512").update(b).digest());

/* ---------- SHA-512: متجهات FIPS 180-2 ---------- */
eq("sha512 empty", hex(C.sha512(new Uint8Array(0))),
  "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e");
eq("sha512 abc", hex(C.sha512(ascii("abc"))),
  "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
eq("sha512 896-bit two-block message", hex(C.sha512(ascii(
  "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"))),
  "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909");
check("sha512 returns Uint8Array(64)", C.sha512(ascii("x")) instanceof Uint8Array && C.sha512(ascii("x")).length === 64);

// كل الأطوال 0..300 (تغطي حدود الحشو 111/112/127/128/239/240/255/256) مقارنةً بـ Node
{
  const bad = [];
  for (let n = 0; n <= 300; n++) {
    const m = pseudoBytes(n, n + 7);
    if (hex(C.sha512(m)) !== nodeSha512(m)) bad.push(n);
  }
  check("sha512 matches node:crypto for lengths 0..300", bad.length === 0, bad);
}
{
  const big = pseudoBytes(100000, 42);
  eq("sha512 100 KB matches node:crypto", hex(C.sha512(big)), nodeSha512(big));
  // مصفوفة فرعية تبدأ من إزاحة داخل ArrayBuffer أكبر
  const view = big.subarray(13, 13 + 200);
  eq("sha512 on subarray view", hex(C.sha512(view)), nodeSha512(Buffer.from(view)));
}

/* ---------- sha512Spin: H = SHA512(LE32(i) || H) لـ i = 0..n-1 ---------- */
function naiveSpin(h, n) {
  for (let i = 0; i < n; i++) {
    const buf = Buffer.alloc(4 + h.length);
    buf.writeUInt32LE(i, 0);
    Buffer.from(h).copy(buf, 4);
    h = nodeCrypto.createHash("sha512").update(buf).digest();
  }
  return hex(h);
}
{
  const h0 = C.sha512(ascii("seed"));
  eq("sha512Spin 0 iterations = input", hex(C.sha512Spin(h0, 0)), hex(h0));
  eq("sha512Spin 1 iteration", hex(C.sha512Spin(h0, 1)), naiveSpin(h0, 1));
  eq("sha512Spin 1000 iterations", hex(C.sha512Spin(h0, 1000)), naiveSpin(h0, 1000));
  check("sha512Spin does not modify its input", hex(h0) === hex(C.sha512(ascii("seed"))));
  const t0 = Date.now();
  const r = C.sha512Spin(h0, 100000);
  const ms = Date.now() - t0;
  console.log(`INFO: sha512Spin 100000 iterations: ${ms} ms`);
  eq("sha512Spin 100000 iterations matches node", hex(r), naiveSpin(h0, 100000));
  check("sha512Spin 100000 iterations < 1500 ms", ms < 1500, ms);
}

/* ---------- AES: FIPS-197 الملحق C (كتلة واحدة؛ CBC بمتجه IV صفري = ECB) ---------- */
{
  const pt = "00112233445566778899aabbccddeeff";
  const zeroIv = new Uint8Array(16);
  const keyN = (n) => Uint8Array.from({ length: n }, (_, i) => i);
  eq("AES-128 FIPS-197 C.1", hex(C.aesDecryptCbc(keyN(16), zeroIv, fromHex("69c4e0d86a7b0430d8cdb78070b4c55a"))), pt);
  eq("AES-192 FIPS-197 C.2", hex(C.aesDecryptCbc(keyN(24), zeroIv, fromHex("dda97ca4864cdfe06eaf70a0ec0d7191"))), pt);
  eq("AES-256 FIPS-197 C.3", hex(C.aesDecryptCbc(keyN(32), zeroIv, fromHex("8ea2b7ca516745bfeafc49904b496089"))), pt);
}

/* ---------- AES-256-CBC: NIST SP800-38A F.2.6 ---------- */
eq("AES-256-CBC SP800-38A F.2.6 decrypt", hex(C.aesDecryptCbc(
  fromHex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4"),
  fromHex("000102030405060708090a0b0c0d0e0f"),
  fromHex("f58c4c04d6e5f1ba779eabfb5f7bfbd69cfc4e967edb808d679f777bc6702c7d" +
          "39f23369a9d9bacfa530e26304231461b2eb05e2c39be9fcda6c19078c6a9d1b"))),
  "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51" +
  "30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710");

// مقارنة بـ Node لمفاتيح 128/192/256 وأطوال متعددة الكتل (بلا حشو)
[16, 24, 32].forEach((klen) => {
  [16, 48, 4096].forEach((len, j) => {
    const key = pseudoBytes(klen, klen * 31 + j);
    const iv = pseudoBytes(16, klen + j + 99);
    const ct = pseudoBytes(len, len + klen);
    const d = nodeCrypto.createDecipheriv(`aes-${klen * 8}-cbc`, key, iv);
    d.setAutoPadding(false);
    const want = hex(Buffer.concat([d.update(ct), d.final()]));
    eq(`aesDecryptCbc AES-${klen * 8} ${len} bytes matches node`, hex(C.aesDecryptCbc(key, iv, ct)), want);
  });
});
{
  // البيانات لا تُعدَّل، والحشو لا يُزال (آخر كتلة تبقى كما هي)
  const key = pseudoBytes(32, 5), iv = pseudoBytes(16, 6), ct = pseudoBytes(64, 7);
  const before = hex(ct);
  const out = C.aesDecryptCbc(key, iv, ct);
  check("aesDecryptCbc keeps input intact", hex(ct) === before);
  eq("aesDecryptCbc output length = input length (no padding removal)", out.length, 64);
  eq("aesDecryptCbc empty data", C.aesDecryptCbc(key, iv, new Uint8Array(0)).length, 0);
}
function throwsCode(fn) { try { fn(); return ""; } catch (e) { return e.message || "error"; } }
check("aesDecryptCbc rejects length not multiple of 16", throwsCode(() => C.aesDecryptCbc(new Uint8Array(16), new Uint8Array(16), new Uint8Array(15))) !== "");
check("aesDecryptCbc rejects 20-byte key", throwsCode(() => C.aesDecryptCbc(new Uint8Array(20), new Uint8Array(16), new Uint8Array(16))) !== "");
check("aesDecryptCbc rejects 8-byte IV", throwsCode(() => C.aesDecryptCbc(new Uint8Array(16), new Uint8Array(8), new Uint8Array(16))) !== "");

/* ---------- Base64 ---------- */
const b64 = (s) => Buffer.from(C.base64ToBytes(s)).toString("latin1");
eq("base64 empty", C.base64ToBytes("").length, 0);
eq("base64 no padding needed", b64("TWFu"), "Man");
eq("base64 one '='", b64("TWE="), "Ma");
eq("base64 two '='", b64("TQ=="), "M");
eq("base64 missing padding tolerated", b64("TQ"), "M");
eq("base64 ignores whitespace/newlines", b64(" TW\r\nFu\tTW E= "), "ManMa");
{
  const all = pseudoBytes(1000, 3);
  eq("base64 round trip vs Buffer (+ and /)", hex(C.base64ToBytes(Buffer.from(all).toString("base64"))), hex(all));
}
check("base64 rejects invalid characters", throwsCode(() => C.base64ToBytes("TW@u")) !== "");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

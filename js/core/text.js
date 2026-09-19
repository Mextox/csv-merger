"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.text = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function () {
/* =====================================================================
 * تطبيع النصوص والأرقام — كل القيم تبقى نصوصًا، لا تحويل إلى أرقام أبدًا.
 * ===================================================================== */

// ٠-٩ (عربية) و ۰-۹ (فارسية) ← 0-9
function latinDigits(s) {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

// التطبيع الإلزامي لكل خلية: نص، بلا مسافات طرفية، أرقام لاتينية، وحذف ".0" من الأعداد الصحيحة.
function normalizeCell(v) {
  if (v == null) return "";
  let s = latinDigits(String(v).trim());
  if (/^-?\d+\.0+$/.test(s)) s = s.slice(0, s.indexOf("."));
  return s;
}

// مفتاح مقارنة للعناوين والكلمات: التطبيع + أحرف صغيرة + مسافة واحدة بين الكلمات.
function normalizeKey(s) {
  return normalizeCell(s).toLowerCase().replace(/\s+/g, " ");
}

function digitsOnly(s) {
  return latinDigits(String(s == null ? "" : s)).replace(/\D+/g, "");
}

function numbersIn(s) {
  return latinDigits(String(s == null ? "" : s)).match(/\d+/g) || [];
}
function firstNumber(s) { const n = numbersIn(s); return n.length ? n[0] : ""; }
function lastNumber(s) { const n = numbersIn(s); return n.length ? n[n.length - 1] : ""; }

// مسافة ليفنشتاين (للتعرّف على أسماء الشركات مع الأخطاء الإملائية)
function editDistance(a, b) {
  a = String(a); b = String(b);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// رقم مكتوب بصيغة علمية (مثل 1.23E+15) — يحدث عند حفظ Excel لأرقام طويلة كنص
function isScientific(s) {
  return /^\d(\.\d+)?[eE]\+?\d+$/.test(String(s == null ? "" : s).trim());
}

// قيمة خام لخلية Excel رقمية فقدت دقتها: فيها أس، أو أكثر من 15 رقمًا معنويًا
// (Excel لا يحفظ أكثر من 15 رقمًا، فالرقم السادس عشر وما بعده يكون قد تغيّر).
function hasPrecisionLoss(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (/[eE]/.test(s)) return true;
  const digits = s.replace(/^[-+]/, "").replace(".", "").replace(/^0+/, "");
  return /^\d+$/.test(digits) && digits.length > 15;
}

return { latinDigits, normalizeCell, normalizeKey, digitsOnly, firstNumber, lastNumber, editDistance, isScientific, hasPrecisionLoss };
});

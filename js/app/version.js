"use strict";
// رقم إصدار التطبيق — المصدر الوحيد. يُرفع مع كل نشر يغيّر ملفات التطبيق.
// تستخدمه: sw.js (اسم ذاكرة التخزين) و index.html (?v=) — ويتحقق اختبار app-shell من الاتساق.
(function (g) {
  const VERSION = 8;
  const T = (g.Tamim = g.Tamim || {});
  T.app = T.app || {};
  T.app.version = VERSION;
  if (typeof module === "object" && module.exports) module.exports = { version: VERSION };
})(typeof self !== "undefined" ? self : globalThis);

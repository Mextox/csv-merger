"use strict";
/* تسجيل Service Worker (ليس من file://) وإظهار شريط "يوجد إصدار جديد" — بلا إعادة تحميل تلقائية. */
(function () {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const bar = document.getElementById("updateBar");
  const btn = document.getElementById("updateBtn");
  // إعادة التحميل فقط بعد ضغط المستخدم زر التحديث — أول تثبيت يطلق controllerchange أيضًا
  // (بسبب clients.claim) ولا يجوز أن يعيد تحميل صفحة قد يكون المستخدم بدأ العمل فيها.
  let userRequested = false;
  let reloading = false;

  function offer(reg) {
    if (!reg.waiting) return;
    bar.hidden = false;
    btn.onclick = () => { userRequested = true; btn.disabled = true; reg.waiting.postMessage("skipWaiting"); };
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!userRequested || reloading) return;
    reloading = true;
    location.reload();
  });

  // updateViaCache: "none" — فحص التحديث يتجاوز ذاكرة HTTP لـ sw.js ولـ version.js المستورد فيه،
  // وإلا لا يُكتشف رفع رقم الإصدار حتى تنتهي صلاحية الذاكرة (10 دقائق على GitHub Pages).
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    offer(reg);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) offer(reg);
      });
    });
  }).catch(() => { /* بدون Service Worker تعمل الصفحة عاديًا (فقط لا تعمل بدون نت) */ });
})();

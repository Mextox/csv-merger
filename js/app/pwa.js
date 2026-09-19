"use strict";
/* تسجيل Service Worker (ليس من file://) وإظهار شريط "يوجد إصدار جديد" — بلا إعادة تحميل تلقائية. */
(function () {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const bar = document.getElementById("updateBar");
  const btn = document.getElementById("updateBtn");
  let reloading = false;

  function offer(reg) {
    if (!reg.waiting) return;
    bar.hidden = false;
    btn.onclick = () => { btn.disabled = true; reg.waiting.postMessage("skipWaiting"); };
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register("sw.js").then((reg) => {
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

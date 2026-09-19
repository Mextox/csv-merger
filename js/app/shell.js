"use strict";
/* التنقّل بين أدوات اللوحة عبر #/<المسار>. كل أداة عنصر <section class="view" data-view="..."> ورابط في الشريط الجانبي. */
(function () {
  const views = [...document.querySelectorAll(".view[data-view]")];
  const links = [...document.querySelectorAll(".nav a[data-route]")];
  const titleEl = document.getElementById("viewTitle");
  const sidebar = document.getElementById("sidebar");
  const DEFAULT = "home";

  function current() {
    const r = (location.hash || "").replace(/^#\/?/, "");
    return views.some((v) => v.dataset.view === r) ? r : DEFAULT;
  }

  function show() {
    const r = current();
    views.forEach((v) => { v.hidden = v.dataset.view !== r; });
    links.forEach((a) => a.classList.toggle("active", a.dataset.route === r));
    const link = links.find((a) => a.dataset.route === r);
    const label = link ? link.querySelector(".nav-label").textContent : "";
    titleEl.textContent = label;
    document.title = label ? `${label} — لوحة عمليات التميم` : "لوحة عمليات التميم";
    sidebar.classList.remove("open");
  }

  document.getElementById("menuBtn").addEventListener("click", () => sidebar.classList.toggle("open"));
  window.addEventListener("hashchange", show);
  show();
})();

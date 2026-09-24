"use strict";
/* مكوّنات واجهة مشتركة بين الأدوات: بناء العناصر، منطقة الإفلات، قائمة الفحوص، الحوارات، التنزيل. */
(function () {
  const T = (globalThis.Tamim = globalThis.Tamim || {});
  T.app = T.app || {};

  // el("div", { class: "x", text: "…", onclick: fn, dataset: {…}, attr: value }, ...children)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "value") node.value = v;
      else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected" || k === "multiple") node[k] = !!v;
      else node.setAttribute(k, v === true ? "" : v);
    });
    children.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " بايت";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " ك.ب";
    return (bytes / (1024 * 1024)).toFixed(1) + " م.ب";
  }

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // منطقة إفلات بنفس تصميم أداة الدمج. opts: { title, accept, onFiles(files[]), folder: bool }
  function dropzone(opts) {
    const input = el("input", { type: "file", accept: opts.accept || "", multiple: true, hidden: true });
    const folderInput = opts.folder ? el("input", { type: "file", hidden: true }) : null;
    if (folderInput) folderInput.setAttribute("webkitdirectory", "");
    const zone = el("section", { class: "dropzone", tabindex: "0", role: "button", "aria-label": opts.title },
      el("div", { class: "dz-icon", text: "📂" }),
      el("p", { class: "dz-title", text: opts.title }),
      el("p", { class: "dz-sub", text: opts.subtitle || "أو" }),
      el("div", { class: "dz-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "اختر الملفات", onclick: (e) => { e.stopPropagation(); input.click(); } }),
        opts.folder ? el("button", { type: "button", class: "btn btn-ghost", text: "اختر مجلدًا", onclick: (e) => { e.stopPropagation(); folderInput.click(); } }) : null),
      input, folderInput);
    const send = (list) => { const files = [...list]; if (files.length) opts.onFiles(files); };
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
    input.addEventListener("change", () => { send(input.files); input.value = ""; });
    if (folderInput) folderInput.addEventListener("change", () => { send(folderInput.files); folderInput.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("dragover"); }));
    zone.addEventListener("drop", (e) => send(e.dataTransfer.files));
    return zone;
  }

  const LEVEL_CLASS = { error: "error", warning: "warn", info: "info" };
  const LEVEL_LABEL = { error: "خطأ", warning: "تحذير", info: "ملاحظة" };

  // قائمة فحوص بنفس تصميم أداة الدمج — تعرض أول 20 رقم صف لكل فحص
  function issuesList(issues) {
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = issues.slice().sort((a, b) => order[a.level] - order[b.level]);
    return el("ul", { class: "issues-list" }, sorted.map((i) => {
      const rows = i.rows && i.rows.length
        ? ` — الصفوف: ${i.rows.slice(0, 20).join("، ")}${i.rows.length > 20 ? ` و${i.rows.length - 20} غيرها` : ""}`
        : "";
      return el("li", { class: `issue issue-${LEVEL_CLASS[i.level] || "info"}` },
        el("span", { class: "sev", text: LEVEL_LABEL[i.level] || i.level }),
        el("span", { text: i.message + rows }));
    }));
  }

  // حوار عام: dialog({ title, body: Node, actions: [{ label, value, kind }] }) → Promise(value)
  function dialog(opts) {
    return new Promise((resolve) => {
      const dlg = el("dialog", { class: "t-dialog" });
      const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(
        el("h3", { class: "t-dialog-title", text: opts.title || "" }),
        el("div", { class: "t-dialog-body" }, opts.body || null),
        el("div", { class: "t-dialog-actions" }, (opts.actions || [{ label: "حسنًا", value: true, kind: "primary" }]).map((a) =>
          el("button", { type: "button", class: `btn ${a.kind === "primary" ? "btn-primary" : "btn-ghost"}`, text: a.label, onclick: () => close(a.value) }))));
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
      document.body.appendChild(dlg);
      dlg.showModal();
      const first = dlg.querySelector("input, select, textarea");
      if (first) first.focus();
    });
  }

  function toast(message, kind) {
    const t = el("div", { class: `t-toast ${kind ? "t-toast-" + kind : ""}`, text: message, role: "status" });
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("t-toast-hide"), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  function today() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" : "") + n;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  T.app.ui = { el, clear, formatSize, download, dropzone, issuesList, dialog, toast, today };
})();

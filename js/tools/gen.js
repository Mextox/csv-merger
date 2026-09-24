"use strict";
/* توليد أكواد سرية جديدة — يقابل برنامج GEN. لا ملفات مدخلة: خطوتان فقط. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, download, toast } = T.app.ui;
  const { store } = T.app;
  const S = T.core.serials;
  const root = document.getElementById("genRoot");
  if (!root) return;

  const state = { length: 12, count: 100, batch: "", type: "digits", result: null, history: 0, error: "" };
  const hashOf = (code) => {
    const b = T.core.crypto.sha512(new TextEncoder().encode(code));
    return [...b.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join("");
  };

  async function loadHistory() {
    try { state.history = (await store.all("codes")).length; state.error = ""; }
    catch (e) { state.history = 0; state.error = e.message; }
  }

  async function run() {
    if (!state.batch.trim()) { toast("اكتب رقم الدفعة", "error"); return; }
    let known = new Set();
    try { known = new Set((await store.all("codes")).map((x) => x.id)); } catch (e) { /* بلا سجل: منع التكرار داخل الدفعة فقط */ }
    state.result = S.generateCodes({ length: state.length, count: state.count, type: state.type, batch: state.batch.trim(), date: new Date(), known, hashOf });
    if (!state.result.complete) toast(state.result.message, "error");
    render();
  }

  async function saveAndDownload() {
    const r = state.result;
    try {
      for (const key of r.newKeys) await store.put("codes", { id: key, at: new Date().toISOString() }, { keepMeta: true });
      await loadHistory();
    } catch (e) { toast("تعذّر حفظ السجل: " + e.message, "error"); }
    download(`codes-${state.batch.trim()}-${T.app.ui.today()}.csv`,
      T.core.csv.toCSV(["الرقم السري", "السيريال نمبر"], r.rows.map((x) => [x.code, x.serial]), ",") + "\r\n", "text/csv");
    toast("نُزّل الملف وحُفظت بصمات الأكواد", "ok");
  }

  const field = (label, control, hint) => el("label", { class: "t-field" }, el("span", { class: "t-field-label", text: label }), control, hint ? el("small", { class: "t-field-hint", text: hint }) : null);
  const txt = (v, on, attrs) => el("input", Object.assign({ type: "text", class: "t-input", value: String(v), oninput: (e) => on(e.target.value) }, attrs || {}));
  const num = (v, on) => txt(v, (x) => on(Math.max(1, parseInt(x, 10) || 0)), { dir: "ltr", inputmode: "numeric" });

  function render() {
    clear(root);
    root.appendChild(el("div", { class: "t-task-head" },
      el("h1", { class: "t-task-title", text: "توليد أكواد سرية جديدة" }),
      el("span", { class: "t-old-name", text: "يقابل برنامجك: GEN — مولّد أكواد الدفع المسبق" }),
      el("p", { class: "t-task-intro", text: "أكواد عشوائية بمستوى تشفيري، ولا تتكرر مع أي كود ولّدته من قبل على هذا الجهاز." })));

    root.appendChild(T.app.taskPage.step(1, "اكتب المطلوب", state.result ? "done" : "ready", el("div", {},
      state.error ? el("p", { class: "t-hint t-hint-error", text: `سجل الأكواد غير متاح: ${state.error}` }) : null,
      el("div", { class: "t-grid" },
        field("عدد الأكواد", num(state.count, (v) => { state.count = v; state.result = null; })),
        field("طول الكود", num(state.length, (v) => { state.length = v; state.result = null; })),
        field("رقم الدفعة", txt(state.batch, (v) => { state.batch = v; state.result = null; }, { dir: "ltr" }), "يدخل في بداية السيريال"),
        field("نوع الأكواد", el("select", { class: "t-select", onchange: (e) => { state.type = e.target.value; state.result = null; } },
          [["digits", "أرقام فقط"], ["letters", "أحرف فقط"], ["both", "أرقام وأحرف"]].map(([v, l]) => el("option", { value: v, selected: v === state.type, text: l }))))),
      el("p", { class: "t-hint", text: `في السجل الآن ${state.history} كود سابق لن يتكرر أي منها.` })),
    state.result ? `${state.result.rows.length} كود` : ""));

    root.appendChild(T.app.taskPage.step(2, state.result ? "النتيجة" : "ولّد الأكواد", state.result ? "done" : "ready",
      state.result
        ? el("div", { class: "t-step-result" },
          el("ul", { class: "t-summary" },
            el("li", { text: `${state.result.rows.length} كود بطول ${state.length}، برقم دفعة ${state.batch.trim()}.` }),
            el("li", { text: state.result.complete ? "كلها جديدة ولا تكرار." : state.result.message })),
          el("h4", { class: "t-out-title", text: "معاينة أول 5:" }),
          el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
            el("thead", {}, el("tr", {}, ["الرقم السري", "السيريال نمبر"].map((h) => el("th", { text: h })))),
            el("tbody", {}, state.result.rows.slice(0, 5).map((x) => el("tr", {}, el("td", { dir: "ltr", text: x.code }), el("td", { dir: "ltr", text: x.serial })))))),
          el("p", { class: "t-hint", text: "ملف واحد سيُنزَّل: عمود الرقم السري وعمود السيريال، مع صف عناوين — نفس ملف البرنامج القديم." }),
          el("div", { class: "split-actions" },
            el("button", { type: "button", class: "btn btn-primary btn-big", text: "⬇ تنزيل وحفظ في السجل", onclick: saveAndDownload }),
            el("button", { type: "button", class: "btn btn-ghost", text: "↺ توليد غيرها", onclick: () => { state.result = null; render(); } })))
        : el("div", { class: "split-actions" }, el("button", { type: "button", class: "btn btn-primary btn-big", text: "⚙ ولّد الأكواد", onclick: run }))));
  }

  loadHistory().then(render);
  render();
})();

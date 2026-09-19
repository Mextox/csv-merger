"use strict";
/* معالج شركة جديدة: من ملف مورد لا يطابق أي ملف إعداد ← تخمين الأعمدة ← معاينة ← ملف إعداد محفوظ.
 * الاستخدام: Tamim.tools.wizard.open({ name, source }) → Promise(profile | null) */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, dialog, toast } = T.app.ui;
  const { store } = T.app;
  const P = T.core.profiles, C = T.core.cards;
  const { normalizeKey, normalizeCell } = T.core.text;

  // كلمات التخمين بالأولوية (مطابقة جزئية على العناوين بعد التطبيع)
  const HINTS = {
    pin: ["الرقم السري", "رقم سري", "السري", "رمز الكارت", "الكود", "كود", "pin", "password", "secret", "redemption", "voucher code", "code"],
    serial: ["السيريال", "سيريال", "الرقم التسلسلي", "تسلسل", "serial", "s.n", "sn", "voucher id", "voucher name", "id"],
    category: ["الفئة", "فئة", "السعر", "القيمة", "صنف", "denomination", "value", "price", "category", "class", "face"],
  };

  function guess(headers) {
    const keys = headers.map(normalizeKey);
    const used = new Set();
    const out = {};
    ["pin", "serial", "category"].forEach((f) => {
      for (const h of HINTS[f]) {
        const i = keys.findIndex((k, j) => !used.has(j) && k !== "" && (k === h || k.includes(h)));
        if (i >= 0) { out[f] = i; used.add(i); return; }
      }
      out[f] = null;
    });
    return out;
  }

  function firstTable(source) {
    const sheet = (source.sheets || []).find((s) => s.rows.some((r) => r.some((c) => normalizeCell(c) !== "")));
    if (!sheet) return null;
    const info = P.fileInfo({ fileName: source.fileName, sheets: [sheet] });
    return { sheet, headers: info.headers };
  }

  // يبني ملف إعداد من اختيارات المعالج
  function draftProfile(st) {
    const p = P.defaultProfile();
    p.id = st.id;
    p.name = st.name.trim();
    p.input.header = st.headers ? "auto" : "no";
    const ref = (i) => ({ names: st.headers && st.headers[i] ? [st.headers[i]] : [], index: i });
    p.fields.pin = ref(st.pin);
    p.fields.serial = st.serialSameAsPin ? ref(st.pin) : ref(st.serial);
    if (st.serialSameAsPin) p.rules.push({ op: "copy", from: "pin", to: "serial" });
    if (st.catFrom === "column") {
      p.fields.category = Object.assign({ from: "column" }, ref(st.category));
      if (st.catDigits) p.rules.push({ op: "digitsOnly", field: "category" });
    } else if (st.catFrom === "fileName") p.fields.category = { from: "fileName", pick: "firstNumber" };
    else if (st.catFrom === "fixed") p.fields.category = { from: "fixed", value: st.catValue.trim() };
    else p.fields.category = { from: "ask" };
    p.company = st.companyAsk ? { from: "ask" } : { from: "fixed", value: st.company.trim() };
    p.output.fileName = st.companyAsk ? "{company}_{category}.csv" : `${st.company.trim() || "{company}"}_{category}.csv`;
    p.detect.headers = st.headers ? st.headers.filter((h) => h !== "") : [];
    p.expect.digitsOnly = st.digitsOnly;
    return p;
  }

  async function open(item) {
    const t = item.source ? firstTable(item.source) : null;
    if (!t) { toast("المعالج يعمل مع ملفات Excel وCSV ذات الجداول فقط.", "error"); return null; }
    const width = t.sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const g = t.headers ? guess(t.headers) : { pin: 1 < width ? 1 : 0, serial: 0, category: 2 < width ? 2 : null };
    const st = {
      id: store.newId(), name: "", company: "", companyAsk: false, headers: t.headers,
      pin: g.pin != null ? g.pin : 0, serial: g.serial != null ? g.serial : Math.min(1, width - 1), serialSameAsPin: false,
      category: g.category, catFrom: g.category != null ? "column" : "fileName", catDigits: true, catValue: "", digitsOnly: true,
    };
    const colOptions = [...Array(width).keys()].map((i) => [String(i), `${i + 1}: ${t.headers && t.headers[i] ? t.headers[i] : "عمود " + (i + 1)}`]);

    const preview = el("div", { class: "t-wiz-preview" });
    const errors = el("div");
    // ملف إعداد للمعاينة فقط: يملأ ما لم يُكتب بعد بعلامات ظاهرة بدل أن تفشل المعاينة
    function previewProfile() {
      const p = draftProfile(st);
      p.name = p.name || "معاينة";
      if (st.companyAsk) p.company = { from: "fixed", value: "(يُسأل)" };
      else if (!st.company.trim()) p.company = { from: "fixed", value: "?" };
      if (st.catFrom === "ask") p.fields.category = { from: "fixed", value: "(تُسأل)" };
      if (st.catFrom === "fixed" && !st.catValue.trim()) p.fields.category = { from: "fixed", value: "?" };
      return p;
    }
    function refresh() {
      clear(preview); clear(errors);
      const p = previewProfile();
      const v = P.validateProfile(p);
      if (!v.ok) { errors.appendChild(el("p", { class: "t-hint t-hint-error", text: v.errors.join("؛ ") })); return; }
      const r = P.applyProfile(p, { fileName: item.source.fileName, sheets: [t.sheet] }, {});
      preview.appendChild(el("p", { class: "align-hint", text: `معاينة أول 10 كروت من ${r.records.length} — الأعمدة كما ستُكتب في الملف الناتج:` }));
      preview.appendChild(el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
        el("thead", {}, el("tr", {}, ["السري", "السيريال", "الشركة", "الفئة (قبل الكود)"].map((h) => el("th", { text: h })))),
        el("tbody", {}, r.records.slice(0, 10).map((c) => el("tr", {}, [c.pin, c.serial, c.company, c.categoryRaw].map((v) => el("td", { dir: "ltr", text: v }))))))));
      const warn = C.checkCards(r.records.map((c) => Object.assign({}, c, { category: c.categoryRaw })), { serialFromPin: st.serialSameAsPin, digitsOnly: st.digitsOnly }).filter((i) => i.level !== "info");
      if (warn.length) preview.appendChild(T.app.ui.issuesList(warn.slice(0, 5)));
    }
    const sel = (value, onChange) => el("select", { class: "t-select", onchange: (e) => { onChange(e.target.value); refresh(); } },
      colOptions.map(([v, label]) => el("option", { value: v, selected: String(value) === v, text: label })));
    const row = (label, control) => el("label", { class: "t-field" }, el("span", { class: "t-field-label", text: label }), control);
    let catBox;
    const renderCat = () => {
      clear(catBox);
      if (st.catFrom === "column") {
        catBox.append(row("عمود الفئة", sel(st.category != null ? st.category : 0, (v) => { st.category = +v; })),
          el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", checked: st.catDigits, onchange: (e) => { st.catDigits = e.target.checked; refresh(); } }), " أخذ الأرقام فقط من الفئة (مثل \"10 LYD\" ← 10)"));
      } else if (st.catFrom === "fixed") {
        catBox.append(row("الفئة", el("input", { type: "text", class: "t-input", dir: "ltr", value: st.catValue, oninput: (e) => { st.catValue = e.target.value; refresh(); } })));
      }
    };
    catBox = el("div", { class: "t-grid" });
    renderCat();

    const body = el("div", { class: "t-wizard" },
      el("p", { class: "align-hint", text: `الملف: ${item.name}${t.sheet.sheetName ? ` — الورقة "${t.sheet.sheetName}"` : ""}. خمّنتُ الأعمدة من العناوين؛ صحّح ما يلزم وراقب المعاينة.` }),
      el("div", { class: "t-grid" },
        row("اسم الشركة (للعرض)", el("input", { type: "text", class: "t-input", value: st.name, oninput: (e) => { st.name = e.target.value; } })),
        row("كود الشركة (العمود الثالث)", el("input", { type: "text", class: "t-input", dir: "ltr", value: st.company, oninput: (e) => { st.company = e.target.value; refresh(); } })),
        el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", onchange: (e) => { st.companyAsk = e.target.checked; refresh(); } }), " يُسأل عن كود الشركة عند كل استيراد")),
      el("div", { class: "t-grid" },
        row("عمود الرقم السري", sel(st.pin, (v) => { st.pin = +v; })),
        row("عمود السيريال", sel(st.serial, (v) => { st.serial = +v; })),
        el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", onchange: (e) => { st.serialSameAsPin = e.target.checked; refresh(); } }), " السيريال هو نفس الرقم السري")),
      el("div", { class: "t-grid" },
        row("مصدر الفئة", el("select", { class: "t-select", onchange: (e) => { st.catFrom = e.target.value; renderCat(); refresh(); } },
          [["column", "عمود في الملف"], ["fileName", "أول رقم في اسم الملف"], ["fixed", "ثابتة"], ["ask", "تُسأل عند الاستيراد"]].map(([v, l]) => el("option", { value: v, selected: v === st.catFrom, text: l })))),
        el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", checked: st.digitsOnly, onchange: (e) => { st.digitsOnly = e.target.checked; refresh(); } }), " السري والسيريال أرقام فقط")),
      catBox, errors, preview);
    refresh();

    for (;;) {
      const ok = await dialog({ title: "شركة جديدة من هذا الملف", body, actions: [{ label: "💾 حفظ ملف الإعداد", value: true, kind: "primary" }, { label: "إلغاء", value: false }] });
      if (!ok) return null;
      const p = draftProfile(st);
      const v = P.validateProfile(p);
      if (v.ok) {
        const saved = await store.put("profiles", p);
        toast(`تم حفظ "${saved.name}" — سيُتعرَّف على ملفات هذه الشركة تلقائيًا`, "ok");
        return saved;
      }
      toast("أكمل الحقول: " + v.errors.join("؛ "), "error");
    }
  }

  T.tools = T.tools || {};
  T.tools.wizard = { open, guess, draftProfile };
})();

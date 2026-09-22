"use strict";
/* أداة الإعدادات: الجهاز، ملفات إعدادات الشركات (نموذج + JSON)، وحزمة الإعدادات للمشاركة بين الأجهزة. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, download, dialog, toast, today } = T.app.ui;
  const { store } = T.app;
  const P = T.core.profiles, SP = T.core.settingsPack;

  const root = document.getElementById("settingsRoot");
  if (!root) return;

  const state = { profiles: [], templates: [], device: "", persisted: false, editing: null, editingTemplate: null, packDiff: null, packInfo: null, error: "" };

  async function load() {
    try {
      state.profiles = (await store.all("profiles")).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      state.templates = (await store.all("templates")).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      state.device = (await store.meta("deviceName")) || "";
      state.persisted = await store.persisted();
      state.error = "";
    } catch (e) {
      state.error = e.message;
    }
  }

  /* ---------- أدوات النموذج ---------- */

  const listToText = (a) => (a || []).join("، ");
  const textToList = (s) => String(s || "").split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
  const mapToText = (m) => Object.entries(m || {}).map(([k, v]) => `${k} = ${v}`).join("\n");
  function textToMap(s) {
    const out = {};
    String(s || "").split("\n").forEach((line) => {
      const i = line.indexOf("=");
      if (i < 0) return;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }
  const idxToText = (i) => (Number.isInteger(i) ? String(i + 1) : "");
  const textToIdx = (s) => { const n = parseInt(String(s).trim(), 10); return Number.isInteger(n) && n > 0 ? n - 1 : null; };

  function field(label, control, hint) {
    return el("label", { class: "t-field" }, el("span", { class: "t-field-label", text: label }), control, hint ? el("small", { class: "t-field-hint", text: hint }) : null);
  }
  function input(value, onInput, attrs) {
    return el("input", Object.assign({ type: "text", class: "t-input", value: value == null ? "" : value, oninput: (e) => onInput(e.target.value) }, attrs || {}));
  }
  function textarea(value, onInput, rows) {
    return el("textarea", { class: "t-input t-textarea", rows: rows || 3, dir: "auto", oninput: (e) => onInput(e.target.value) }, value || "");
  }
  function select(value, options, onChange) {
    return el("select", { class: "t-select", onchange: (e) => onChange(e.target.value) },
      options.map(([v, label]) => el("option", { value: v, selected: v === value, text: label })));
  }
  function checkbox(value, label, onChange) {
    return el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", checked: !!value, onchange: (e) => onChange(e.target.checked) }), " " + label);
  }
  function colRefFields(ref, label) {
    return el("div", { class: "t-grid" },
      field(`${label} — أسماء العمود`, input(listToText(ref.names), (v) => { ref.names = textToList(v); }), "أسماء بديلة مفصولة بفاصلة، تُطابَق أولًا"),
      field(`${label} — رقم العمود`, input(idxToText(ref.index), (v) => { ref.index = textToIdx(v); }, { dir: "ltr", inputmode: "numeric" }), "يبدأ من 1 — يُستخدم إن لم يطابق أي اسم"));
  }

  /* ---------- محرّر ملف الإعداد ---------- */

  const RULE_OPS = [
    ["fillDown", "تعبئة الفراغ من الخلية التي فوقها"],
    ["digitsOnly", "الأرقام فقط"],
    ["padStart", "إكمال بأصفار من اليسار"],
    ["concat", "دمج حقول في حقل"],
    ["copy", "نسخ حقل إلى آخر"],
    ["replace", "استبدال نص"],
    ["map", "جدول تحويل"],
    ["prefixIf", "بادئة حسب اسم الملف"],
  ];
  const FIELD_OPTS = [["pin", "الرقم السري"], ["serial", "السيريال"], ["category", "الفئة"]];

  function newRule(op) {
    const base = { op, field: "category" };
    if (op === "padStart") return { op, field: "serial", length: 7 };
    if (op === "concat") return { op, target: "pin", parts: [{ field: "serial" }, { field: "pin" }] };
    if (op === "copy") return { op, from: "pin", to: "serial" };
    if (op === "replace") return { op, field: "pin", find: "", with: "" };
    if (op === "map") return { op, field: "category", table: {}, strict: false };
    if (op === "prefixIf") return { op, field: "category", value: "h", fileNameContains: [] };
    return base;
  }

  function ruleParams(r, rerender) {
    const f = (key, label) => field(label, select(r[key], FIELD_OPTS, (v) => { r[key] = v; }));
    switch (r.op) {
      case "fillDown": case "digitsOnly": return [f("field", "الحقل")];
      case "padStart": return [f("field", "الحقل"), field("الطول", input(String(r.length || ""), (v) => { r.length = parseInt(v, 10) || 0; }, { dir: "ltr" }))];
      case "copy": return [f("from", "من"), f("to", "إلى")];
      case "replace": return [f("field", "الحقل"), field("ابحث عن", input(r.find, (v) => { r.find = v; }, { dir: "ltr" })), field("استبدل بـ", input(r.with, (v) => { r.with = v; }, { dir: "ltr" }))];
      case "map": return [f("field", "الحقل"), field("الجدول (قيمة = بديل، سطر لكل قيمة)", textarea(mapToText(r.table), (v) => { r.table = textToMap(v); }, 3)), checkbox(r.strict, "صارم: القيمة غير الموجودة خطأ", (v) => { r.strict = v; })];
      case "prefixIf": return [f("field", "الحقل"), field("البادئة", input(r.value, (v) => { r.value = v; }, { dir: "ltr" })), field("إذا احتوى اسم الملف على", input(listToText(r.fileNameContains), (v) => { r.fileNameContains = textToList(v); }))];
      case "concat": return [
        f("target", "النتيجة في"),
        field("الأجزاء (حقل:طول، مثال serial:7، pin:6)", input(r.parts.map((p) => p.field + (p.padStart ? ":" + p.padStart : "")).join("، "), (v) => {
          r.parts = textToList(v).map((s) => { const [fld, len] = s.split(":").map((x) => x.trim()); const o = { field: fld }; if (parseInt(len, 10) > 0) o.padStart = parseInt(len, 10); return o; });
        }, { dir: "ltr" })),
      ];
      default: return [el("span", { class: "t-hint t-hint-error", text: `عملية غير معروفة: ${r.op}` })];
    }
  }

  function editorView() {
    const m = state.editing.model;
    const rerender = () => render();
    const errors = state.editing.errors || [];

    const companyBox = el("div", {},
      field("مصدر كود الشركة", select(m.company.from, [["fixed", "ثابت"], ["ask", "يُسأل عند الاستيراد"], ["column", "من عمود في الملف"], ["sheetName", "من اسم ورقة Excel"]], (v) => {
        m.company = v === "fixed" ? { from: v, value: "" } : v === "ask" ? { from: v } : v === "column" ? { from: v, names: [], index: null } : { from: v, map: {}, fuzzy: true };
        rerender();
      })),
      m.company.from === "fixed" ? field("كود الشركة (العمود الثالث)", input(m.company.value, (v) => { m.company.value = v; }, { dir: "ltr" })) : null,
      m.company.from === "column" ? colRefFields(m.company, "عمود الشركة") : null,
      m.company.from === "column" || m.company.from === "sheetName"
        ? field("جدول الأكواد (اسم = كود، سطر لكل شركة)", textarea(mapToText(m.company.map), (v) => { m.company.map = textToMap(v); }, 4), m.company.from === "sheetName" ? "تُطابَق الكلمة الأولى من اسم الورقة" : "اتركه فارغًا لاستخدام القيمة كما هي")
        : null,
      m.company.from === "sheetName" ? checkbox(m.company.fuzzy, "قبول أقرب تهجئة (تصحيح الأخطاء الإملائية)", (v) => { m.company.fuzzy = v; }) : null);

    const cat = m.fields.category;
    const categoryBox = el("div", {},
      field("مصدر الفئة", select(cat.from, [["column", "عمود في الملف"], ["fileName", "من اسم الملف"], ["sheetName", "من اسم الورقة"], ["batchHeader", "من رأس ملف Batch"], ["fixed", "ثابتة"], ["ask", "تُسأل عند الاستيراد"]], (v) => {
        m.fields.category = v === "column" ? { from: v, names: [], index: null } : v === "fileName" || v === "sheetName" ? { from: v, pick: "firstNumber" } : v === "batchHeader" ? { from: v, key: "FaceValue" } : v === "fixed" ? { from: v, value: "" } : { from: v };
        rerender();
      })),
      cat.from === "column" ? colRefFields(cat, "الفئة") : null,
      cat.from === "fileName" || cat.from === "sheetName" ? field("أي رقم", select(cat.pick, [["firstNumber", "أول رقم"], ["lastNumber", "آخر رقم"]], (v) => { cat.pick = v; })) : null,
      cat.from === "batchHeader" ? field("المفتاح في رأس الملف", input(cat.key, (v) => { cat.key = v; }, { dir: "ltr" })) : null,
      cat.from === "fixed" ? field("قيمة الفئة", input(cat.value, (v) => { cat.value = v; }, { dir: "ltr" })) : null);

    const rulesBox = el("div", { class: "t-rules" },
      m.rules.map((r, i) => el("div", { class: "t-rule" },
        el("div", { class: "t-rule-head" },
          el("b", { text: `${i + 1}.` }),
          select(r.op, RULE_OPS, (v) => { m.rules[i] = newRule(v); rerender(); }),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "↑", disabled: i === 0, onclick: () => { m.rules.splice(i - 1, 0, m.rules.splice(i, 1)[0]); rerender(); } }),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "↓", disabled: i === m.rules.length - 1, onclick: () => { m.rules.splice(i + 1, 0, m.rules.splice(i, 1)[0]); rerender(); } }),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "✕", onclick: () => { m.rules.splice(i, 1); rerender(); } })),
        el("div", { class: "t-grid" }, ruleParams(r, rerender)))),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ إضافة قاعدة", onclick: () => { m.rules.push(newRule("digitsOnly")); rerender(); } }));

    const o = m.output;
    const outBox = el("div", { class: "t-grid" },
      field("ترتيب الأعمدة", select(o.columns.join(","), [["pin,serial,company,category", "السري، السيريال، الشركة، الفئة"], ["serial,pin,company,category", "السيريال، السري، الشركة، الفئة"]].concat(
        ["pin,serial,company,category", "serial,pin,company,category"].includes(o.columns.join(",")) ? [] : [[o.columns.join(","), o.columns.join("، ")]]), (v) => { o.columns = v.split(","); })),
      field("نمط اسم الملف", input(o.fileName, (v) => { o.fileName = v; }, { dir: "ltr" }), "متغيرات: {company} {category} {categoryRaw} {part} {source} {sourceNumber} {date}"),
      field("التجميع", select(o.groupBy, [["category", "ملف لكل فئة"], ["none", "ملف واحد لكل شركة"]], (v) => { o.groupBy = v; })),
      field("حجم الجزء (0 = بلا تقسيم)", input(String(o.chunkSize), (v) => { o.chunkSize = Math.max(0, parseInt(v, 10) || 0); }, { dir: "ltr", inputmode: "numeric" })),
      field("الفاصل", select(o.delimiter, [[",", "فاصلة ,"], [";", "فاصلة منقوطة ;"], ["\t", "Tab"], ["|", "|"]], (v) => { o.delimiter = v; })),
      field("نهاية السطر", select(o.lineEnding, [["\r\n", "Windows (CRLF)"], ["\n", "Unix (LF)"]], (v) => { o.lineEnding = v; })),
      checkbox(o.bom, "إضافة BOM (لفتح الملف في Excel)", (v) => { o.bom = v; }),
      checkbox(o.header, "إضافة صف عناوين", (v) => { o.header = v; }));

    const jsonArea = el("textarea", { class: "t-input t-textarea t-json", rows: 14, dir: "ltr", spellcheck: "false" }, JSON.stringify(m, null, 2));

    return el("section", { class: "card t-editor" },
      el("div", { class: "card-head" },
        el("h2", { text: state.editing.isNew ? "ملف إعداد جديد" : `تعديل: ${m.name}` }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "← رجوع", onclick: () => { state.editing = null; render(); } })),
      errors.length ? el("ul", { class: "issues-list" }, errors.map((e) => el("li", { class: "issue issue-error" }, el("span", { class: "sev", text: "خطأ" }), el("span", { text: e })))) : null,
      el("h3", { class: "t-sub", text: "الأساسيات" }),
      el("div", { class: "t-grid" }, field("اسم ملف الإعداد", input(m.name, (v) => { m.name = v; }))),
      companyBox,
      el("h3", { class: "t-sub", text: "الملف المصدر" }),
      el("div", { class: "t-grid" },
        field("النوع", select(m.input.format, [["table", "Excel أو CSV"], ["batchTxt", "TXT من نوع Batch ([BEGIN]/[END])"]], (v) => { m.input.format = v; rerender(); })),
        m.input.format === "table" ? field("الأوراق", select(m.input.sheets, [["all", "كل الأوراق"], ["first", "الورقة الأولى فقط"]], (v) => { m.input.sheets = v; })) : null,
        m.input.format === "table" ? field("صف العناوين", select(m.input.header, [["auto", "اكتشاف تلقائي"], ["yes", "موجود"], ["no", "غير موجود"]], (v) => { m.input.header = v; })) : null,
        m.input.format === "table" ? field("فاصل CSV", select(m.input.delimiter, [["auto", "تلقائي"], [",", ","], [";", ";"], ["\t", "Tab"], ["|", "|"]], (v) => { m.input.delimiter = v; })) : null,
        m.input.format === "table" ? field("تجاهل الأوراق التي يحتوي اسمها على", input(listToText(m.input.skipSheets), (v) => { m.input.skipSheets = textToList(v); })) : null),
      el("h3", { class: "t-sub", text: "الأعمدة" }),
      colRefFields(m.fields.pin, "الرقم السري"),
      colRefFields(m.fields.serial, "السيريال"),
      categoryBox,
      el("h3", { class: "t-sub", text: "القواعد (تُطبَّق بالترتيب)" }),
      rulesBox,
      el("h3", { class: "t-sub", text: "أكواد الفئات" }),
      field("الفئة كما في الملف = كود الفئة (سطر لكل فئة)", textarea(mapToText(m.categoryCodes), (v) => { m.categoryCodes = textToMap(v); }, 4), "تُضاف تلقائيًا عند تأكيدها أثناء الاستيراد"),
      el("h3", { class: "t-sub", text: "الإخراج" }),
      outBox,
      el("h3", { class: "t-sub", text: "التعرّف التلقائي" }),
      el("div", { class: "t-grid" },
        field("عناوين الأعمدة المميزة", input(listToText(m.detect.headers), (v) => { m.detect.headers = textToList(v); })),
        field("كلمات في اسم الملف", input(listToText(m.detect.fileName), (v) => { m.detect.fileName = textToList(v); })),
        field("كلمات في أسماء الأوراق", input(listToText(m.detect.sheetNames), (v) => { m.detect.sheetNames = textToList(v); }))),
      checkbox(m.expect && m.expect.digitsOnly, "السري والسيريال أرقام فقط (تحذير عند وجود حروف)", (v) => { m.expect = Object.assign({}, m.expect, { digitsOnly: v }); }),
      el("details", { class: "t-advanced" },
        el("summary", { text: "متقدم: تعديل JSON مباشرة" }),
        jsonArea,
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "تطبيق JSON على النموذج", onclick: () => {
          try {
            const parsed = JSON.parse(jsonArea.value);
            state.editing.model = Object.assign(P.defaultProfile(), parsed, { id: m.id });
            state.editing.errors = P.validateProfile(state.editing.model).errors;
            rerender();
          } catch (e) { toast("JSON غير صالح: " + e.message, "error"); }
        } })),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "💾 حفظ", onclick: saveEditing }),
        el("button", { type: "button", class: "btn btn-ghost", text: "إلغاء", onclick: () => { state.editing = null; render(); } })));
  }

  async function saveEditing() {
    const m = state.editing.model;
    const v = P.validateProfile(m);
    if (!v.ok) { state.editing.errors = v.errors; render(); root.scrollIntoView({ behavior: "smooth" }); return; }
    try {
      await store.put("profiles", m);
      toast("تم حفظ ملف الإعداد", "ok");
      state.editing = null;
      await load();
      render();
    } catch (e) { toast("تعذّر الحفظ: " + e.message, "error"); }
  }

  function startEdit(profile, isNew) {
    const model = Object.assign(P.defaultProfile(), JSON.parse(JSON.stringify(profile)));
    state.editing = { model, isNew, errors: [] };
    render();
    root.scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- القوالب: تمبلت الأكواد (تقسيم الكروت) وقالب التصدير (Batch) ---------- */

  function newTemplate(kind) {
    return kind === "codes"
      ? { id: store.newId(), kind: "codes", name: "", code: "", categories: [{ name: "", code: "" }] }
      : { id: store.newId(), kind: "batch", name: "", code: "", start: "", end: "[END]" };
  }

  function validateTemplate(t) {
    const errors = [];
    if (!t.name.trim()) errors.push("الاسم مطلوب");
    if (!String(t.code).trim()) errors.push(t.kind === "codes" ? "كود التمبلت (العمود الثالث) مطلوب" : "كود الفئة مطلوب");
    if (t.kind === "codes") {
      const cats = (t.categories || []).filter((c) => c.name.trim() || String(c.code).trim());
      if (!cats.length) errors.push("أضف فئة واحدة على الأقل");
      cats.forEach((c, i) => { if (!c.name.trim() || !String(c.code).trim()) errors.push(`الفئة ${i + 1}: الاسم والكود مطلوبان`); });
    } else if (!t.start.trim()) errors.push("نص رأس القالب مطلوب");
    return errors;
  }

  function templateEditor() {
    const t = state.editingTemplate.model;
    const errors = state.editingTemplate.errors || [];
    const cats = t.kind === "codes"
      ? el("div", { class: "t-rules" },
        t.categories.map((c, i) => el("div", { class: "t-rule" }, el("div", { class: "t-grid" },
          field("اسم الفئة", input(c.name, (v) => { c.name = v; })),
          field("كود الفئة (العمود الرابع)", input(c.code, (v) => { c.code = v; }, { dir: "ltr" })),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "✕ حذف الفئة", onclick: () => { t.categories.splice(i, 1); render(); } })))),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ إضافة فئة", onclick: () => { t.categories.push({ name: "", code: "" }); render(); } }))
      : null;
    return el("section", { class: "card t-editor" },
      el("div", { class: "card-head" },
        el("h2", { text: t.kind === "codes" ? "تمبلت أكواد (تقسيم الكروت)" : "قالب تصدير Batch" }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "← رجوع", onclick: () => { state.editingTemplate = null; render(); } })),
      errors.length ? el("ul", { class: "issues-list" }, errors.map((e) => el("li", { class: "issue issue-error" }, el("span", { class: "sev", text: "خطأ" }), el("span", { text: e })))) : null,
      el("div", { class: "t-grid" },
        field("الاسم", input(t.name, (v) => { t.name = v; })),
        field(t.kind === "codes" ? "كود التمبلت (العمود الثالث)" : "كود الفئة (العمود الرابع في ملف الكروت)", input(t.code, (v) => { t.code = v; }, { dir: "ltr" }))),
      cats,
      t.kind === "batch" ? el("div", {},
        field("نص الرأس (قبل الكروت)", textarea(t.start, (v) => { t.start = v; }, 8), "انسخه كما هو من ملف المورد، وينتهي عادة بسطر [BEGIN]"),
        field("نص الذيل", textarea(t.end, (v) => { t.end = v; }, 2))) : null,
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "💾 حفظ", onclick: async () => {
          const errs = validateTemplate(t);
          if (errs.length) { state.editingTemplate.errors = errs; render(); return; }
          if (t.kind === "codes") t.categories = t.categories.filter((c) => c.name.trim());
          await store.put("templates", t);
          toast("تم حفظ القالب", "ok");
          state.editingTemplate = null;
          await load();
          render();
        } }),
        el("button", { type: "button", class: "btn btn-ghost", text: "إلغاء", onclick: () => { state.editingTemplate = null; render(); } })));
  }

  function templatesCard() {
    return el("section", { class: "card" },
      el("div", { class: "card-head" },
        el("h2", {}, "القوالب ", el("span", { class: "count-badge", text: String(state.templates.length) })),
        el("div", { class: "head-actions" },
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ تمبلت أكواد", onclick: () => { state.editingTemplate = { model: newTemplate("codes"), errors: [] }; render(); } }),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ قالب تصدير", onclick: () => { state.editingTemplate = { model: newTemplate("batch"), errors: [] }; render(); } }))),
      el("p", { class: "align-hint", text: "تمبلت الأكواد يضيف كود الشركة وكود الفئة عند تقسيم الكروت. وقالب التصدير هو رأس وذيل ملف Batch الذي يطلبه المورد." }),
      state.templates.length === 0 ? el("p", { class: "align-hint", text: "لا توجد قوالب بعد." })
        : el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الاسم", "النوع", "الكود", "التفاصيل", "آخر تعديل", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, state.templates.map((t) => el("tr", {},
            el("td", {}, el("bdi", { text: t.name })),
            el("td", { text: t.kind === "codes" ? "أكواد" : "تصدير Batch" }),
            el("td", { dir: "ltr", text: String(t.code) }),
            el("td", { text: t.kind === "codes" ? `${(t.categories || []).length} فئة` : `${(t.start || "").split("\n").length} سطر رأس` }),
            el("td", { text: `${t.updatedBy || ""} ${fmtDate(t.updatedAt)}` }),
            el("td", { class: "t-actions" },
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "تعديل", onclick: () => { state.editingTemplate = { model: JSON.parse(JSON.stringify(t)), errors: [] }; render(); } }),
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "حذف", onclick: async () => {
                const ok = await dialog({ title: "حذف القالب", body: el("p", { text: `حذف "${t.name}" من هذا الجهاز؟` }), actions: [{ label: "حذف", value: true, kind: "primary" }, { label: "إلغاء", value: false }] });
                if (!ok) return;
                await store.remove("templates", t.id);
                await load();
                render();
              } }))))))));
  }

  /* ---------- حزمة الإعدادات ---------- */

  async function exportPack() {
    const now = new Date().toISOString();
    const pack = SP.makePack({ device: state.device, now, stores: { profiles: state.profiles, templates: state.templates } });
    const safe = (state.device || "جهاز").replace(/[\/\\:*?"<>|\s]+/g, "-");
    download(`tamim-settings-${safe}-${today()}.json`, JSON.stringify(pack, null, 2), "application/json");
    await store.setMeta("lastBackupAt", now);
    toast("تم تصدير حزمة الإعدادات", "ok");
  }

  async function readPack(file) {
    const text = await file.text();
    const parsed = SP.parsePack(text);
    if (!parsed.ok) { state.packDiff = null; state.packInfo = { error: parsed.error }; render(); return; }
    const diff = SP.diffPack({ profiles: state.profiles, templates: state.templates }, parsed.pack);
    diff.forEach((d) => {
      if (d.store === "profiles") {
        const v = P.validateProfile(d.incoming);
        if (!v.ok) { d.invalid = v.errors; d.apply = false; }
      } else if (d.store === "templates") {
        const errs = validateTemplate(Object.assign({ kind: "codes", categories: [], start: "", end: "" }, d.incoming));
        if (errs.length) { d.invalid = errs; d.apply = false; }
      } else { d.unknown = true; d.apply = false; }
    });
    state.packDiff = diff;
    state.packInfo = { device: parsed.pack.device, exportedAt: parsed.pack.exportedAt, fileName: file.name };
    render();
  }

  async function applyPack() {
    const items = SP.itemsToApply(state.packDiff.filter((d) => !d.invalid && !d.unknown));
    for (const { store: s, item } of items) await store.put(s, item, { keepMeta: true });
    toast(`تم تطبيق ${items.length} عنصر`, "ok");
    state.packDiff = null;
    state.packInfo = null;
    await load();
    render();
  }

  const STATUS = { new: "جديد", same: "مطابق", incomingNewer: "الوارد أحدث", localNewer: "المحلي أحدث أو مساوٍ" };
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("ar"); };

  function packView() {
    const info = state.packInfo;
    if (!info) return null;
    if (info.error) return el("p", { class: "t-hint t-hint-error", text: info.error });
    const d = state.packDiff;
    return el("div", { class: "t-pack" },
      el("p", { class: "align-hint", text: `الحزمة "${info.fileName}" من الجهاز "${info.device || "?"}" (${fmtDate(info.exportedAt)}). راجع ما سيُطبَّق — لن يُحذف أي شيء من هذا الجهاز.` }),
      el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
        el("thead", {}, el("tr", {}, ["تطبيق", "الاسم", "الحالة", "الفرق", "الوارد", "الموجود هنا"].map((h) => el("th", { text: h })))),
        el("tbody", {}, d.map((e) => el("tr", { class: e.invalid ? "t-row-bad" : "" },
          el("td", {}, el("input", { type: "checkbox", checked: e.apply, disabled: e.status === "same" || !!e.invalid || !!e.unknown, onchange: (ev) => { e.apply = ev.target.checked; } })),
          el("td", {}, el("bdi", { text: e.name })),
          el("td", { text: e.invalid ? `غير صالح: ${e.invalid[0]}` : e.unknown ? "نوع غير معروف لهذه النسخة" : STATUS[e.status] }),
          el("td", { text: e.fields.join("، ") || "—" }),
          el("td", { text: `${e.incoming.updatedBy || ""} ${fmtDate(e.incoming.updatedAt)}` }),
          el("td", { text: e.local ? `${e.local.updatedBy || ""} ${fmtDate(e.local.updatedAt)}` : "—" })))))),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "تطبيق المحدد", onclick: applyPack }),
        el("button", { type: "button", class: "btn btn-ghost", text: "إلغاء", onclick: () => { state.packDiff = null; state.packInfo = null; render(); } })));
  }

  /* ---------- التصيير ---------- */

  function render() {
    clear(root);
    if (state.error) root.appendChild(el("p", { class: "t-hint t-hint-error", text: `تعذّر الوصول إلى الحفظ المحلي: ${state.error}` }));
    if (state.editing) { root.appendChild(editorView()); return; }
    if (state.editingTemplate) { root.appendChild(templateEditor()); return; }

    let deviceInput;
    root.appendChild(el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "هذا الجهاز" })),
      el("div", { class: "t-grid" },
        field("اسم الجهاز", deviceInput = input(state.device, () => {}), "يظهر مع كل تعديل وفي اسم ملف حزمة الإعدادات"),
        el("div", { class: "t-field" },
          el("span", { class: "t-field-label", text: "الحفظ الدائم" }),
          el("span", { class: state.persisted ? "flag flag-ok" : "flag flag-warn", text: state.persisted ? "مفعّل — لن يمسح المتصفح الإعدادات" : "غير مفعّل" }),
          state.persisted ? null : el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "طلب الحفظ الدائم", onclick: async () => { state.persisted = await store.persist(); render(); } }))),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary btn-sm", text: "حفظ اسم الجهاز", onclick: async () => {
          const v = deviceInput.value.trim();
          if (!v) { toast("اكتب اسمًا للجهاز", "error"); return; }
          await store.setMeta("deviceName", v);
          state.device = v;
          toast("تم الحفظ", "ok");
        } }))));

    root.appendChild(el("section", { class: "card" },
      el("div", { class: "card-head" },
        el("h2", {}, "ملفات إعدادات الشركات ", el("span", { class: "count-badge", text: String(state.profiles.length) })),
        el("button", { type: "button", class: "btn btn-primary btn-sm", text: "+ ملف إعداد جديد", onclick: () => startEdit(Object.assign(P.defaultProfile(), { id: store.newId() }), true) })),
      state.profiles.length === 0
        ? el("p", { class: "align-hint", text: "لا توجد ملفات إعداد بعد. أنشئ واحدًا، أو استورد حزمة الإعدادات من جهاز آخر أدناه." })
        : el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الاسم", "كود الشركة", "المصدر", "آخر تعديل", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, state.profiles.map((p) => el("tr", {},
            el("td", {}, el("bdi", { text: p.name })),
            el("td", { dir: "ltr", text: p.company.from === "fixed" ? p.company.value : { ask: "يُسأل", column: "عمود", sheetName: "اسم الورقة" }[p.company.from] }),
            el("td", { text: p.input.format === "batchTxt" ? "TXT Batch" : "Excel/CSV" }),
            el("td", { text: `${p.updatedBy || ""} ${fmtDate(p.updatedAt)}` }),
            el("td", { class: "t-actions" },
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "تعديل", onclick: () => startEdit(p, false) }),
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "نسخ", onclick: () => startEdit(Object.assign(JSON.parse(JSON.stringify(p)), { id: store.newId(), name: p.name + " (نسخة)" }), true) }),
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "حذف", onclick: async () => {
                const ok = await dialog({ title: "حذف ملف الإعداد", body: el("p", { text: `هل تريد حذف "${p.name}" من هذا الجهاز؟ لن يُحذف من الأجهزة الأخرى.` }), actions: [{ label: "حذف", value: true, kind: "primary" }, { label: "إلغاء", value: false }] });
                if (!ok) return;
                await store.remove("profiles", p.id);
                await load();
                render();
              } })))))))));

    root.appendChild(templatesCard());

    const packInput = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: (e) => { if (e.target.files[0]) readPack(e.target.files[0]); e.target.value = ""; } });
    root.appendChild(el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "حزمة الإعدادات (النسخ الاحتياطي والمشاركة)" })),
      el("p", { class: "align-hint", text: "صدّر ملف الإعدادات لحفظ نسخة احتياطية أو لنقله إلى جهاز آخر، ثم استورده هناك. الكروت لا تُحفظ في هذا الملف أبدًا." }),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "⬇ تصدير الحزمة", disabled: state.profiles.length === 0 && state.templates.length === 0, onclick: exportPack }),
        el("button", { type: "button", class: "btn btn-ghost", text: "⬆ استيراد حزمة", onclick: () => packInput.click() }),
        packInput),
      packView()));
  }

  store.on((s) => { if (!state.editing && !state.editingTemplate && (s === "profiles" || s === "templates" || s === "meta")) load().then(render); });
  load().then(render);
  render();
})();

"use strict";
/* أداة استيراد كروت المورد: ملفات المورد ← ملف الإعداد المناسب ← الكرت الموحد ← الفحوص ← ملفات الإخراج.
 * كل منطق التحويل في Tamim.core (profiles/cards)؛ هذا الملف واجهة فقط. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, formatSize, download, dropzone, issuesList, dialog, toast, today } = T.app.ui;
  const { store, workspace } = T.app;
  const P = T.core.profiles, C = T.core.cards;

  const root = document.getElementById("importRoot");
  if (!root) return;

  const state = { files: [], profiles: [], storeError: "", result: null, ack: false, answers: {} };
  let seq = 0;

  /* ---------- ملفات الإعداد ---------- */

  async function loadProfiles() {
    try {
      state.profiles = (await store.all("profiles")).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      state.storeError = "";
      state.answers = (await store.meta("lastAnswers")) || {};
    } catch (e) {
      state.profiles = [];
      state.storeError = e.message;
    }
  }
  const profileById = (id) => state.profiles.find((p) => p.id === id) || null;

  /* ---------- قراءة الملفات ---------- */

  const looksBatch = (text) => /^\s*\[BEGIN\]\s*$/m.test(text);

  // كلمة سر ملف Excel محمي: تُطلب لكل ملف، وتبقى في الذاكرة لحظة فك التشفير فقط ولا تُحفظ.
  async function askPassword(fileName, retry) {
    const input = el("input", { type: "password", class: "t-input", dir: "ltr", autocomplete: "off" });
    const body = el("div", {},
      el("p", {}, "الملف ", el("bdi", { text: fileName }), " محمي بكلمة سر. أدخلها لفتحه — لا تُحفظ كلمة السر في أي مكان."),
      retry ? el("p", { class: "t-hint t-hint-error", text: "كلمة السر غير صحيحة، حاول مرة أخرى." }) : null,
      input);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const b = input.closest("dialog").querySelector(".btn-primary"); if (b) b.click(); } });
    const ok = await dialog({ title: "ملف محمي بكلمة سر", body, actions: [{ label: "فتح", value: true, kind: "primary" }, { label: "إلغاء", value: false }] });
    return ok ? input.value : null;
  }

  // يقرأ ملف Excel: عادي، أو محمي بكلمة سر (يُفك في المتصفح)، أو صيغة غير مدعومة برسالة واضحة.
  async function readExcelSheets(fileName, bytes) {
    const XC = T.core.xlsxCrypt;
    const kind = XC.inspectOle(bytes).kind;
    if (kind === "not-ole") return await T.core.xlsx.parseXlsx(bytes);
    if (kind !== "encrypted-agile") return XC.decryptXlsx(bytes, ""); // يرمي رسالة الصيغة غير المدعومة
    for (let attempt = 0; attempt < 3; attempt++) {
      const pw = await askPassword(fileName, attempt > 0);
      if (pw == null) throw Object.assign(new Error("password cancelled"), { arMessage: "الملف محمي بكلمة سر ولم تُدخل — أزل الملف أو أعد إضافته لإدخالها." });
      try {
        return await T.core.xlsx.parseXlsx(XC.decryptXlsx(bytes, pw));
      } catch (e) {
        if (e.code !== "BADPASSWORD") throw e;
      }
    }
    throw Object.assign(new Error("bad password"), { arMessage: "كلمة السر غير صحيحة بعد ثلاث محاولات." });
  }

  async function readFile(f) {
    const item = { id: ++seq, name: f.name, size: f.size, profileId: "", userPicked: false, answers: {}, error: "" };
    const lower = f.name.toLowerCase();
    try {
      if (/\.(xlsx|xlsm|xls)$/.test(lower)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        item.source = { fileName: f.name, sheets: await readExcelSheets(f.name, bytes) };
      } else if (/\.(csv|txt)$/.test(lower)) {
        item.text = (await T.core.csv.readFileSmart(f)).text;
        if (looksBatch(item.text)) item.batch = T.core.batchtxt.parseBatchTxt(item.text);
      } else {
        item.error = "صيغة غير مدعومة — الملفات المقبولة: xlsx، xlsm، csv، txt.";
        return item;
      }
      item.info = item.batch ? { fileName: f.name, headers: null, sheetNames: [] } : P.fileInfo(sourceFor(item, null));
    } catch (e) {
      item.error = e && e.arMessage ? e.arMessage : `تعذّرت قراءة الملف: ${e && e.message ? e.message : e}`;
    }
    return item;
  }

  // المصدر المناسب للملف حسب نوع ملف الإعداد المختار
  function sourceFor(item, profile) {
    if (item.source) return item.source;
    if (item.batch && (!profile || profile.input.format === "batchTxt")) return { fileName: item.name, batch: item.batch };
    if (profile && profile.input.format === "batchTxt") return { fileName: item.name, batch: T.core.batchtxt.parseBatchTxt(item.text) };
    return P.csvSource(item.name, item.text, profile ? profile.input.delimiter : "auto");
  }

  function rerank() {
    state.files.forEach((item) => {
      if (item.error) return;
      const r = P.rankProfiles(state.profiles, item.info);
      item.ranked = r.ranked;
      item.decision = r.decision;
      if (!item.userPicked || !profileById(item.profileId)) {
        item.profileId = r.decision !== "manual" && r.ranked[0] ? r.ranked[0].profile.id : "";
        item.userPicked = false;
      }
      const p = profileById(item.profileId);
      if (p && p.company.from === "ask" && item.answers.company == null) item.answers.company = (state.answers[p.id] || {}).company || "";
    });
  }

  // معالج شركة جديدة: ملف لا يطابق أي ملف إعداد ← ملف إعداد جديد يُختار لهذا الملف مباشرة
  async function newCompany(item) {
    const saved = await T.tools.wizard.open({ name: item.name, source: sourceFor(item, null) });
    if (!saved) return;
    await loadProfiles();
    rerank();
    item.profileId = saved.id;
    item.userPicked = true;
    state.result = null;
    render();
  }

  async function addFiles(list) {
    const accepted = list.filter((f) => /\.(xlsx|xlsm|xls|csv|txt)$/i.test(f.name));
    if (accepted.length < list.length) toast(`تم تجاهل ${list.length - accepted.length} ملف بصيغة غير مدعومة`);
    for (const f of accepted) state.files.push(await readFile(f));
    state.result = null;
    rerank();
    render();
  }

  /* ---------- المعالجة ---------- */

  function readyToProcess() {
    const usable = state.files.filter((f) => !f.error);
    return usable.length > 0 && usable.every((f) => {
      const p = profileById(f.profileId);
      if (!p) return false;
      if (p.company.from === "ask" && !(f.answers.company || "").trim()) return false;
      if (p.fields.category.from === "ask" && !(f.answers.category || "").trim()) return false;
      return true;
    });
  }

  async function askCategoryCodes(missingByProfile) {
    const inputs = [];
    const body = el("div", {},
      el("p", { class: "align-hint", text: "هذه الفئات ليس لها كود محفوظ. اكتب كود الفئة (العمود الرابع) لكل منها — سيُحفظ في ملف الإعداد للمرات القادمة." }),
      missingByProfile.map(({ profile, missing }) => el("div", { class: "t-codes-group" },
        el("h4", { text: profile.name }),
        el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, el("th", { text: "الفئة كما في الملف" }), el("th", { text: "كود الفئة" }))),
          el("tbody", {}, missing.map((m) => {
            const inp = el("input", { type: "text", class: "t-input", value: m.suggestion, dir: "ltr" });
            inputs.push({ profile, raw: m.raw, inp });
            return el("tr", {}, el("td", {}, el("bdi", { text: m.raw })), el("td", {}, inp));
          }))))));
    const ok = await dialog({
      title: "تأكيد أكواد الفئات",
      body,
      actions: [{ label: "موافقة على الكل ومتابعة", value: true, kind: "primary" }, { label: "إلغاء", value: false }],
    });
    if (!ok) return false;
    const byProfile = new Map();
    inputs.forEach(({ profile, raw, inp }) => {
      const v = T.core.text.normalizeCell(inp.value);
      if (!v) return;
      if (!byProfile.has(profile.id)) byProfile.set(profile.id, Object.assign({}, profile.categoryCodes));
      byProfile.get(profile.id)[raw] = v;
    });
    for (const [id, codes] of byProfile) {
      const p = profileById(id);
      const saved = await store.put("profiles", Object.assign({}, p, { categoryCodes: codes }));
      state.profiles = state.profiles.map((x) => (x.id === id ? saved : x));
    }
    return true;
  }

  async function process() {
    state.result = null;
    state.ack = false;
    const items = state.files.filter((f) => !f.error);
    items.forEach((item) => {
      const p = profileById(item.profileId);
      const isText = !item.source;
      if (p.input.format === "batchTxt" && !isText) {
        item.applied = { records: [], readRows: 0, skippedEmpty: 0, serialFromPin: false,
          issues: [{ level: "error", code: "PROFILE_INVALID", message: `ملف الإعداد "${p.name}" مخصص لملفات TXT من نوع Batch، والملف "${item.name}" ملف Excel.`, file: item.name, sheet: null, rows: [] }] };
        return;
      }
      item.applied = P.applyProfile(p, sourceFor(item, p), item.answers);
    });

    // حفظ آخر إجابات (كود الشركة) لكل ملف إعداد
    const answers = Object.assign({}, state.answers);
    items.forEach((i) => { if ((i.answers.company || "").trim()) answers[i.profileId] = { company: i.answers.company.trim() }; });
    state.answers = answers;
    store.setMeta("lastAnswers", answers).catch(() => {});

    // أكواد الفئات الناقصة لكل ملف إعداد
    const byProfile = new Map();
    items.forEach((i) => {
      if (!byProfile.has(i.profileId)) byProfile.set(i.profileId, []);
      byProfile.get(i.profileId).push(i);
    });
    const missing = [];
    byProfile.forEach((list, id) => {
      const p = profileById(id);
      const m = C.missingCategoryCodes(list.flatMap((i) => i.applied.records), p.categoryCodes || {});
      if (m.length) missing.push({ profile: p, missing: m });
    });
    if (missing.length && !(await askCategoryCodes(missing))) { render(); return; }

    const issues = [];
    const files = [];
    const allCards = [];
    let readRows = 0, skippedEmpty = 0;
    const usedPaths = new Set();
    byProfile.forEach((list, id) => {
      const p = profileById(id);
      const records = [];
      list.forEach((i) => {
        issues.push(...i.applied.issues);
        records.push(...i.applied.records);
        readRows += i.applied.readRows;
        skippedEmpty += i.applied.skippedEmpty;
      });
      const assigned = C.assignCodes(records, p.categoryCodes || {});
      issues.push(...assigned.issues);
      issues.push(...C.checkCards(assigned.cards, { serialFromPin: list.some((i) => i.applied.serialFromPin), digitsOnly: !!(p.expect && p.expect.digitsOnly) }));
      const out = C.buildOutputs(assigned.cards, p.output, { date: today(), usedPaths });
      issues.push(...out.issues);
      out.files.forEach((f) => files.push(Object.assign(f, { output: p.output, profileId: p.id, sources: [...new Set(f.cards.map((c) => c.file))] })));
      allCards.push(...assigned.cards);
    });
    state.result = { issues, files, summary: C.summarize(allCards), reconcile: C.reconcile({ readRows, skippedEmpty, cards: allCards, files }) };
    render();
    const res = root.querySelector(".t-result");
    if (res) res.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- الإخراج ---------- */

  function downloadResult() {
    const { files } = state.result;
    if (files.length === 1) {
      const f = files[0];
      download(f.fileName, C.encodeOutput(f.text, f.output), "text/csv");
    } else {
      const zip = T.core.zip.buildZip(files.map((f) => ({ name: f.path, data: C.encodeOutput(f.text, f.output) })));
      download(`كروت-${today()}.zip`, zip, "application/zip");
    }
  }

  function sendToWorkspace() {
    state.result.files.forEach((f) => {
      workspace.add({
        name: f.path,
        header: f.output.header ? f.output.columns.slice() : null,
        rows: f.cards.map((c) => f.output.columns.map((k) => c[k])),
        origin: { tool: "import", files: f.sources, profileId: f.profileId },
      });
    });
    toast(`أُرسل ${state.result.files.length} ملف إلى سلة العمل`, "ok");
  }

  /* ---------- التصيير ---------- */

  const zone = dropzone({ title: "اسحب ملفات الموردين (Excel أو CSV أو TXT) وأفلتها هنا", accept: ".xlsx,.xlsm,.xls,.csv,.txt", folder: true, onFiles: addFiles });

  const DECISION = {
    auto: ["flag flag-ok", "تعرّف تلقائي"],
    confirm: ["flag flag-warn", "تحقق من الاختيار"],
    manual: ["flag flag-error", "اختر ملف الإعداد"],
  };

  function fileCard(item) {
    const remove = el("button", { class: "file-remove", title: "إزالة الملف", text: "✕", onclick: () => { state.files = state.files.filter((x) => x !== item); state.result = null; render(); } });
    const head = el("div", { class: "file-info" },
      el("div", { class: "file-name" }, el("bdi", { text: item.name })),
      el("div", { class: "file-meta" }, el("span", { text: formatSize(item.size) }),
        item.batch ? el("span", { text: `ملف Batch · ${item.batch.rows.length} كرت` }) : null,
        item.source ? el("span", { text: `Excel · ${item.source.sheets.length} ورقة` }) : null));
    if (item.error) {
      return el("div", { class: "file-card t-file-card" }, el("span", { class: "file-icon", text: "⚠️" }), head,
        el("div", { class: "t-file-error", text: item.error }), remove);
    }
    const [cls, label] = item.userPicked ? ["flag flag-ok", "اختيار يدوي"] : DECISION[item.decision];
    const select = el("select", { class: "t-select", onchange: (e) => { item.profileId = e.target.value; item.userPicked = !!e.target.value; item.answers = {}; state.result = null; rerank(); render(); } },
      el("option", { value: "", text: "— اختر ملف الإعداد —" }),
      (item.ranked || []).map((r) => el("option", { value: r.profile.id, selected: r.profile.id === item.profileId, text: `${r.profile.name} — ${Math.round(r.score)}%` })));
    const p = profileById(item.profileId);
    const asks = [];
    if (p && p.company.from === "ask") {
      asks.push(el("label", { class: "t-ask" }, "كود الشركة: ", el("input", { type: "text", class: "t-input", dir: "ltr", value: item.answers.company || "", oninput: (e) => { item.answers.company = e.target.value; state.result = null; renderActions(); } })));
    }
    if (p && p.fields.category.from === "ask") {
      asks.push(el("label", { class: "t-ask" }, "الفئة: ", el("input", { type: "text", class: "t-input", dir: "ltr", value: item.answers.category || "", oninput: (e) => { item.answers.category = e.target.value; state.result = null; renderActions(); } })));
    }
    return el("div", { class: "file-card t-file-card" },
      el("span", { class: "file-icon", text: item.source ? "📊" : "📄" }),
      head,
      el("div", { class: "t-file-profile" }, select, el("span", { class: cls, text: label }), asks,
        !item.batch && (!p || item.decision === "manual") ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "✨ شركة جديدة من هذا الملف", onclick: () => newCompany(item) }) : null),
      remove);
  }

  const actionsHost = el("div", { class: "split-actions" });
  function renderActions() {
    clear(actionsHost);
    const ok = readyToProcess();
    actionsHost.appendChild(el("button", { type: "button", class: "btn btn-primary", text: "⚙ معالجة وفحص", disabled: !ok, onclick: process }));
    if (!ok && state.files.some((f) => !f.error)) actionsHost.appendChild(el("span", { class: "t-hint", text: "اختر ملف إعداد لكل ملف، واملأ الحقول المطلوبة." }));
  }

  function resultView() {
    const r = state.result;
    const errors = r.issues.filter((i) => i.level === "error").length;
    const warnings = r.issues.filter((i) => i.level === "warning").length;
    const blocked = errors > 0 || !r.reconcile.ok;
    const canAct = !blocked && (warnings === 0 || state.ack);
    const total = r.summary.reduce((a, s) => a + s.count, 0);
    return el("div", { class: "t-result" },
      el("section", { class: "card" },
        el("div", { class: "card-head" }, el("h2", {}, "نتيجة الفحص ", el("span", { class: "count-badge", text: String(r.issues.length) }))),
        r.issues.length ? issuesList(r.issues) : el("p", { class: "clean-note", text: "✅ لا توجد أي مشاكل — الكروت جاهزة." })),
      el("section", { class: "card" },
        el("div", { class: "card-head" }, el("h2", { text: "الملخص" })),
        el("div", { class: "stats-row" },
          el("div", { class: "stat" }, el("b", { text: String(total) }), " كرت"),
          el("div", { class: "stat" }, el("b", { text: String(r.files.length) }), " ملف ناتج"),
          el("div", { class: "stat" }, el("b", { text: String(errors) }), " خطأ"),
          el("div", { class: "stat" }, el("b", { text: String(warnings) }), " تحذير")),
        el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["كود الشركة", "كود الفئة", "عدد الكروت", "الملف الناتج"].map((h) => el("th", { text: h })))),
          el("tbody", {}, r.files.map((f) => el("tr", {},
            el("td", { dir: "ltr", text: f.company }), el("td", { dir: "ltr", text: f.category || "—" }),
            el("td", { text: String(f.rows) }), el("td", {}, el("bdi", { text: f.path }))))))),
        el("p", { class: r.reconcile.ok ? "t-reconcile ok" : "t-reconcile bad", text: r.reconcile.message }),
        blocked ? el("p", { class: "t-hint t-hint-error", text: "لا يمكن التنزيل قبل تصحيح الأخطاء أعلاه." }) : null,
        !blocked && warnings > 0 ? el("label", { class: "opt opt-check t-ack" },
          el("input", { type: "checkbox", checked: state.ack, onchange: (e) => { state.ack = e.target.checked; render(); } }),
          ` اطّلعت على التحذيرات (${warnings}) وأريد المتابعة`) : null,
        el("div", { class: "split-actions" },
          el("button", { type: "button", class: "btn btn-primary", text: r.files.length === 1 ? "⬇ تنزيل CSV" : "📦 تنزيل ZIP", disabled: !canAct, onclick: downloadResult }),
          el("button", { type: "button", class: "btn btn-ghost", text: "📥 إرسال إلى سلة العمل", disabled: !canAct, onclick: sendToWorkspace }))));
  }

  function render() {
    clear(root);
    root.appendChild(zone);
    if (state.storeError) root.appendChild(el("p", { class: "t-hint t-hint-error", text: `تعذّر تحميل ملفات الإعداد: ${state.storeError}` }));
    if (!state.profiles.length) {
      root.appendChild(el("section", { class: "card t-notice" },
        el("p", {}, "لا توجد ملفات إعداد للشركات بعد. ", el("a", { href: "#/settings", text: "أضف ملف إعداد أو استورد حزمة الإعدادات" }), " ثم عد إلى هنا.")));
    }
    if (state.files.length) {
      root.appendChild(el("section", { class: "card" },
        el("div", { class: "card-head" },
          el("h2", {}, "الملفات ", el("span", { class: "count-badge", text: String(state.files.length) })),
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "🗑 مسح الكل", onclick: () => { state.files = []; state.result = null; render(); } })),
        el("div", { class: "files-list" }, state.files.map(fileCard)),
        actionsHost));
      renderActions();
    }
    if (state.result) root.appendChild(resultView());
  }

  store.on((s) => { if (s === "profiles" || s === "meta") loadProfiles().then(() => { rerank(); render(); }); });
  loadProfiles().then(() => { rerank(); render(); });
  render();

  T.tools = T.tools || {};
  T.tools.import = { addFiles };
})();

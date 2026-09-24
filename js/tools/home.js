"use strict";
/* الرئيسية: قائمة المهام بأسماء برامجك القديمة، سلة العمل، تنبيه النسخ الاحتياطي، واسم الجهاز عند أول تشغيل. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, download, dialog, toast } = T.app.ui;
  const { store, workspace } = T.app;

  const root = document.getElementById("homeRoot");
  if (!root) return;

  const WEEK = 7 * 24 * 3600 * 1000;
  const state = { backupDue: false, lastBackupAt: null };

  // مرتّبة حسب دورة العمل، وكل مهمة تذكر البرنامج القديم الذي تقابله
  const GROUPS = [
    ["كروت الموردين", [
      ["#/import", "📥", "استيراد كروت مورد وتحويلها", "محوّلات الشركات: جيجا، أوزون، ستار، الأهرام، LTT…"],
      ["#/pull", "📤", "سحب كمية وتصديرها بقالب", "DOJON"],
      ["#/take", "✂️", "أخذ كروت من ملف وتقسيمها", "M_L — تقسيم الكروت"],
      ["#/append", "➕", "إضافة نص لنهاية كل سطر", "M_L — تبويب Extintion"],
    ]],
    ["السيريال والأكواد", [
      ["#/gen", "🎲", "توليد أكواد سرية جديدة", "GEN"],
      ["#/serial-add", "🔖", "إضافة سيريال وأكواد لملف أكواد", "SIRIAL v3"],
      ["#/extract", "📑", "استخراج عمود من ملفات", "EXPORT_SN"],
      ["#/len", "📏", "فلترة الأسطر حسب طول الرقم", "LenFilter"],
      ["#/match", "🔀", "المطابقة: مطابق وغير مطابق", "MatchFind"],
      ["#/find", "🔍", "البحث عن سيريالات داخل ملفات", "serial-sarch"],
    ]],
    ["أدوات عامة", [
      ["#/merge", "🧩", "دمج ملفات وتوزيعها على الشركات", "دمج CSV + تقسيم الكروت"],
      ["#/settings", "⚙️", "الإعدادات والنسخة الاحتياطية", ""],
    ]],
  ];

  async function firstRun() {
    try {
      if (!(await store.meta("firstRunAt"))) await store.setMeta("firstRunAt", new Date().toISOString());
      if (await store.meta("deviceName")) return;
      const inp = el("input", { type: "text", class: "t-input", placeholder: "مثال: جهاز المكتب" });
      let name = "";
      while (!name) {
        await dialog({
          title: "مرحبًا بك في لوحة عمليات التميم",
          body: el("div", {}, el("p", { text: "اكتب اسمًا لهذا الجهاز — يظهر مع كل تعديل على الإعدادات وفي ملف النسخة الاحتياطية، ليسهل التمييز بين الأجهزة." }), inp),
          actions: [{ label: "حفظ", value: true, kind: "primary" }],
        });
        name = inp.value.trim();
      }
      await store.setMeta("deviceName", name);
      await store.persist();
    } catch (e) { /* بدون حفظ محلي: الأدوات تعمل، والإعدادات تعرض الخطأ */ }
  }

  async function checkBackup() {
    try {
      const [lastChange, lastBackup, firstRunAt] = await Promise.all([store.meta("lastChangeAt"), store.meta("lastBackupAt"), store.meta("firstRunAt")]);
      const since = Date.parse(lastBackup || firstRunAt || "");
      state.lastBackupAt = lastBackup || null;
      state.backupDue = !!lastChange && (!lastBackup || Date.parse(lastChange) > Date.parse(lastBackup)) && !isNaN(since) && Date.now() - since > WEEK;
    } catch (e) { state.backupDue = false; }
  }

  function datasetCsv(ds) {
    return T.core.csv.toCSV(ds.header, ds.rows, ",") + "\r\n";
  }

  function render() {
    clear(root);
    if (state.backupDue) {
      root.appendChild(el("div", { class: "t-banner" },
        "💾 لديك تعديلات على الإعدادات لم تُحفظ في نسخة احتياطية منذ أكثر من أسبوع. ",
        el("a", { href: "#/settings", text: "صدّر حزمة الإعدادات الآن" })));
    }
    root.appendChild(el("p", { class: "t-task-intro", text: "اختر المهمة التي تريدها — كل مهمة في صفحة واحدة بخطوات مرقّمة." }));
    GROUPS.forEach(([title, items]) => {
      root.appendChild(el("h2", { class: "home-group", text: title }));
      root.appendChild(el("div", { class: "home-grid" }, items.map(([href, icon, name, oldName]) =>
        el("a", { class: "tool-card", href },
          el("span", { class: "tool-icon", text: icon }),
          el("h3", { text: name }),
          oldName ? el("p", { class: "t-old-name", text: `يقابل: ${oldName}` }) : null))));
    });

    const items = workspace.list();
    root.appendChild(el("section", { class: "card t-workspace" },
      el("div", { class: "card-head" },
        el("h2", {}, "سلة العمل ", el("span", { class: "count-badge", text: String(items.length) })),
        items.length ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "🗑 تفريغ السلة", onclick: async () => {
          const ok = await dialog({ title: "تفريغ سلة العمل", body: el("p", { text: "ستُحذف كل النتائج من السلة. نزّل ما تحتاجه أولًا." }), actions: [{ label: "تفريغ", value: true, kind: "primary" }, { label: "إلغاء", value: false }] });
          if (ok) workspace.clear();
        } }) : null),
      items.length === 0
        ? el("p", { class: "align-hint", text: "السلة فارغة. نتائج الأدوات تُرسل إلى هنا لتنتقل بين الأدوات بلا تنزيل ورفع — وتبقى في الذاكرة فقط وتختفي عند إغلاق الصفحة." })
        : el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الملف", "الصفوف", "المصدر", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, items.map((ds) => el("tr", {},
            el("td", {}, el("bdi", { dir: "ltr", text: ds.name })),
            el("td", { text: String(ds.rows.length) }),
            el("td", { text: (ds.origin && ds.origin.files || []).join("، ") }),
            el("td", { class: "t-actions" },
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "⬇ تنزيل", onclick: () => download(ds.name.split("/").pop(), datasetCsv(ds), "text/csv") }),
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "🧩 إلى الدمج", onclick: () => {
                T.tools.merge.addDataset(ds);
                toast("أُضيف إلى أداة الدمج", "ok");
                location.hash = "#/merge";
              } }),
              el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "✕", title: "حذف من السلة", onclick: () => workspace.remove(ds.id) })))))))));
    root.appendChild(el("p", { class: "home-note", text: "💡 يمكنك تثبيت اللوحة كتطبيق من قائمة المتصفح، وستعمل بعدها بدون إنترنت." }));
  }

  workspace.on(render);
  store.on((s) => { if (s === "meta" || s === "profiles") checkBackup().then(render); });
  render();
  firstRun().then(checkBackup).then(render);
})();

"use strict";
/* أخذ كروت من ملف جاهز وتقسيمها — يقابل برنامج M_L (تقسيم الكروت). */
(function () {
  const T = globalThis.Tamim;
  const root = document.getElementById("takeRoot");
  if (!root) return;
  const S = T.core.split;
  let templates = [];
  const codeTemplates = () => templates.filter((t) => t.kind === "codes");
  const tplById = (id) => codeTemplates().find((t) => t.id === id);

  function build() {
    T.app.taskPage.create(root, {
      title: "أخذ كروت من ملف وتقسيمها",
      oldName: "M_L — تقسيم الكروت",
      intro: "يأخذ آخر عدد من الأسطر أو مدى تحدده، ويقسّمه إلى ملفات، ويمكنه إضافة كود الشركة وكود الفئة من التمبلت.",
      dropTitle: "اسحب ملف الكروت (CSV) هنا",
      accept: ".csv,.txt",
      multiple: true,
      zipName: "cards",
      filesTitle: "اختر ملف الكروت",
      // تعرّف تلقائي على التمبلت من العمود الثالث والرابع في أول سطر (كما في البرنامج القديم)
      onFileAdded: (item, state) => {
        if (state.values.templateId) return;
        const first = (S.toLines(item.text)[0] || "").split(",");
        const t = first.length > 2 && codeTemplates().find((x) => String(x.code) === first[2].trim());
        if (!t) return;
        state.values.templateId = t.id;
        const cat = (t.categories || []).find((c) => String(c.code) === (first[3] || "").trim());
        state.values.categoryName = cat ? cat.name : "";
      },
      settingsTitle: "كم كرتًا تأخذ؟ وكيف تريد الناتج؟",
      fields: [
        { key: "mode", label: "طريقة التحديد", type: "select", value: "last", rerender: true,
          options: [["last", "آخر عدد من الأسطر"], ["range", "من سطر معيّن وعدد"]] },
        { key: "lastLines", label: "كم سطرًا من الآخر؟", type: "number", value: 0, when: (v) => v.mode === "last" },
        { key: "startLine", label: "ابدأ من السطر رقم", type: "number", value: 1, min: 1, when: (v) => v.mode === "range" },
        { key: "count", label: "عدد الأسطر (0 = حتى النهاية)", type: "number", value: 0, when: (v) => v.mode === "range" },
        { key: "splitSize", label: "قسّم الناتج كل كم سطر؟ (0 = ملف واحد)", type: "number", value: 0 },
        { key: "templateId", label: "تمبلت الأكواد", type: "select", value: "", rerender: true,
          options: [["", "— بلا أكواد —"]].concat(codeTemplates().map((t) => [t.id, `${t.name} (${t.code})`])) },
        { key: "categoryName", label: "الفئة", type: "select", value: "", when: (v) => !!v.templateId,
          options: (v) => [["", "— اختر الفئة —"]].concat(((tplById(v.templateId) || {}).categories || []).map((c) => [c.name, `${c.name} (${c.code})`])) },
      ],
      advanced: [
        { key: "customName", label: "اسم الملف المخصص", type: "text", value: "", hint: "يُستخدم عند ملف واحد فقط" },
        { key: "startNumber", label: "رقم أول ملف", type: "number", value: 1, min: 1 },
        { key: "swapFirstTwo", label: "عكس أول عمودين (ترتيب LBY)", type: "checkbox", value: false },
        { key: "protectColumns", label: "إبقاء كل الأعمدة (بدون هذا يُكتفى بعمودين)", type: "checkbox", value: true },
      ],
      actionTitle: "جهّز الملفات",
      canRun: (files, v) => {
        const wants = v.mode === "last" ? v.lastLines > 0 : true;
        return wants && (!v.templateId || !!v.categoryName);
      },
      whyNot: (files, v) => (v.mode === "last" && !v.lastLines ? "اكتب كم سطرًا تريد أخذه." : "اختر الفئة من التمبلت."),
      outputNote: "ملف «المتبقي» هو ملفك بعد حذف ما أخذته — ضعه مكان الملف القديم حتى لا تأخذ نفس الكروت مرتين.",
      run: (files, v) => {
        const t = tplById(v.templateId);
        const cat = t && (t.categories || []).find((c) => c.name === v.categoryName);
        const codes = t && cat ? [String(t.code), String(cat.code)] : [];
        const outputs = [];
        const summary = [];
        const workspace = [];
        files.forEach((f) => {
          const r = S.takeLines(f.text, {
            lastLines: v.mode === "last" ? v.lastLines : 0, startLine: v.startLine, count: v.count,
            protectColumns: v.protectColumns, swapFirstTwo: v.swapFirstTwo, codes,
          });
          const parts = S.buildParts(r.taken, { splitSize: v.splitSize, customName: files.length === 1 ? v.customName : "", sourceName: f.name, startNumber: v.startNumber });
          parts.forEach((p) => {
            outputs.push({ name: p.name, path: p.path, text: p.text, lines: p.lines, note: codes.length ? `كروت + الأكواد ${codes.join(",")}` : "كروت" });
            workspace.push({ name: p.path, header: null, rows: S.toLines(p.text).map((l) => l.split(",")), origin: { tool: "take", files: [f.name] } });
          });
          if (r.remaining.length) outputs.push({ name: f.name, path: `remaining/${f.name}`, text: r.remaining.join("\n"), lines: r.remaining.length, note: "المتبقي — ضعه مكان ملفك" });
          summary.push(`${f.name}: أُخذ ${r.taken.length} سطرًا من ${r.total} (الأسطر ${r.from}–${r.to})، وبقي ${r.remaining.length}.`);
        });
        return { outputs, summary, workspace };
      },
    });

  }

  T.app.store.all("templates").then((t) => { templates = t; build(); }).catch(build);
  T.app.store.on((s) => { if (s === "templates") T.app.store.all("templates").then((t) => { templates = t; build(); }); });
})();

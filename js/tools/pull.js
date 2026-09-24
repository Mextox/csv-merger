"use strict";
/* سحب كمية من نهاية ملف كروت وتصديرها بقالب المورد — يقابل برنامج DOJON. */
(function () {
  const T = globalThis.Tamim;
  const root = document.getElementById("pullRoot");
  if (!root) return;
  const S = T.core.split;
  let templates = [];

  const batchTemplates = () => templates.filter((t) => t.kind === "batch");

  function build() {
    T.app.taskPage.create(root, {
      title: "سحب كمية وتصديرها بقالب المورد",
      oldName: "DOJON",
      intro: "يأخذ آخر عدد تحدده من كل ملف كروت، ويكتبه بقالب المورد (رأس Batch وذيل)، ويعطيك ملف المتبقي لتضعه مكان ملفك.",
      dropTitle: "اسحب ملفات الكروت الجاهزة (CSV) هنا",
      accept: ".csv,.txt",
      multiple: true,
      zipName: "dojon",
      filesTitle: "اختر ملفات الكروت",
      fileNote: (f) => {
        const p = S.pullQuantity(f.text, 0);
        const tpl = S.templateFor(batchTemplates(), p.categoryCode);
        return tpl ? `الفئة ${p.categoryCode} — القالب: ${tpl.name}` : `الفئة ${p.categoryCode || "؟"} — لا يوجد قالب`;
      },
      perFile: [{ key: "qty", label: "الكمية المسحوبة", type: "number", value: 0, min: 0 }],
      settingsTitle: "الكمية لكل ملف",
      fields: [],
      actionTitle: "جهّز ملفات التصدير",
      actionLabel: "⚙ جهّز ملفات التصدير",
      canRun: (files) => files.every((f) => {
        const p = S.pullQuantity(f.text, f.values.qty);
        return f.values.qty > 0 && S.templateFor(batchTemplates(), p.categoryCode);
      }),
      whyNot: (files) => {
        const noQty = files.filter((f) => !f.values.qty);
        if (noQty.length) return `اكتب الكمية المطلوبة أمام كل ملف (${noQty.map((f) => f.name).join("، ")}).`;
        const noTpl = files.filter((f) => !S.templateFor(batchTemplates(), S.pullQuantity(f.text, 0).categoryCode));
        return `لا يوجد قالب تصدير لفئة: ${[...new Set(noTpl.map((f) => S.pullQuantity(f.text, 0).categoryCode || "(فارغة)"))].join("، ")} — أضفه من الإعدادات.`;
      },
      outputNote: "ملف «export» هو ما ترسله للمورد. وملف «remaining» هو ملفك بعد سحب الكمية — ضعه مكان الملف القديم حتى لا تُسحب نفس الكروت مرتين.",
      run: (files) => {
        const outputs = [];
        const summary = [];
        files.forEach((f) => {
          const p = S.pullQuantity(f.text, f.values.qty);
          const tpl = S.templateFor(batchTemplates(), p.categoryCode);
          const base = f.name.replace(/\.[^.]+$/, "");
          outputs.push({ name: `${base}_1.csv`, path: `export/${base}_1.csv`, text: S.batchExport(p.taken, tpl), note: `التصدير بقالب «${tpl.name}»` });
          outputs.push({ name: f.name, path: `remaining/${f.name}`, text: S.rowsToText(p.remaining), lines: p.remaining.length, note: "المتبقي — ضعه مكان ملفك" });
          summary.push(`${f.name}: سُحب ${p.taken.length} كرت من ${p.total}، وبقي ${p.remaining.length}.`);
        });
        return { outputs, summary };
      },
    });
  }

  T.app.store.all("templates").then((t) => { templates = t; build(); }).catch(build);
  T.app.store.on((s) => { if (s === "templates") T.app.store.all("templates").then((t) => { templates = t; build(); }); });
})();

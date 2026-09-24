"use strict";
/* إضافة نص لنهاية كل سطر — يقابل تبويب Extintion في M_L. */
(function () {
  const T = globalThis.Tamim;
  const root = document.getElementById("appendRoot");
  if (!root) return;
  const S = T.core.split;

  T.app.taskPage.create(root, {
    title: "إضافة نص لنهاية كل سطر",
    oldName: "M_L — تبويب Extintion",
    intro: "يضيف فاصلة ثم النص الذي تكتبه في نهاية كل سطر غير فارغ (مثل كود الشركة أو الفئة).",
    dropTitle: "اسحب الملفات هنا",
    accept: ".csv,.txt",
    multiple: true,
    zipName: "appended",
    settingsTitle: "ما النص المضاف؟",
    fields: [{ key: "text", label: "النص المضاف بعد فاصلة", type: "text", value: "", dir: "ltr", placeholder: "مثال: 10,5" }],
    canRun: (files, v) => !!String(v.text).trim(),
    whyNot: () => "اكتب النص المراد إضافته.",
    run: (files, v) => ({
      outputs: files.map((f) => {
        const text = S.appendToLines(f.text, v.text);
        return { name: f.name, text, lines: S.toLines(text).length, note: `كل سطر + «${String(v.text).trim()}»` };
      }),
      summary: files.map((f) => `${f.name}: ${S.toLines(f.text).filter((l) => l.trim()).length} سطر`),
    }),
  });
})();

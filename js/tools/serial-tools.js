"use strict";
/* أربع أدوات سيريال، كل واحدة في صفحتها بنفس الخطوات:
 *   إضافة سيريال لملف أكواد (SIRIAL v3) · استخراج عمود (EXPORT_SN)
 *   فلترة بالطول (LenFilter) · المطابقة (MatchFind) · البحث في ملفات (serial-sarch) */
(function () {
  const T = globalThis.Tamim;
  const S = T.core.serials;
  const CSV = T.core.csv;
  const page = (id, opts) => { const root = document.getElementById(id); if (root) T.app.taskPage.create(root, opts); };
  const rowsOf = (text) => CSV.parseCSV(text, ",").rows.filter((r) => r.some((c) => c !== ""));
  const toCsv = (rows) => CSV.toCSV(null, rows, ",") + "\r\n";
  const base = (n) => n.replace(/\.[^.]+$/, "");

  /* ---------- إضافة سيريال وأكواد لملف أكواد ---------- */
  page("serialAddRoot", {
    title: "إضافة سيريال وأكواد لملف أكواد",
    oldName: "SIRIAL v3 — نظام توليد الأرقام التسلسلية",
    intro: "يضع لكل كود سيريالًا في العمود الثاني (تاريخ_مصدر_تصنيف_رقم)، ثم كود الشركة وكود الفئة.",
    dropTitle: "اسحب ملف الأكواد (عمود واحد) هنا",
    accept: ".csv,.txt",
    multiple: false,
    settingsTitle: "بيانات السيريال",
    fields: [
      { key: "source", label: "المصدر", type: "text", value: "", dir: "ltr" },
      { key: "category", label: "التصنيف", type: "text", value: "", dir: "ltr" },
      { key: "companyCode", label: "كود الشركة (العمود الثالث)", type: "text", value: "", dir: "ltr" },
      { key: "classCode", label: "كود الفئة (العمود الرابع)", type: "text", value: "", dir: "ltr" },
    ],
    canRun: (f, v) => ["source", "category", "companyCode", "classCode"].every((k) => String(v[k]).trim()),
    whyNot: () => "املأ الحقول الأربعة.",
    run: (files, v) => {
      const rows = S.insertSerials(rowsOf(files[0].text), {
        date: new Date(), source: v.source.trim(), category: v.category.trim(), companyCode: v.companyCode.trim(), classCode: v.classCode.trim(),
      });
      return {
        outputs: [{ name: files[0].name, text: toCsv(rows), lines: rows.length, note: "الأكواد بعد إضافة السيريال والأكواد" }],
        summary: [`${rows.length} كود — أول سطر: ${rows[0] ? rows[0].join(",") : ""}`],
        workspace: [{ name: files[0].name, header: null, rows, origin: { tool: "serial-add", files: [files[0].name] } }],
      };
    },
  });

  /* ---------- استخراج عمود ---------- */
  page("extractRoot", {
    title: "استخراج عمود من ملفات",
    oldName: "EXPORT_SN — استخراج العمود الثاني",
    intro: "يأخذ عمودًا واحدًا (السيريال مثلًا) من كل ملف ويخرجه في ملف مستقل.",
    accept: ".csv,.txt",
    multiple: true,
    zipName: "columns",
    settingsTitle: "أي عمود؟",
    fields: [{ key: "column", label: "رقم العمود (يبدأ من 1)", type: "number", value: 2, min: 1 }],
    run: (files, v) => ({
      outputs: files.map((f) => {
        const rows = S.pickColumn(rowsOf(f.text), v.column - 1);
        return { name: `${base(f.name)}_serial.csv`, text: toCsv(rows), lines: rows.length, note: `العمود ${v.column} فقط` };
      }),
      summary: files.map((f) => `${f.name}: ${rowsOf(f.text).length} صف`),
    }),
  });

  /* ---------- فلترة بالطول ---------- */
  page("lenRoot", {
    title: "فلترة الأسطر حسب طول الرقم",
    oldName: "LenFilter — فلتر أرقام CSV",
    intro: "يُبقي الأسطر التي فيها خانة بطول معيّن، ويحذف غيرها.",
    accept: ".csv,.txt",
    multiple: true,
    zipName: "filtered",
    settingsTitle: "ما الطول المطلوب؟",
    fields: [{ key: "length", label: "عدد خانات الرقم", type: "number", value: 12, min: 1 }],
    run: (files, v) => ({
      outputs: files.map((f) => {
        const rows = S.filterByLength(rowsOf(f.text), v.length);
        return { name: `${base(f.name)}_extracted.csv`, text: toCsv(rows), lines: rows.length, note: `الأسطر التي فيها رقم بطول ${v.length}` };
      }),
      summary: files.map((f) => {
        const all = rowsOf(f.text).length, kept = S.filterByLength(rowsOf(f.text), v.length).length;
        return `${f.name}: ${kept} من ${all} سطرًا مطابقة.`;
      }),
    }),
  });

  /* ---------- المطابقة ---------- */
  page("matchRoot", {
    title: "المطابقة: مطابق وغير مطابق",
    oldName: "MatchFind — مقارنة واستخراج",
    intro: "اختر ملفين: الأول فيه القيم المطلوبة (سيريالات مثلًا)، والثاني ملف البيانات. يفصل الثاني إلى مطابق وغير مطابق.",
    dropTitle: "اسحب الملفين هنا: ملف البحث أولًا ثم ملف البيانات",
    accept: ".csv,.txt",
    multiple: true,
    zipName: "match",
    fileNote: (f) => `${rowsOf(f.text).length} صف`,
    settingsTitle: "أي ملف هو ملف البحث؟",
    fields: [{ key: "refFirst", label: "الملف الأول هو ملف البحث (القيم المطلوبة)", type: "checkbox", value: true }],
    canRun: (files) => files.length === 2,
    whyNot: (files) => (files.length < 2 ? "أضف ملفين: ملف البحث وملف البيانات." : "أبقِ ملفين فقط."),
    outputNote: "«matched» فيه الأسطر التي وُجدت قيمها في ملف البحث، و«unmatched» الباقي.",
    run: (files, v) => {
      const ref = v.refFirst ? files[0] : files[1];
      const data = v.refFirst ? files[1] : files[0];
      const r = S.matchSplit(rowsOf(data.text), S.searchValues(rowsOf(ref.text)));
      return {
        outputs: [
          { name: `${base(data.name)}_matched.csv`, text: toCsv(r.matched), lines: r.matched.length, note: "مطابق" },
          { name: `${base(data.name)}_unmatched.csv`, text: toCsv(r.unmatched), lines: r.unmatched.length, note: "غير مطابق" },
        ],
        summary: [`ملف البحث: ${ref.name} — ملف البيانات: ${data.name}`, `${r.matched.length} مطابق و${r.unmatched.length} غير مطابق.`],
      };
    },
  });

  /* ---------- البحث عن سيريالات ---------- */
  page("findRoot", {
    title: "البحث عن سيريالات داخل ملفات",
    oldName: "serial-sarch — برنامج البحث عن السيريالات",
    intro: "ضع السيريالات (سطر لكل واحد) واختر الملفات أو المجلد — يستخرج السطر الكامل لكل سيريال.",
    dropTitle: "اسحب الملفات أو اختر مجلدًا كاملًا",
    accept: ".csv,.txt",
    multiple: true,
    folder: true,
    settingsTitle: "السيريالات المطلوبة",
    fields: [{ key: "serials", label: "سيريال في كل سطر", type: "textarea", value: "", rows: 6, placeholder: "0077000001\n0077000002" }],
    canRun: (files, v) => S.parseSerialList(v.serials).length > 0,
    whyNot: () => "ضع سيريالًا واحدًا على الأقل.",
    run: (files, v) => {
      const serials = S.parseSerialList(v.serials);
      const r = S.searchSerials(files.map((f) => ({ name: f.name, lines: f.text.split(/\r?\n/) })), serials);
      return {
        outputs: [{ name: `found-${T.app.ui.today()}.csv`, text: r.rows.map((x) => x.line).join("\r\n") + "\r\n", lines: r.rows.length, note: "الأسطر الكاملة للسيريالات الموجودة" }],
        summary: [`بحثت عن ${r.searched} سيريالًا في ${files.length} ملف.`, `وُجد ${r.rows.length}، ولم يوجد ${r.missing.length}.`],
        issues: r.missing.length ? [{ level: "warning", message: `لم توجد: ${r.missing.slice(0, 10).join("، ")}${r.missing.length > 10 ? "…" : ""}`, rows: [] }] : [],
      };
    },
  });
})();

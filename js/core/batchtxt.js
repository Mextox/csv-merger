"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.batchtxt = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function () {
/* =====================================================================
 * قارئ ملفات TXT بصيغة Batch: رأس «مفتاح:قيمة» ثم البيانات بين [BEGIN] و[END].
 * كل القيم تبقى نصوصًا.
 * ===================================================================== */

function formatIssue(message, rows) {
  return { level: "error", code: "BATCH_FORMAT", message, rows: rows || [] };
}

// رأس الملف: أسطر «مفتاح:قيمة» — القسمة على أول نقطتين فقط؛ الأسطر بلا نقطتين تُتجاهل
function parseHeader(lines) {
  const header = {};
  lines.forEach((line) => {
    const at = line.indexOf(":");
    if (at < 0) return;
    header[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  });
  return header;
}

// عدد الأجزاء الأكثر تكرارًا (عند التعادل: الأسبق ظهورًا في الملف)
function mostFrequentCount(rows) {
  const freq = new Map();
  rows.forEach((r) => freq.set(r.length, (freq.get(r.length) || 0) + 1));
  let best = null, bestFreq = 0;
  freq.forEach((n, count) => { if (n > bestFreq) { best = count; bestFreq = n; } });
  return best;
}

// يحلّل نص ملف Batch إلى { header, rows, lines, issues }؛ lines[i] رقم سطر rows[i] في الملف (يبدأ من 1)
function parseBatchTxt(text) {
  const all = String(text == null ? "" : text).split(/\r?\n/);
  const trimmed = all.map((l) => l.trim());
  const begin = trimmed.indexOf("[BEGIN]");
  const end = begin < 0 ? -1 : trimmed.indexOf("[END]", begin + 1);
  const header = begin < 0 ? {} : parseHeader(all.slice(0, begin));
  const rows = [], lines = [], issues = [];

  if (begin < 0 || end < 0) {
    let message;
    if (begin < 0) message = "الملف لا يحتوي على السطر [BEGIN] — تأكد أنه ملف Batch صحيح.";
    else if (trimmed.indexOf("[END]") >= 0) message = "السطر [END] يأتي قبل [BEGIN] — الملف غير مكتمل أو تالف.";
    else message = "الملف لا يحتوي على السطر [END] بعد [BEGIN] — قد يكون الملف ناقصًا.";
    issues.push(formatIssue(message));
    return { header, rows, lines, issues };
  }

  for (let i = begin + 1; i < end; i++) {
    if (trimmed[i] === "") continue;
    rows.push(trimmed[i].split(/\s+/));
    lines.push(i + 1);
  }

  const expected = mostFrequentCount(rows);
  const odd = [];
  rows.forEach((r, i) => { if (r.length !== expected) odd.push(lines[i]); });
  if (odd.length) {
    issues.push(formatIssue(`عدد الأجزاء المعتاد في أسطر هذا الملف هو ${expected}، لكن ${odd.length} من الأسطر يختلف عنه.`, odd));
  }

  if (header.Quantity !== undefined && Number(header.Quantity) !== rows.length) {
    issues.push({
      level: "error",
      code: "BATCH_QUANTITY",
      message: `الكمية في رأس الملف (Quantity) هي ${header.Quantity} بينما عدد أسطر البيانات ${rows.length}.`,
      rows: [],
    });
  }

  return { header, rows, lines, issues };
}

return { parseBatchTxt };
});

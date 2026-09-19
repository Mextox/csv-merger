"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.profiles = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { normalizeCell, normalizeKey, digitsOnly, firstNumber, lastNumber, editDistance } = require("./text.js");
const { parseCSV, detectDelimiter, detectHasHeader } = require("./csv.js");

/* =====================================================================
 * ملفات إعدادات الشركات: المخطط، التحقق، التعرّف التلقائي، وتطبيق الملف على ملف مورد.
 * الفروق بين الشركات بيانات هنا، لا كود — لا يوجد أي اسم شركة في هذا الملف.
 * ===================================================================== */

const FIELDS = ["pin", "serial", "category"];
const OUT_COLUMNS = ["pin", "serial", "company", "category"];
const FIELD_NAMES = { pin: "الرقم السري", serial: "السيريال", category: "الفئة", company: "الشركة" };

function defaultProfile() {
  return {
    id: "",
    name: "",
    updatedAt: "",
    updatedBy: "",
    input: { format: "table", sheets: "all", skipSheets: [], header: "auto", delimiter: "auto" },
    company: { from: "fixed", value: "" },
    fields: {
      pin: { names: [], index: null },
      serial: { names: [], index: null },
      category: { from: "column", names: [], index: null },
    },
    rules: [],
    categoryCodes: {},
    output: {
      columns: OUT_COLUMNS.slice(),
      fileName: "{company}_{category}.csv",
      groupBy: "category",
      chunkSize: 0,
      delimiter: ",",
      bom: false,
      header: false,
      lineEnding: "\r\n",
    },
    detect: { headers: [], fileName: [], sheetNames: [] },
    expect: { digitsOnly: true },
  };
}

/* ---------- التحقق ---------- */

const isStr = (v) => typeof v === "string";
const isNonEmptyStr = (v) => isStr(v) && v.trim() !== "";
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const isIndex = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const oneOf = (v, list) => list.includes(v);

function checkColRef(ref, label, errors) {
  if (!isObj(ref)) { errors.push(`${label}: تعريف العمود مفقود`); return; }
  if (ref.names != null && !isStrArr(ref.names)) errors.push(`${label}: names يجب أن تكون قائمة نصوص`);
  if (ref.index != null && !isIndex(ref.index)) errors.push(`${label}: index يجب أن يكون رقمًا صحيحًا ≥ 0`);
  const hasName = Array.isArray(ref.names) && ref.names.some(isNonEmptyStr);
  if (!hasName && !isIndex(ref.index)) errors.push(`${label}: حدِّد اسم عمود أو رقمه`);
}

const RULES = {
  fillDown: (r) => fieldOk(r.field),
  digitsOnly: (r) => fieldOk(r.field),
  padStart: (r) => fieldOk(r.field) && Number.isInteger(r.length) && r.length > 0 && (r.char == null || (isStr(r.char) && r.char.length === 1)),
  concat: (r) => fieldOk(r.target) && Array.isArray(r.parts) && r.parts.length > 0 &&
    r.parts.every((pt) => isObj(pt) && fieldOk(pt.field) && (pt.padStart == null || (Number.isInteger(pt.padStart) && pt.padStart > 0))) &&
    (r.separator == null || isStr(r.separator)),
  copy: (r) => fieldOk(r.from) && fieldOk(r.to) && r.from !== r.to,
  replace: (r) => fieldOk(r.field) && isNonEmptyStr(r.find) && isStr(r.with),
  map: (r) => fieldOk(r.field) && isObj(r.table) && Object.values(r.table).every(isStr) && (r.strict == null || typeof r.strict === "boolean"),
  prefixIf: (r) => fieldOk(r.field) && isNonEmptyStr(r.value) && Array.isArray(r.fileNameContains) && r.fileNameContains.length > 0 && r.fileNameContains.every(isNonEmptyStr),
};
function fieldOk(f) { return FIELDS.includes(f); }

function validateProfile(p) {
  const errors = [];
  if (!isObj(p)) return { ok: false, errors: ["ملف الإعداد ليس كائنًا صالحًا"] };
  if (!isNonEmptyStr(p.name)) errors.push("الاسم مطلوب");

  const inp = p.input;
  if (!isObj(inp)) errors.push("input مفقود");
  else {
    if (!oneOf(inp.format, ["table", "batchTxt"])) errors.push(`نوع المصدر غير معروف: ${inp.format}`);
    if (!oneOf(inp.sheets, ["all", "first"])) errors.push("sheets يجب أن تكون all أو first");
    if (!oneOf(inp.header, ["auto", "yes", "no"])) errors.push("header يجب أن تكون auto أو yes أو no");
    if (!oneOf(inp.delimiter, ["auto", ",", ";", "\t", "|"])) errors.push("فاصل الإدخال غير معروف");
    if (inp.skipSheets != null && !isStrArr(inp.skipSheets)) errors.push("skipSheets يجب أن تكون قائمة نصوص");
  }

  const co = p.company;
  if (!isObj(co) || !oneOf(co.from, ["fixed", "ask", "column", "sheetName"])) errors.push("مصدر كود الشركة غير معروف");
  else {
    if (co.from === "fixed" && !isNonEmptyStr(co.value)) errors.push("كود الشركة الثابت مطلوب");
    if (co.from === "column") checkColRef(co, FIELD_NAMES.company, errors);
    if ((co.from === "column" && co.map != null) || co.from === "sheetName") {
      if (!isObj(co.map) || !Object.values(co.map).every(isStr) || (co.from === "sheetName" && Object.keys(co.map).length === 0)) {
        errors.push("جدول أكواد الشركات (map) غير صالح");
      }
    }
  }

  const f = p.fields;
  if (!isObj(f)) errors.push("fields مفقود");
  else {
    checkColRef(f.pin, FIELD_NAMES.pin, errors);
    checkColRef(f.serial, FIELD_NAMES.serial, errors);
    const c = f.category;
    if (!isObj(c) || !oneOf(c.from, ["column", "fileName", "sheetName", "batchHeader", "fixed", "ask"])) errors.push("مصدر الفئة غير معروف");
    else {
      if (c.from === "column") checkColRef(c, FIELD_NAMES.category, errors);
      if ((c.from === "fileName" || c.from === "sheetName") && !oneOf(c.pick, ["firstNumber", "lastNumber"])) errors.push("pick يجب أن تكون firstNumber أو lastNumber");
      if (c.from === "batchHeader" && !isNonEmptyStr(c.key)) errors.push("مفتاح رأس الملف (key) مطلوب للفئة");
      if (c.from === "fixed" && !isNonEmptyStr(c.value)) errors.push("قيمة الفئة الثابتة مطلوبة");
    }
  }

  if (!Array.isArray(p.rules)) errors.push("rules يجب أن تكون قائمة");
  else p.rules.forEach((r, i) => {
    const n = i + 1;
    if (!isObj(r) || !RULES[r.op]) errors.push(`القاعدة ${n}: عملية غير معروفة "${isObj(r) ? r.op : r}"`);
    else if (!RULES[r.op](r)) errors.push(`القاعدة ${n} (${r.op}): معاملات ناقصة أو غير صالحة`);
  });

  if (p.categoryCodes != null && (!isObj(p.categoryCodes) || !Object.values(p.categoryCodes).every(isStr))) errors.push("categoryCodes غير صالح");

  const o = p.output;
  if (!isObj(o)) errors.push("output مفقود");
  else {
    if (!Array.isArray(o.columns) || o.columns.length !== 4 || OUT_COLUMNS.some((c) => !o.columns.includes(c))) errors.push("أعمدة الإخراج يجب أن تكون الحقول الأربعة بأي ترتيب");
    if (!isNonEmptyStr(o.fileName)) errors.push("نمط اسم الملف مطلوب");
    if (!oneOf(o.groupBy, ["category", "none"])) errors.push("groupBy يجب أن تكون category أو none");
    if (!Number.isInteger(o.chunkSize) || o.chunkSize < 0) errors.push("chunkSize يجب أن يكون رقمًا صحيحًا ≥ 0");
    if (!oneOf(o.delimiter, [",", ";", "\t", "|"])) errors.push("فاصل الإخراج غير معروف");
    if (typeof o.bom !== "boolean" || typeof o.header !== "boolean") errors.push("bom و header يجب أن تكون true/false");
    if (!oneOf(o.lineEnding, ["\r\n", "\n"])) errors.push("نهاية السطر يجب أن تكون \\r\\n أو \\n");
  }

  const d = p.detect;
  if (d != null && (!isObj(d) || !["headers", "fileName", "sheetNames"].every((k) => d[k] == null || isStrArr(d[k])))) errors.push("detect غير صالح");
  return { ok: errors.length === 0, errors };
}

/* ---------- التعرّف التلقائي ---------- */

const containsKey = (hay, word) => normalizeKey(hay).includes(normalizeKey(word));

function scoreProfile(p, info) {
  const d = p.detect || {};
  const crit = [];
  const headers = (d.headers || []).filter(isNonEmptyStr);
  if (headers.length) {
    const have = info.headers ? new Set(info.headers.map(normalizeKey)) : null;
    const v = have ? headers.filter((h) => have.has(normalizeKey(h))).length / headers.length : 0;
    crit.push([60, v]);
  }
  const names = (d.fileName || []).filter(isNonEmptyStr);
  if (names.length) crit.push([25, names.some((w) => containsKey(info.fileName || "", w)) ? 1 : 0]);
  const sheets = (d.sheetNames || []).filter(isNonEmptyStr);
  if (sheets.length) crit.push([15, (info.sheetNames || []).some((s) => sheets.some((w) => containsKey(s, w))) ? 1 : 0]);
  if (!crit.length) return 0;
  const wsum = crit.reduce((a, [w]) => a + w, 0);
  return (100 * crit.reduce((a, [w, v]) => a + w * v, 0)) / wsum;
}

function rankProfiles(list, info) {
  const ranked = (list || []).map((profile) => ({ profile, score: scoreProfile(profile, info) }))
    .sort((a, b) => b.score - a.score);
  let decision = "manual";
  if (ranked.length && ranked[0].score >= 40 && !(ranked[1] && ranked[1].score === ranked[0].score)) {
    decision = ranked[0].score >= 70 ? "auto" : "confirm";
  }
  return { ranked, decision };
}

/* ---------- المصادر ---------- */

// ملف CSV/TXT نصي ← مصدر بورقة واحدة
function csvSource(fileName, text, delimiterPref) {
  const d = !delimiterPref || delimiterPref === "auto" ? detectDelimiter(text) : delimiterPref;
  return { fileName, sheets: [{ sheetName: "", rows: parseCSV(text, d).rows, flags: { lossy: [], date: [] } }] };
}

const isBlankRow = (r) => !r || r.every((c) => normalizeCell(c) === "");

function firstContentRow(rows) {
  let i = 0;
  while (i < rows.length && isBlankRow(rows[i])) i++;
  return i;
}

function wantsHeader(pref, row) {
  if (pref === "yes") return true;
  if (pref === "no") return false;
  return detectHasHeader(row.map((c) => normalizeCell(c)));
}

function selectedSheets(p, source) {
  const skip = (p.input.skipSheets || []).filter(isNonEmptyStr);
  let sheets = (source.sheets || []).filter((s) => !skip.some((w) => containsKey(s.sheetName || "", w)));
  if (p.input.sheets === "first") sheets = sheets.slice(0, 1);
  return sheets;
}

// معلومات التعرّف لملف: اسمه، عناوين أول ورقة (إن كان لها صف عناوين)، وأسماء الأوراق
function fileInfo(source) {
  if (source.batch) return { fileName: source.fileName, headers: null, sheetNames: [] };
  const sheets = source.sheets || [];
  const first = sheets.find((s) => !isBlankRow(s.rows[firstContentRow(s.rows)]));
  let headers = null;
  if (first) {
    const row = first.rows[firstContentRow(first.rows)];
    if (detectHasHeader(row.map((c) => normalizeCell(c)))) headers = row.map((c) => normalizeCell(c));
  }
  return { fileName: source.fileName, headers, sheetNames: sheets.map((s) => s.sheetName || "") };
}

// جداول موحّدة من المصدر: [{ sheet, headers|null, dataRows, rowNumbers, rowIndex, flags, batchHeader }]
function readSource(p, source) {
  const empty = { lossy: [], date: [] };
  if (p.input.format === "batchTxt") {
    const b = source.batch || { header: {}, rows: [], lines: [], issues: [] };
    return {
      tables: [{ sheet: null, headers: null, dataRows: b.rows, rowNumbers: b.lines, rowIndex: b.rows.map((_, i) => i), flags: empty, batchHeader: b.header }],
      issues: (b.issues || []).slice(),
    };
  }
  const tables = [];
  selectedSheets(p, source).forEach((s) => {
    const rows = s.rows || [];
    const start = firstContentRow(rows);
    if (start >= rows.length) return; // ورقة فارغة
    const hasHeader = wantsHeader(p.input.header, rows[start]);
    const headers = hasHeader ? rows[start].map((c) => normalizeCell(c)) : null;
    const dataStart = hasHeader ? start + 1 : start;
    const idx = [];
    for (let i = dataStart; i < rows.length; i++) idx.push(i);
    tables.push({
      sheet: s.sheetName || null,
      headers,
      dataRows: idx.map((i) => rows[i]),
      rowNumbers: idx.map((i) => i + 1),
      rowIndex: idx,
      flags: s.flags || empty,
      batchHeader: null,
    });
  });
  return { tables, issues: [] };
}

/* ---------- تحديد الأعمدة ---------- */

function resolveColumn(ref, headers) {
  const names = ((ref && ref.names) || []).filter(isNonEmptyStr).map(normalizeKey);
  if (headers && names.length) {
    const keys = headers.map(normalizeKey);
    for (const n of names) { const i = keys.indexOf(n); if (i >= 0) return { index: i, byIndex: false }; }
    for (const n of names) { const i = keys.findIndex((k) => k !== "" && k.includes(n)); if (i >= 0) return { index: i, byIndex: false }; }
  }
  if (ref && isIndex(ref.index)) return { index: ref.index, byIndex: !!headers };
  return { error: `لم يُعثر على عمود ${names.length ? `باسم ${names.map((n) => `"${n}"`).join(" أو ")}` : ""}` };
}

/* ---------- الشركة من اسم الورقة ---------- */

function companyFromSheet(co, sheetName) {
  const word = normalizeKey((sheetName || "").split(/\s+/)[0] || "");
  const entries = Object.entries(co.map || {}).map(([k, v]) => [normalizeKey(k), v]);
  const exact = entries.find(([k]) => k === word);
  if (exact) return { code: exact[1], fuzzy: null };
  if (co.fuzzy && word.length >= 5) {
    let best = null;
    entries.forEach(([k, v]) => {
      if (k.length < 5) return;
      const dist = editDistance(word, k);
      if (dist <= 2 && (!best || dist < best.dist)) best = { key: k, code: v, dist };
    });
    if (best) return { code: best.code, fuzzy: best.key };
  }
  return { code: "", fuzzy: null };
}

function mapLookup(map, value) {
  if (!map) return value;
  const key = normalizeKey(value);
  const hit = Object.entries(map).find(([k]) => normalizeKey(k) === key);
  return hit ? hit[1] : "";
}

/* ---------- القواعد ---------- */

function padValue(v, len, ch) { return v === "" ? "" : v.padStart(len, ch || "0"); }

// يطبّق القواعد بالترتيب على سجل { pin, serial, category }. state: حالة الورقة (لـ fillDown).
function applyRules(rec, rules, ctx, state, onStrictMiss) {
  rules.forEach((r, ri) => {
    switch (r.op) {
      case "fillDown":
        if (rec[r.field] === "") rec[r.field] = state[r.field] || "";
        else state[r.field] = rec[r.field];
        break;
      case "digitsOnly": rec[r.field] = digitsOnly(rec[r.field]); break;
      case "padStart": rec[r.field] = padValue(rec[r.field], r.length, r.char); break;
      case "concat": {
        const snap = Object.assign({}, rec);
        const vals = r.parts.map((pt) => (pt.padStart ? padValue(snap[pt.field], pt.padStart) : snap[pt.field]));
        // جزء فارغ يعني قيمة ناقصة — لا نخفيها بأصفار
        rec[r.target] = vals.some((v) => v === "") ? "" : vals.join(r.separator || "");
        break;
      }
      case "copy": rec[r.to] = rec[r.from]; break;
      case "replace": rec[r.field] = rec[r.field].split(r.find).join(r.with); break;
      case "map":
        if (Object.prototype.hasOwnProperty.call(r.table, rec[r.field])) rec[r.field] = r.table[rec[r.field]];
        else if (r.strict) onStrictMiss(ri, r.field, rec[r.field]);
        break;
      case "prefixIf":
        if (rec[r.field] !== "" && r.fileNameContains.some((w) => containsKey(ctx.fileName, w))) rec[r.field] = r.value + rec[r.field];
        break;
    }
  });
  return rec;
}

/* ---------- التطبيق ---------- */

const baseName = (name) => String(name || "").replace(/\.[^.\\/]+$/, "");
const pick = (how, s) => (how === "lastNumber" ? lastNumber(s) : firstNumber(s));

function applyProfile(p, source, answers) {
  answers = answers || {};
  const result = { records: [], readRows: 0, skippedEmpty: 0, issues: [], serialFromPin: false };
  const v = validateProfile(p);
  if (!v.ok) {
    result.issues.push({ level: "error", code: "PROFILE_INVALID", message: `ملف الإعداد "${p && p.name ? p.name : ""}" غير صالح: ${v.errors.join("؛ ")}`, file: source.fileName, sheet: null, rows: [] });
    return result;
  }
  result.serialFromPin = p.rules.some((r) => r.op === "copy" && ((r.from === "pin" && r.to === "serial") || (r.from === "serial" && r.to === "pin")));

  const fileName = source.fileName || "";
  const read = readSource(p, source);
  read.issues.forEach((i) => result.issues.push(Object.assign({ file: fileName, sheet: null, rows: [] }, i)));

  read.tables.forEach((t) => {
    const where = { file: fileName, sheet: t.sheet };
    const width = t.headers ? t.headers.length : t.dataRows.reduce((m, r) => Math.max(m, r.length), 0);
    const cols = {};
    const colRefs = { pin: p.fields.pin, serial: p.fields.serial };
    if (p.fields.category.from === "column") colRefs.category = p.fields.category;
    if (p.company.from === "column") colRefs.company = p.company;
    let bad = false;
    Object.entries(colRefs).forEach(([field, ref]) => {
      const r = resolveColumn(ref, t.headers);
      if (!r.error && r.index >= width) r.error = `العمود رقم ${r.index + 1} غير موجود (عدد الأعمدة ${width})`;
      if (r.error) {
        bad = true;
        result.issues.push(Object.assign({ level: "error", code: "PROFILE_INVALID", message: `${FIELD_NAMES[field]}: ${r.error} في "${fileName}"${t.sheet ? ` — الورقة "${t.sheet}"` : ""}`, rows: [] }, where));
        return;
      }
      if (r.byIndex) {
        result.issues.push(Object.assign({ level: "warning", code: "COLUMN_BY_INDEX", message: `عمود ${FIELD_NAMES[field]} في "${fileName}" حُدد بالرقم (${r.index + 1}: "${t.headers[r.index]}") لأن اسمه لم يُطابق — تأكد أن المورد لم يغيّر ترتيب الأعمدة.`, rows: [] }, where));
      }
      cols[field] = r.index;
    });
    if (bad) return;

    let sheetCompany = null;
    if (p.company.from === "sheetName") {
      const c = companyFromSheet(p.company, t.sheet);
      sheetCompany = c.code;
      if (c.fuzzy) {
        result.issues.push(Object.assign({ level: "warning", code: "FUZZY_COMPANY", message: `اسم الورقة "${t.sheet}" لا يطابق اسم شركة تمامًا — اعتُبر "${c.fuzzy}" (كود ${c.code}).`, rows: [] }, where));
      }
    }

    const lossy = new Set(t.flags.lossy.map((f) => f.row + ":" + f.col));
    const dated = new Set(t.flags.date.map((f) => f.row + ":" + f.col));
    const state = {};
    const strictMiss = new Map(); // JSON [field, value] → { field, value, rows }

    t.dataRows.forEach((row, i) => {
      result.readRows++;
      const raw = (idx) => (idx == null ? "" : normalizeCell(row[idx]));
      const rec = { pin: raw(cols.pin), serial: raw(cols.serial), category: "" };
      const catFrom = p.fields.category.from;
      if (rec.pin === "" && rec.serial === "" && (catFrom !== "column" || raw(cols.category) === "")) { result.skippedEmpty++; return; }

      if (catFrom === "column") rec.category = raw(cols.category);
      else if (catFrom === "fileName") rec.category = pick(p.fields.category.pick, baseName(fileName));
      else if (catFrom === "sheetName") rec.category = pick(p.fields.category.pick, t.sheet || "");
      else if (catFrom === "batchHeader") rec.category = normalizeCell((t.batchHeader || {})[p.fields.category.key]);
      else if (catFrom === "fixed") rec.category = normalizeCell(p.fields.category.value);
      else rec.category = normalizeCell(answers.category);

      const line = t.rowNumbers[i];
      applyRules(rec, p.rules, { fileName }, state, (ri, field, value) => {
        const key = JSON.stringify([field, value]);
        if (!strictMiss.has(key)) strictMiss.set(key, { field, value, rows: [] });
        strictMiss.get(key).rows.push(line);
      });

      let company;
      if (p.company.from === "fixed") company = normalizeCell(p.company.value);
      else if (p.company.from === "ask") company = normalizeCell(answers.company);
      else if (p.company.from === "sheetName") company = sheetCompany;
      else company = p.company.map ? mapLookup(p.company.map, raw(cols.company)) : raw(cols.company);

      const flagsFor = (col) => {
        const out = [];
        const key = t.rowIndex[i] + ":" + col;
        if (lossy.has(key)) out.push("lossy");
        if (dated.has(key)) out.push("date");
        return out;
      };
      result.records.push({
        pin: rec.pin,
        serial: rec.serial,
        company,
        categoryRaw: rec.category,
        file: fileName,
        sheet: t.sheet,
        row: line,
        srcFlags: { pin: flagsFor(cols.pin), serial: flagsFor(cols.serial) },
      });
    });

    strictMiss.forEach(({ field, value, rows }) => {
      result.issues.push(Object.assign({ level: "error", code: "MAP_STRICT", message: `قيمة ${FIELD_NAMES[field]} "${value}" غير موجودة في جدول التحويل في "${fileName}".`, rows }, where));
    });
  });
  return result;
}

return { FIELDS, OUT_COLUMNS, defaultProfile, validateProfile, scoreProfile, rankProfiles, csvSource, fileInfo, readSource, resolveColumn, applyRules, applyProfile };
});

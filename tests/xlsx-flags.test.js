"use strict";
// علامات فقد الدقة (lossy) والتاريخ (date) في قارئ Excel — كل المصنّفات تُبنى هنا عبر buildZip
const { buildZip } = require("../js/core/zip.js");
const { cellValue, parseSheet, parseStyles, parseSharedStrings, parseXlsx } = require("../js/core/xlsx.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });
const same = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

const XENC = new TextEncoder();

// يبني خريطة ملفات مصنّف قياسية (منسوخ من legacy.test.js)
function workbookFiles(sheets, extra) {
  extra = extra || {};
  const files = {};
  const sheetEls = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  files["xl/workbook.xml"] =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` + sheetEls + `</sheets></workbook>`;
  const relEls = sheets.map((s, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  files["xl/_rels/workbook.xml.rels"] =
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + relEls + `</Relationships>`;
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = s.xml; });
  if (extra.sharedStrings != null) files["xl/sharedStrings.xml"] = extra.sharedStrings;
  if (extra.styles != null) files["xl/styles.xml"] = extra.styles;
  return files;
}
function filesToEntries(files) {
  return Object.keys(files).map((name) => ({ name, data: XENC.encode(files[name]) }));
}
function buildWorkbook(sheets, extra) { return buildZip(filesToEntries(workbookFiles(sheets, extra))); }
function wsheet(rowsXml) {
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}
function sst(items) {
  return `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    items.map((it) => `<si>${it}</si>`).join("") + `</sst>`;
}

// النمط 0 عام، النمط 1 تاريخ (numFmtId 14)
const STYLES_XML = `<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
const SST_XML = sst(["<t>PIN</t>", "<t>Serial</t>", "<t>12345678901234567890</t>"]);
const styles = parseStyles(STYLES_XML);
const strings = parseSharedStrings(SST_XML);

// يسجّل كل استدعاءات flag
function spy() {
  const calls = [];
  const fn = (kind) => { calls.push(kind); };
  fn.calls = calls;
  return fn;
}

// ---------- cellValue ----------
function flagOf(t, content, sAttr) {
  const f = spy();
  const value = cellValue(t, content, strings, sAttr, styles, false, f);
  return { value, calls: f.calls };
}

let r = flagOf("n", "<v>1234567890123456</v>", null);
same("cellValue 16 digits → lossy", r.calls, ["lossy"]);
eq("cellValue 16 digits keeps text", r.value, "1234567890123456");

r = flagOf("n", "<v>1.23456789012346E+19</v>", null);
same("cellValue exponent → lossy", r.calls, ["lossy"]);
eq("cellValue exponent keeps text", r.value, "1.23456789012346E+19");

r = flagOf(undefined, "<v>1234567890123456</v>", "0");
same("cellValue missing t with general style → lossy", r.calls, ["lossy"]);

same("cellValue 12345 → no flag", flagOf("n", "<v>12345</v>", null).calls, []);
same("cellValue 15 digits → no flag", flagOf("n", "<v>123456789012345</v>", null).calls, []);
same("cellValue empty numeric → no flag", flagOf("n", "", null).calls, []);

r = flagOf("n", "<v>44197</v>", "1");
same("cellValue date style → date", r.calls, ["date"]);
eq("cellValue date style returns date text", r.value, "2021-01-01");

r = flagOf("n", "<v>4.4197E+4</v>", "1");
same("cellValue date wins over exponent (date only)", r.calls, ["date"]);

same("cellValue shared string 20 digits → no flag", flagOf("s", "<v>2</v>", null).calls, []);
same("cellValue inlineStr 20 digits → no flag", flagOf("inlineStr", "<is><t>12345678901234567890</t></is>", null).calls, []);
same("cellValue str 20 digits → no flag", flagOf("str", "<v>12345678901234567890</v>", null).calls, []);
same("cellValue bool → no flag", flagOf("b", "<v>1</v>", null).calls, []);
same("cellValue error → no flag", flagOf("e", "<v>#N/A</v>", null).calls, []);

// بلا المعامل الجديد: نفس القيم السابقة بالضبط
[["n", "<v>1234567890123456</v>", null, "1234567890123456"], ["n", "<v>44197</v>", "1", "2021-01-01"],
  ["s", "<v>2</v>", null, "12345678901234567890"], ["n", "<v>12345</v>", null, "12345"]]
  .forEach(([t, c, s, want]) => {
    eq(`cellValue without flag unchanged (${t} ${c})`, cellValue(t, c, strings, s, styles, false), want);
  });

// ---------- parseSheet ----------
// الصف 0 عناوين؛ lossy في (1,0) و(2,1)؛ date في (3,0)؛ الباقي بلا علامة
const SHEET_XML = wsheet(
  `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
  `<row r="2"><c r="A2"><v>1234567890123456</v></c><c r="B2"><v>12345</v></c></row>` +
  `<row r="3"><c r="A3"><v>123456789012345</v></c><c r="B3"><v>1.23456789012346E+19</v></c></row>` +
  `<row r="4"><c r="A4" s="1"><v>44197</v></c><c r="B4" t="s"><v>2</v></c></row>` +
  `<row r="5"><c r="A5" t="inlineStr"><is><t>12345678901234567890</t></is></c><c r="B5" t="str"><v>12345678901234567890</v></c></row>`
);

const flags = { lossy: [], date: [] };
const rows = parseSheet(SHEET_XML, strings, styles, false, flags);
same("parseSheet lossy flags at (1,0) and (2,1)", flags.lossy, [{ row: 1, col: 0 }, { row: 2, col: 1 }]);
same("parseSheet date flag at (3,0)", flags.date, [{ row: 3, col: 0 }]);
const EXPECTED_ROWS = [
  ["PIN", "Serial"],
  ["1234567890123456", "12345"],
  ["123456789012345", "1.23456789012346E+19"],
  ["2021-01-01", "12345678901234567890"],
  ["12345678901234567890", "12345678901234567890"],
];
same("parseSheet with flags returns unchanged values", rows, EXPECTED_ROWS);
same("parseSheet without flags returns unchanged values", parseSheet(SHEET_XML, strings, styles, false), EXPECTED_ROWS);

// خلية مكررة المرجع تُكتب فوقها خلية فارغة → العمود C يُقصّ فتسقط علامته
const dupFlags = { lossy: [], date: [] };
const dupRows = parseSheet(wsheet(
  `<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>` +
  `<row r="2"><c r="A2"><v>3</v></c><c r="C2"><v>1234567890123456</v></c><c r="C2"/></row>`
), [], styles, false, dupFlags);
eq("parseSheet trimmed width is 2", dupRows[0].length, 2);
same("parseSheet drops flag outside trimmed rows", dupFlags.lossy, []);

// ---------- المتصفح: xlsx.js تعتمد على text.js صراحةً (تُحمَّل قبلها في index.html) ----------
const vm = require("vm");
const fs = require("fs");
const path = require("path");
function browserCore(modules) {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, DecompressionStream });
  ctx.globalThis = ctx;
  modules.forEach((m) => {
    const file = path.join(__dirname, "..", "js", "core", m + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  });
  return ctx.Tamim.core;
}
function browserLossyCalls(core) {
  const f = spy();
  core.xlsx.cellValue("n", "<v>1234567890123456</v>", [], null, null, false, f);
  return f.calls;
}
same("browser: text.js loaded before xlsx.js → lossy", browserLossyCalls(browserCore(["text", "zip", "xlsx"])), ["lossy"]);
let missingDepFails = false;
try { browserCore(["zip", "xlsx"]); } catch (e) { missingDepFails = true; }
check("browser: missing text.js fails loudly (never silently skips the precision check)", missingDepFails);

// ---------- parseXlsx ----------
(async () => {
  try {
    const wb = buildWorkbook(
      [{ name: "Cards", xml: SHEET_XML }, { name: "Plain", xml: wsheet(`<row r="1"><c r="A1"><v>7</v></c></row>`) }],
      { sharedStrings: SST_XML, styles: STYLES_XML }
    );
    const sheets = await parseXlsx(wb);
    same("parseXlsx sheet flags", sheets[0].flags, { lossy: [{ row: 1, col: 0 }, { row: 2, col: 1 }], date: [{ row: 3, col: 0 }] });
    same("parseXlsx sheet rows match parseSheet", sheets[0].rows, rows);
    same("parseXlsx sheet without flagged cells has empty flags", sheets[1].flags, { lossy: [], date: [] });
  } catch (e) {
    check("parseXlsx suite crashed", false, e && e.stack ? e.stack : String(e));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

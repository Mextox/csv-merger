"use strict";
// إصلاح: خلية أو صف مكتوب بصيغة الإغلاق الذاتي (<c r="D2" s="1"/> أو <row r="3"/>) كان يبتلع
// محتوى الخلية/الصف التالي فتنتقل القيم إلى أعمدة/صفوف خاطئة (ظهر في ملف مورد حقيقي).
const { parseSheet } = require("../js/core/xlsx.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const sheet = (rowsXml) => `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;

eq("self-closing styled cell stays empty; next value stays in its column",
  parseSheet(sheet(`<row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"/><c r="C1"><v>90</v></c></row>`), [], null, false),
  [["1", "", "90"]]);

eq("several self-closing cells before a value (real supplier layout)",
  parseSheet(sheet(`<row r="2"><c r="A2" t="inlineStr"><is><t>S</t></is></c><c r="B2"><v>5</v></c><c r="C2"/><c r="D2" s="2"/><c r="E2"><v>90</v></c><c r="F2" t="inlineStr"><is><t>2026-01-01</t></is></c></row>`), [], null, false),
  [["", "", "", "", "", ""], ["S", "5", "", "", "90", "2026-01-01"]]);

eq("self-closing empty row does not swallow the next row",
  parseSheet(sheet(`<row r="1"><c r="A1"><v>1</v></c></row><row r="2" spans="1:3"/><row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>4</v></c></row>`), [], null, false),
  [["1", ""], ["", ""], ["3", "4"]]);

eq("cell without r attribute after a self-closing cell",
  parseSheet(sheet(`<row r="1"><c r="A1"/><c><v>7</v></c></row>`), [], null, false),
  [["", "7"]]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

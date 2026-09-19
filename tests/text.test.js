"use strict";
const T = require("../js/core/text.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });

eq("normalizeCell null", T.normalizeCell(null), "");
eq("normalizeCell undefined", T.normalizeCell(undefined), "");
eq("normalizeCell number", T.normalizeCell(12345), "12345");
eq("normalizeCell trims", T.normalizeCell("  abc \t"), "abc");
eq("normalizeCell arabic digits", T.normalizeCell("١٢٣٤٥"), "12345");
eq("normalizeCell persian digits", T.normalizeCell("۱۲۳"), "123");
eq("normalizeCell strips .0", T.normalizeCell("12345.0"), "12345");
eq("normalizeCell strips .000", T.normalizeCell("-7.000"), "-7");
eq("normalizeCell keeps real decimals", T.normalizeCell("12.50"), "12.50");
eq("normalizeCell keeps leading zeros", T.normalizeCell("000123"), "000123");
eq("normalizeCell keeps text", T.normalizeCell("ZL0012"), "ZL0012");

eq("normalizeKey lower + spaces", T.normalizeKey("  PIN   Code "), "pin code");
eq("normalizeKey arabic", T.normalizeKey(" الرقم  السري "), "الرقم السري");

eq("digitsOnly", T.digitsOnly("كارت وي 100ج"), "100");
eq("digitsOnly arabic digits", T.digitsOnly("فئة ١٠"), "10");
eq("digitsOnly none", T.digitsOnly("abc"), "");
eq("firstNumber", T.firstNumber("Order #3830 - LTT - 10 LYD"), "3830");
eq("lastNumber", T.lastNumber("Order #3830 - LTT - 10 LYD"), "10");
eq("firstNumber none", T.firstNumber("بدون أرقام"), "");
eq("lastNumber arabic digits", T.lastNumber("كروت ٥٠"), "50");

eq("editDistance same", T.editDistance("vodafone", "vodafone"), 0);
eq("editDistance one sub", T.editDistance("etisalst", "etisalat"), 1);
eq("editDistance insert", T.editDistance("orang", "orange"), 1);
eq("editDistance empty", T.editDistance("", "abc"), 3);

check("isScientific 1.23E+15", T.isScientific("1.23E+15"));
check("isScientific 5e10", T.isScientific("5e10"));
check("isScientific plain number false", !T.isScientific("123456"));
check("isScientific text false", !T.isScientific("E+15"));

check("precision loss 16 digits", T.hasPrecisionLoss("1234567890123456"));
check("no precision loss 15 digits", !T.hasPrecisionLoss("123456789012345"));
check("no precision loss leading zeros", !T.hasPrecisionLoss("000000123456789012345"));
check("precision loss exponent", T.hasPrecisionLoss("1.5E+3"));
check("precision loss lowercase exponent", T.hasPrecisionLoss("1.23456789012346e+19"));
check("no precision loss decimal 15 digits", !T.hasPrecisionLoss("-12345678.1234567"));
check("precision loss decimal 16 digits", T.hasPrecisionLoss("12345678.12345678"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

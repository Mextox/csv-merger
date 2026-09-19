# لوحة عمليات التميم — خطة الدفعة 1أ (الأساس)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تحويل أداة الدمج الحالية إلى إطار "لوحة عمليات التميم" (قائمة جانبية، تنقّل، عمل بدون نت) مع نقل كل الكود الحالي إلى وحدات **بدون أي تغيير في السلوك**، ثم النشر باسم `tamim-ops`.

**Architecture:** دوال `app.js` النقية تُنقل حرفيًا (بنطاقات أسطر محددة وبسكربت، لا يدويًا) إلى 4 وحدات في `js/core/` بغلاف موحّد يعمل في المتصفح (`globalThis.Tamim.core.*`) وفي Node (`module.exports`). كود الواجهة يُنقل حرفيًا إلى `js/tools/merge.js` داخل إطار لوحة جديد. الـ 181 اختبارًا الحالية تبقى الحَكَم بعد كل خطوة.

**Tech Stack:** JavaScript عادي (بلا مكتبات ولا بناء)، Service Worker، Node ≥ 20 للاختبارات، GitHub Actions + GitHub Pages.

**المرجع:** `docs/superpowers/specs/2026-09-19-tamim-ops-phase1-design.md` (الأقسام 3، 11، 12، 13، 14).

---

## خريطة الملفات

| الملف | المسؤولية | المصدر |
|---|---|---|
| `.gitattributes` | توحيد نهايات الأسطر LF | جديد |
| `js/core/csv.js` | تحليل CSV، الترميز، تحليل الملف، الفحوص بين الملفات، كتابة CSV | `app.js` الأسطر 8–364، 536–552، 740–760 |
| `js/core/merge.js` | خطة الأعمدة، الدمج، حذف الأعمدة، خطة التقسيم، أسماء ملفات الأرشيف | `app.js` 365–534، 554–632 |
| `js/core/zip.js` | CRC-32، كاتب ZIP، قارئ ZIP، خطأ برسالة عربية | `app.js` 634–738، 768–842 |
| `js/core/xlsx.js` | قارئ Excel (XML، الأنماط، التواريخ، الأوراق) | `app.js` 762–766، 844–1166 |
| `js/tools/merge.js` | واجهة الدمج والتقسيم (كما هي) | `app.js` 1172–2154 |
| `js/app/version.js` | رقم الإصدار — مصدر واحد | جديد |
| `js/app/shell.js` | التنقّل `#/…`، الشريط الجانبي، القائمة على الجوال | جديد |
| `js/app/pwa.js` | تسجيل Service Worker + شريط "يوجد تحديث" | جديد |
| `sw.js` | تخزين ملفات التطبيق للعمل بدون نت | جديد |
| `manifest.webmanifest`، `icons/*` | التثبيت كتطبيق | جديد |
| `index.html` | إطار اللوحة + عرض الرئيسية + عرض الدمج | يُعاد بناؤه (ترميز الدمج ينقل كما هو) |
| `css/base.css` | التنسيقات الحالية | `style.css` كما هو |
| `css/shell.css` | تخطيط اللوحة | جديد |
| `tests/run.js` | مشغّل الاختبارات | جديد |
| `tests/helpers/core-all.js` | يجمع كل وحدات core في كائن واحد (للاختبارات القديمة) | جديد |
| `tests/legacy.test.js` | الـ 181 اختبارًا | `test.js` مع تعديل سطر التحميل فقط |
| `tests/modules.test.js` | يتحقق أن الوحدات تُسجَّل وتتصل ببعضها في وضع المتصفح | جديد |
| `tests/app-shell.test.js` | يتحقق من اتساق الإصدار وقائمة التخزين والسكربتات | جديد |
| `scripts/smoke.js` | فحص حي في Chrome عبر بروتوكول DevTools (محلي فقط) | جديد |
| `.github/workflows/deploy.yml` | الاختبارات قبل النشر | تعديل |
| `README.md` | وصف اللوحة | إعادة كتابة |

ملاحظة: `js/tools/merge.js` (~990 سطرًا) يتجاوز حدّ الـ 600 سطر عمدًا في هذه الدفعة لأن شرطها النقل **بلا تعديل**؛ يُقسَّم عند أول دفعة تعدّله.

**غلاف الوحدات الموحّد** (يُستخدم في كل ملف من `js/core`):

```js
"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core["<NAME>"] = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
  // ... جسم الوحدة ...
  return { /* الواجهة المصدَّرة */ };
});
```

---

### Task 0: توحيد نهايات الأسطر

**Files:** Create: `.gitattributes`

- [ ] **Step 1: إعداد git والملف**

```bash
cd /c/Users/user/Desktop/tamim-ops
git config core.autocrlf false
printf '* text=auto eol=lf\n*.png binary\n' > .gitattributes
git add --renormalize .
git add .gitattributes
git status --short
```

- [ ] **Step 2: التأكد أن الاختبارات تعمل**

Run: `node test.js | tail -1`
Expected: `181 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: توحيد نهايات الأسطر LF"
```

### Task 1: مشغّل الاختبارات ونقل الاختبارات القديمة

**Files:** Create: `tests/run.js`، `tests/helpers/core-all.js`؛ Move: `test.js` ← `tests/legacy.test.js`

- [ ] **Step 1: المشغّل**

`tests/run.js`:
```js
"use strict";
// يشغّل كل tests/*.test.js كعملية مستقلة ويجمع النتائج. يخرج بـ 1 عند أي فشل.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
let failedFiles = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const summary = out.trim().split("\n").pop();
  console.log(`${r.status === 0 ? "✔" : "✘"} ${f} — ${summary}`);
  fails.forEach((l) => console.log("    " + l));
  if (r.status !== 0) failedFiles++;
}
console.log(failedFiles ? `\n${failedFiles} ملف اختبار فشل` : `\nكل ملفات الاختبار نجحت (${files.length})`);
process.exit(failedFiles ? 1 : 0);
```

- [ ] **Step 2: المجمّع المؤقت (يشير إلى app.js حتى Task 2)**

`tests/helpers/core-all.js`:
```js
"use strict";
module.exports = require("../../app.js");
```

- [ ] **Step 3: نقل الاختبار وتعديل مسار التحميل فقط**

```bash
git mv test.js tests/legacy.test.js
sed -i 's#require("./app.js")#require("./helpers/core-all.js")#g' tests/legacy.test.js
grep -c 'helpers/core-all.js' tests/legacy.test.js
```
Expected: `4`

- [ ] **Step 4: التشغيل**

Run: `node tests/run.js`
Expected: `✔ legacy.test.js — 181 passed, 0 failed` ثم `كل ملفات الاختبار نجحت (1)`

- [ ] **Step 5: Commit**

```bash
git add tests && git commit -m "test: مشغّل اختبارات ونقل الاختبارات الحالية إلى tests/"
```

### Task 2: نقل الدوال النقية إلى js/core حرفيًا

**Files:** Create: `js/core/csv.js`، `js/core/merge.js`، `js/core/zip.js`، `js/core/xlsx.js`، `tests/modules.test.js`؛ Modify: `tests/helpers/core-all.js`

- [ ] **Step 1: اختبار تحميل الوحدات في وضع المتصفح (يفشل الآن)**

`tests/modules.test.js`:
```js
"use strict";
// يحمّل ملفات js/core بترتيب index.html داخل سياق معزول بلا module/require (مثل المتصفح)
// ويتحقق أن كل وحدة سُجّلت في Tamim.core وأن الاعتمادات بينها تعمل.
const vm = require("vm");
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra ? " | " + JSON.stringify(extra) : "")); }
}

const ORDER = ["csv", "merge", "zip", "xlsx"];
const ctx = vm.createContext({ TextEncoder, TextDecoder, DecompressionStream, console });
ctx.globalThis = ctx;
for (const m of ORDER) {
  const file = path.join(__dirname, "..", "js", "core", m + ".js");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
}
const core = ctx.Tamim && ctx.Tamim.core;
check("Tamim.core exists", !!core);
ORDER.forEach((m) => check(`module ${m} registered`, core && typeof core[m] === "object"));
check("csv.parseCSV works", core.csv.parseCSV("a,b\n1,2", ",").rows.length === 2);
check("merge uses csv (buildMerge)", core.merge.buildMerge(
  [core.csv.analyzeFile("x.csv", "a,b\n1,2", { skipEmpty: true }, null)],
  { columnMode: "union", skipEmpty: true }).rows.length === 1);
check("zip roundtrip crc", core.zip.crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);
check("xlsx sees zip.xlsxError", typeof core.xlsx.parseXlsx === "function");
(async () => {
  let msg = "";
  try { await core.xlsx.parseXlsx(new Uint8Array([1, 2, 3, 4])); } catch (e) { msg = e.arMessage || ""; }
  check("xlsx error path uses zip.xlsxError", msg.includes("Excel"), msg);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
```

Run: `node tests/modules.test.js | tail -3`
Expected: FAIL (الملفات غير موجودة: `ENOENT`)

- [ ] **Step 2: سكربت الاستخراج (يُشغَّل مرة من مجلد مؤقت، لا يُضاف للمستودع)**

`<scratch>/split-app.js`:
```js
"use strict";
// يقصّ نطاقات أسطر من app.js حرفيًا ويغلّفها بغلاف الوحدات. الأسطر 1-based وشاملة.
const fs = require("fs");
const path = require("path");
const repo = process.argv[2];
const src = fs.readFileSync(path.join(repo, "app.js"), "utf8").split("\n");
const take = (ranges) => ranges.map(([a, b]) => src.slice(a - 1, b).join("\n")).join("\n\n");

function wrap(name, imports, body, exportsList) {
  return `"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core.${name} = factory((p) => T.core[p.replace(/^.*\\//, "").replace(/\\.js$/, "")]);
  }
})(function (require) {
${imports}
${body}

return { ${exportsList.join(", ")} };
});
`;
}

const mods = {
  csv: {
    imports: "",
    ranges: [[8, 364], [536, 552], [740, 760]],
    exports: ["parseCSV", "detectDelimiter", "DELIM_NAMES", "classifyValue", "TYPE_NAMES", "SEP", "detectHasHeader",
      "modeColumnCount", "analyzeFile", "analyzeRows", "normalizeHeader", "crossFileChecks", "csvEscape", "toCSV", "readFileSmart"],
  },
  merge: {
    imports: 'const { normalizeHeader, SEP } = require("./csv.js");\n',
    ranges: [[365, 534], [554, 632]],
    exports: ["POS_PREFIX", "planColumns", "defaultFileMap", "autoMergePlan", "assembleRows", "mergeWithMaps", "buildMerge",
      "filterDeletedColumns", "sliceOwnColumns", "planSplit", "mergeSlices", "csvEntryName"],
  },
  zip: {
    imports: "",
    ranges: [[634, 738], [768, 842]],
    exports: ["xlsxError", "crc32", "buildZip", "inflateRaw", "parseZipEntries"],
  },
  xlsx: {
    imports: 'const { xlsxError, parseZipEntries } = require("./zip.js");\n',
    ranges: [[762, 766], [844, 1166]],
    exports: ["decodeXml", "getAttr", "extractTag", "concatText", "parseSharedStrings", "parseWorkbookSheets", "parseRels",
      "parseStyles", "colRefToIndex", "classifyNumFmt", "excelSerialToText", "cellValue", "trimTrailingEmpty", "parseSheet",
      "parseXlsx", "xlsxSheetsToFiles"],
  },
};

fs.mkdirSync(path.join(repo, "js", "core"), { recursive: true });
for (const [name, m] of Object.entries(mods)) {
  fs.writeFileSync(path.join(repo, "js", "core", name + ".js"), wrap(name, m.imports, take(m.ranges), m.exports));
}

// الواجهة: الأسطر 1172–2154 حرفيًا، مع ترويسة تستورد ما تحتاجه من Tamim.core
const toolHeader = `"use strict";
/* واجهة الدمج والتقسيم — منقولة من app.js كما هي (الأسطر 1172–2154). */
(function () {
  const core = globalThis.Tamim.core;
  const { analyzeFile, analyzeRows, crossFileChecks, toCSV, readFileSmart, DELIM_NAMES } = core.csv;
  const { autoMergePlan, mergeWithMaps, filterDeletedColumns, sliceOwnColumns, planSplit, mergeSlices, csvEntryName } = core.merge;
  const { buildZip } = core.zip;
  const { parseXlsx, xlsxSheetsToFiles } = core.xlsx;

`;
fs.mkdirSync(path.join(repo, "js", "tools"), { recursive: true });
fs.writeFileSync(path.join(repo, "js", "tools", "merge.js"), toolHeader + take([[1172, 2154]]) + "\n})();\n");
console.log("done");
```

Run: `node <scratch>/split-app.js /c/Users/user/Desktop/tamim-ops`
Expected: `done`

- [ ] **Step 3: إثبات أن النقل حرفي** — كل سطر من النطاقات موجود في الملفات الجديدة بنفس الترتيب:

```bash
cd /c/Users/user/Desktop/tamim-ops
node -e '
const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8").split("\n");
const specs = [["core/csv",8,364],["core/csv",536,552],["core/csv",740,760],["core/merge",365,534],["core/merge",554,632],
  ["core/zip",634,738],["core/zip",768,842],["core/xlsx",762,766],["core/xlsx",844,1166],["tools/merge",1172,2154]];
let bad = 0;
for (const [f, a, b] of specs) {
  const want = src.slice(a - 1, b).join("\n");
  const ok = fs.readFileSync(`js/${f}.js`, "utf8").includes(want);
  console.log((ok ? "OK " : "MISMATCH ") + f + ":" + a + "-" + b);
  if (!ok) bad++;
}
// كل سطر من app.js مغطّى مرة واحدة على الأقل ما عدا الترويسة والتصدير
const covered = new Set();
specs.forEach(([, a, b]) => { for (let i = a; i <= b; i++) covered.add(i); });
const missed = src.map((l, i) => i + 1).filter((n) => !covered.has(n) && src[n - 1].trim() !== "" && !(n <= 7 || n >= 2155));
console.log("uncovered non-empty lines:", JSON.stringify(missed));
process.exit(bad || missed.length ? 1 : 0);
'
```
Expected: `OK` لكل نطاق، و`uncovered non-empty lines: []`. (الأسطر 1–7 ترويسة الملف، و2155–2159 تصدير Node، لا يُحتاج إليهما.)

- [ ] **Step 4: المجمّع يشير إلى الوحدات الجديدة**

`tests/helpers/core-all.js`:
```js
"use strict";
// يجمع كل وحدات js/core في كائن واحد — تستخدمه الاختبارات القديمة التي كانت تحمّل app.js
const names = ["csv", "merge", "zip", "xlsx"];
module.exports = Object.assign({}, ...names.map((n) => require(`../../js/core/${n}.js`)));
```

- [ ] **Step 5: التشغيل**

Run: `node tests/run.js`
Expected: `✔ legacy.test.js — 181 passed, 0 failed` و`✔ modules.test.js — 10 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add js tests && git commit -m "refactor: نقل الدوال النقية وواجهة الدمج من app.js إلى وحدات (بلا تغيير في السلوك)"
```

### Task 3: إطار اللوحة (index.html + shell + css)

**Files:** Create: `css/shell.css`، `js/app/version.js`، `js/app/shell.js`، `tests/app-shell.test.js`؛ Move: `style.css` ← `css/base.css`؛ Rewrite: `index.html`؛ Delete: `app.js`

- [ ] **Step 1: اختبار اتساق الإطار (يفشل الآن)**

`tests/app-shell.test.js`:
```js
"use strict";
// اتساق ملفات التطبيق: كل سكربت/ستايل في index.html موجود، وكل رابط ?v= يساوي رقم الإصدار،
// وكل ملف في قائمة تخزين sw.js موجود، وكل ملف محلي في index.html مخزَّن في sw.js.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra ? " | " + JSON.stringify(extra) : "")); }
}

const { version } = require("../js/app/version.js");
check("version is positive integer", Number.isInteger(version) && version > 0, version);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+?)(\?v=(\d+))?"/g)].map((m) => ({ file: m[1], v: m[3] }));
const local = refs.filter((r) => !r.file.startsWith("http") && r.file !== "./");
local.forEach((r) => check(`index.html ref exists: ${r.file}`, fs.existsSync(path.join(root, r.file))));
local.filter((r) => /\.(js|css)$/.test(r.file))
  .forEach((r) => check(`index.html ?v= matches version: ${r.file}`, Number(r.v) === version, r));

const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
const order = ["js/core/csv.js", "js/core/merge.js", "js/core/zip.js", "js/core/xlsx.js"];
const pos = order.map((f) => scripts.indexOf(f));
check("core scripts load in dependency order", pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), scripts);
check("version.js loads first", scripts[0] === "js/app/version.js", scripts);
check("tools load after core", scripts.indexOf("js/tools/merge.js") > pos[pos.length - 1], scripts);
check("shell loads last", scripts[scripts.length - 1] === "js/app/shell.js", scripts);

const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
check("sw.js has ASSETS", !!assetsBlock);
const assets = assetsBlock ? [...assetsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
assets.filter((a) => a !== "./").forEach((a) => check(`sw asset exists: ${a}`, fs.existsSync(path.join(root, a))));
local.forEach((r) => check(`sw caches ${r.file}`, assets.includes(r.file)));
["manifest.webmanifest", "js/app/version.js", "js/app/pwa.js"].forEach((f) => check(`sw caches ${f}`, assets.includes(f)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

Run: `node tests/app-shell.test.js | tail -1`
Expected: FAIL (لا يوجد `js/app/version.js`)

- [ ] **Step 2: رقم الإصدار**

`js/app/version.js`:
```js
"use strict";
// رقم إصدار التطبيق — المصدر الوحيد. يُرفع مع كل نشر يغيّر ملفات التطبيق.
// تستخدمه: sw.js (اسم ذاكرة التخزين) و index.html (?v=) — ويتحقق اختبار app-shell من الاتساق.
(function (g) {
  const VERSION = 8;
  const T = (g.Tamim = g.Tamim || {});
  T.app = T.app || {};
  T.app.version = VERSION;
  if (typeof module === "object" && module.exports) module.exports = { version: VERSION };
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 3: نقل الستايل**

```bash
mkdir -p css && git mv style.css css/base.css
```

- [ ] **Step 4: تخطيط اللوحة**

`css/shell.css`:
```css
/* ===== إطار لوحة عمليات التميم ===== */
.app { display: flex; min-height: 100vh; }

.sidebar {
  width: 240px; flex-shrink: 0;
  background: linear-gradient(180deg, #1e1b4b, #312e81);
  color: #e0e7ff;
  padding: 20px 14px;
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; gap: 18px;
}
.side-brand { display: flex; align-items: center; gap: 10px; padding: 0 6px; }
.side-brand img { width: 38px; height: 38px; border-radius: 10px; }
.side-brand b { display: block; font-size: 1.05rem; color: #fff; }
.side-brand small { color: #a5b4fc; font-size: .78rem; }

.nav { display: flex; flex-direction: column; gap: 4px; }
.nav a {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  color: #c7d2fe; text-decoration: none; font-weight: 600;
}
.nav a:hover { background: rgba(255, 255, 255, .08); color: #fff; }
.nav a.active { background: #fff; color: #312e81; }
.nav .nav-icon { width: 22px; text-align: center; }

.side-foot { margin-top: auto; font-size: .78rem; color: #a5b4fc; padding: 0 6px; }

.main { flex: 1; min-width: 0; }
.main .topbar { margin-bottom: 24px; padding: 22px 0; }
.menu-btn { display: none; background: none; border: 0; color: #fff; font-size: 1.5rem; cursor: pointer; }

.view[hidden] { display: none; }

.update-bar {
  background: #fef3c7; color: #92400e; border-bottom: 1px solid #fcd34d;
  padding: 10px 20px; display: flex; gap: 12px; align-items: center; justify-content: center;
}
.update-bar[hidden] { display: none; }

.home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.tool-card {
  display: block; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 20px; color: var(--text); text-decoration: none;
}
.tool-card:hover { border-color: var(--primary); }
.tool-card .tool-icon { font-size: 1.8rem; }
.tool-card h3 { margin: 8px 0 4px; }
.tool-card p { margin: 0; color: var(--muted); font-size: .9rem; }
.home-note { color: var(--muted); font-size: .9rem; margin-top: 18px; }

@media (max-width: 820px) {
  .app { display: block; }
  .sidebar {
    position: fixed; inset: 0 0 0 auto; z-index: 50; height: 100vh;
    transform: translateX(100%); transition: transform .2s ease;
  }
  .sidebar.open { transform: translateX(0); box-shadow: -8px 0 24px rgba(0, 0, 0, .25); }
  .menu-btn { display: inline-block; }
}
```

- [ ] **Step 5: التنقّل**

`js/app/shell.js`:
```js
"use strict";
/* التنقّل بين أدوات اللوحة عبر #/<المسار>. كل أداة عنصر <section class="view" data-view="..."> ورابط في الشريط الجانبي. */
(function () {
  const views = [...document.querySelectorAll(".view[data-view]")];
  const links = [...document.querySelectorAll(".nav a[data-route]")];
  const titleEl = document.getElementById("viewTitle");
  const sidebar = document.getElementById("sidebar");
  const DEFAULT = "home";

  function current() {
    const r = (location.hash || "").replace(/^#\/?/, "");
    return views.some((v) => v.dataset.view === r) ? r : DEFAULT;
  }

  function show() {
    const r = current();
    views.forEach((v) => { v.hidden = v.dataset.view !== r; });
    links.forEach((a) => a.classList.toggle("active", a.dataset.route === r));
    const link = links.find((a) => a.dataset.route === r);
    const label = link ? link.querySelector(".nav-label").textContent : "";
    titleEl.textContent = label;
    document.title = label ? `${label} — لوحة عمليات التميم` : "لوحة عمليات التميم";
    sidebar.classList.remove("open");
  }

  document.getElementById("menuBtn").addEventListener("click", () => sidebar.classList.toggle("open"));
  window.addEventListener("hashchange", show);
  show();
})();
```

- [ ] **Step 6: index.html الجديد**

ترميز أقسام الدمج (من `<!-- منطقة الإفلات -->` حتى نهاية قسم `splitSection`، الأسطر 28–119 في `index.html` الحالي) يُنقل **كما هو** داخل `<section class="view" data-view="merge"><main class="container">…</main></section>`. الملف الكامل:

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>لوحة عمليات التميم</title>
<meta name="description" content="لوحة عمليات التميم — أدوات معالجة ملفات الكروت داخل المتصفح، تعمل بدون إنترنت ولا يُرفع أي ملف.">
<meta name="theme-color" content="#312e81">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<link rel="stylesheet" href="css/base.css?v=8">
<link rel="stylesheet" href="css/shell.css?v=8">
</head>
<body>
<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="side-brand">
      <img src="icons/icon.svg" alt="">
      <div><b>التميم</b><small>لوحة العمليات</small></div>
    </div>
    <nav class="nav">
      <a href="#/home" data-route="home"><span class="nav-icon">🏠</span><span class="nav-label">الرئيسية</span></a>
      <a href="#/merge" data-route="merge"><span class="nav-icon">🧩</span><span class="nav-label">الدمج والتقسيم</span></a>
    </nav>
    <div class="side-foot">🔒 كل المعالجة داخل متصفحك — لا يُرفع أي ملف</div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="container topbar-inner">
        <div class="brand">
          <button type="button" id="menuBtn" class="menu-btn" aria-label="القائمة">☰</button>
          <div>
            <h1 id="viewTitle">الرئيسية</h1>
            <p class="tagline">لوحة عمليات التميم</p>
          </div>
        </div>
        <div class="privacy-pill" title="كل المعالجة تتم محليًا عبر JavaScript داخل متصفحك">🔒 يعمل بدون إنترنت — لا يُرفع أو يُخزَّن أي ملف</div>
      </div>
    </header>
    <div id="updateBar" class="update-bar" hidden>
      يوجد إصدار جديد من اللوحة.
      <button type="button" id="updateBtn" class="btn btn-primary btn-sm">إعادة التحميل</button>
    </div>

    <section class="view" data-view="home" hidden>
      <main class="container">
        <div class="home-grid">
          <a class="tool-card" href="#/merge">
            <span class="tool-icon">🧩</span>
            <h3>الدمج والتقسيم</h3>
            <p>دمج ملفات CSV وExcel مع فحص التناقضات، وتقسيم الكروت على الشركات في ملف ZIP.</p>
          </a>
        </div>
        <p class="home-note">💡 يمكنك تثبيت اللوحة كتطبيق من قائمة المتصفح، وستعمل بعدها بدون إنترنت.</p>
      </main>
    </section>

    <section class="view" data-view="merge" hidden>
      <main class="container">
        <!-- ترميز الأسطر 28–119 من index.html الأصلي كما هو -->
      </main>
    </section>

    <footer class="footer">
      <div class="container">
        <p>🔒 خصوصية كاملة: تتم كل المعالجة محليًا داخل متصفحك ولا يغادر أي ملف جهازك.</p>
        <p><a href="https://github.com/Mextox/tamim-ops" target="_blank" rel="noopener">المشروع على GitHub</a> · رخصة MIT</p>
      </div>
    </footer>
  </div>
</div>

<script src="js/app/version.js?v=8"></script>
<script src="js/core/csv.js?v=8"></script>
<script src="js/core/merge.js?v=8"></script>
<script src="js/core/zip.js?v=8"></script>
<script src="js/core/xlsx.js?v=8"></script>
<script src="js/tools/merge.js?v=8"></script>
<script src="js/app/pwa.js?v=8"></script>
<script src="js/app/shell.js?v=8"></script>
</body>
</html>
```

يُبنى بسكربت يأخذ الأسطر 28–119 من `index.html` الأصلي ويضعها مكان التعليق (لضمان النقل الحرفي):
```bash
cd /c/Users/user/Desktop/tamim-ops
git show HEAD:index.html | sed -n 28,119p > /tmp/merge-markup.html
# بعد كتابة index.html الجديد بالتعليق أعلاه:
python - <<'EOF'
p = "index.html"
s = open(p, encoding="utf8").read()
m = open("/tmp/merge-markup.html", encoding="utf8").read()
marker = "        <!-- ترميز الأسطر 28–119 من index.html الأصلي كما هو -->\n"
assert marker in s
open(p, "w", encoding="utf8", newline="\n").write(s.replace(marker, m))
EOF
grep -c 'id="splitDialog"' index.html
```
Expected: `1`

- [ ] **Step 7: حذف app.js**

```bash
git rm -q app.js
```

- [ ] **Step 8: التشغيل** (يبقى `app-shell` فاشلًا في sw.js حتى Task 4)

Run: `node tests/run.js`
Expected: `legacy` و`modules` ناجحان؛ `app-shell` يفشل فقط في بنود `sw`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: إطار لوحة عمليات التميم (شريط جانبي، تنقّل، الرئيسية) ونقل واجهة الدمج إليه"
```

### Task 4: العمل بدون نت (PWA)

**Files:** Create: `sw.js`، `js/app/pwa.js`، `manifest.webmanifest`، `icons/icon.svg`، `icons/icon-192.png`، `icons/icon-512.png`

- [ ] **Step 1: الأيقونة**

`icons/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <rect x="120" y="150" width="272" height="170" rx="22" fill="#fff" opacity=".95"/>
  <rect x="150" y="186" width="120" height="20" rx="10" fill="#4f46e5"/>
  <rect x="150" y="226" width="200" height="14" rx="7" fill="#c7d2fe"/>
  <rect x="150" y="256" width="160" height="14" rx="7" fill="#c7d2fe"/>
  <rect x="170" y="350" width="172" height="28" rx="14" fill="#a5b4fc"/>
</svg>
```

PNG بالمقاسين عبر Chrome بلا واجهة:
```bash
cd /c/Users/user/Desktop/tamim-ops
for s in 192 512; do
  printf '<html><body style="margin:0"><img src="icon.svg" width="%s" height="%s"></body></html>' $s $s > icons/_r.html
  "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 --window-size=$s,$s --screenshot="$(cygpath -w "$PWD/icons/icon-$s.png")" \
    "file:///$(cygpath -m "$PWD/icons/_r.html")"
done
rm icons/_r.html
python -c "from PIL import Image;[print(s, Image.open(f'icons/icon-{s}.png').size) for s in (192,512)]"
```
Expected: `192 (192, 192)` و`512 (512, 512)`

- [ ] **Step 2: manifest**

`manifest.webmanifest`:
```json
{
  "name": "لوحة عمليات التميم",
  "short_name": "التميم",
  "description": "أدوات معالجة ملفات الكروت داخل المتصفح — تعمل بدون إنترنت.",
  "lang": "ar",
  "dir": "rtl",
  "start_url": "./#/home",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f4f6fa",
  "theme_color": "#312e81",
  "icons": [
    { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: Service Worker**

`sw.js`:
```js
"use strict";
/* يخزّن كل ملفات اللوحة لتعمل بدون إنترنت. الإصدار من js/app/version.js.
 * ملاحظة: ذاكرة التخزين مشتركة مع كل صفحات mextox.github.io، لذا لا نحذف إلا ذواكر "tamim-v*". */
importScripts("js/app/version.js");
const CACHE = "tamim-v" + self.Tamim.app.version;
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/base.css",
  "css/shell.css",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/app/version.js",
  "js/core/csv.js",
  "js/core/merge.js",
  "js/core/zip.js",
  "js/core/xlsx.js",
  "js/tools/merge.js",
  "js/app/pwa.js",
  "js/app/shell.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tamim-v") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE)
      .then((c) => c.match(req, { ignoreSearch: true }))
      .then((hit) => hit || fetch(req))
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
```

- [ ] **Step 4: التسجيل وشريط التحديث**

`js/app/pwa.js`:
```js
"use strict";
/* تسجيل Service Worker (ليس من file://) وإظهار شريط "يوجد إصدار جديد" — بلا إعادة تحميل تلقائية. */
(function () {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const bar = document.getElementById("updateBar");
  const btn = document.getElementById("updateBtn");
  let reloading = false;

  function offer(reg) {
    if (!reg.waiting) return;
    bar.hidden = false;
    btn.onclick = () => { btn.disabled = true; reg.waiting.postMessage("skipWaiting"); };
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register("sw.js").then((reg) => {
    offer(reg);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) offer(reg);
      });
    });
  }).catch(() => { /* بدون Service Worker تعمل الصفحة عاديًا (فقط لا تعمل بدون نت) */ });
})();
```

- [ ] **Step 5: التشغيل**

Run: `node tests/run.js`
Expected: `كل ملفات الاختبار نجحت (3)`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: العمل بدون إنترنت (Service Worker + manifest + أيقونات) وشريط التحديث"
```

### Task 5: فحص حي في المتصفح

**Files:** Create: `scripts/smoke.js`

- [ ] **Step 1: السكربت**

`scripts/smoke.js`:
```js
"use strict";
/* فحص حي للّوحة في Chrome/Edge عبر بروتوكول DevTools (يتطلب Node ≥ 22 لـ WebSocket).
 * الاستخدام: node scripts/smoke.js <url> [مسار المتصفح]
 * يتحقق: لا أخطاء في الكونسول، التنقّل يعمل، الملفات التجريبية تُدمج، وتسجيل Service Worker عبر http. */
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const url = process.argv[2];
const exe = process.argv[3] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9400 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "tamim-smoke-"));
const browser = spawn(exe, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
};

(async () => {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
    if (!page) await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value || a.description).join(" "));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(2500);

  check("Tamim.core loaded", await evaluate("!!(window.Tamim && Tamim.core && Tamim.core.csv && Tamim.core.merge && Tamim.core.zip && Tamim.core.xlsx)"));
  check("home view shown by default", await evaluate("!document.querySelector('[data-view=home]').hidden"));
  await evaluate("location.hash = '#/merge'");
  await sleep(300);
  check("merge view shown after navigation", await evaluate("!document.querySelector('[data-view=merge]').hidden && document.querySelector('[data-view=home]').hidden"));
  check("title updated", (await evaluate("document.getElementById('viewTitle').textContent")) === "الدمج والتقسيم");
  await evaluate("document.getElementById('demoBtn').click()");
  await sleep(800);
  const rows = await evaluate("document.querySelectorAll('#previewTable tbody tr').length");
  check("demo files merged into preview rows", rows > 0, rows);
  const issues = await evaluate("document.querySelectorAll('#issuesList li').length");
  check("demo issues listed", issues > 0, issues);
  await evaluate("document.getElementById('splitToggleBtn').click()");
  await sleep(300);
  check("split section opens", await evaluate("!document.getElementById('splitSection').hidden"));
  if (url.startsWith("http")) {
    await sleep(1500);
    check("service worker registered", await evaluate("navigator.serviceWorker.getRegistration().then(r => !!r)"));
  }
  check("no console errors", errors.length === 0, errors);

  console.log(`\n${passed} passed, ${failed} failed`);
  ws.close();
  browser.kill();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL: smoke crashed | " + e); browser.kill(); process.exit(1); });
```

- [ ] **Step 2: التشغيل من file:// ومن خادم محلي (Chrome وEdge)**

```bash
cd /c/Users/user/Desktop/tamim-ops
node scripts/smoke.js "file:///$(cygpath -m "$PWD/index.html")"
python -m http.server 8765 >/dev/null 2>&1 & SRV=$!
sleep 1
node scripts/smoke.js "http://localhost:8765/index.html"
node scripts/smoke.js "http://localhost:8765/index.html" "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
kill $SRV
```
Expected: `0 failed` في الثلاثة (وفي http: `PASS: service worker registered`).

- [ ] **Step 3: Commit**

```bash
git add scripts && git commit -m "test: فحص حي للّوحة في المتصفح عبر DevTools"
```

### Task 6: الاختبارات قبل النشر + README

**Files:** Modify: `.github/workflows/deploy.yml`، `README.md`

- [ ] **Step 1: CI**

`.github/workflows/deploy.yml`:
```yaml
name: Test and publish to gh-pages

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run tests
        run: node tests/run.js

  publish:
    needs: test
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Mirror main into gh-pages
        run: git push --force origin HEAD:gh-pages
```

- [ ] **Step 2: README** — إعادة كتابة `README.md` بالعربية ثم ملخص إنجليزي: ما هي اللوحة، الأدوات الحالية (الدمج والتقسيم بكل ميزاته الحالية كما في README السابق)، العمل بدون نت والتثبيت، الخصوصية، التشغيل محليًا (`index.html` أو `python -m http.server`)، الاختبارات (`node tests/run.js` و`node scripts/smoke.js <url>`)، بنية الملفات (جدول خريطة الملفات أعلاه)، وأن الأدوات القادمة تُضاف تباعًا.

- [ ] **Step 3: التشغيل و Commit**

```bash
node tests/run.js && git add -A && git commit -m "ci: تشغيل الاختبارات قبل النشر + README للوحة"
```

### Task 7: الدمج في main، إعادة التسمية، النشر

- [ ] **Step 1: دمج الفرع**

```bash
cd /c/Users/user/Desktop/tamim-ops
git checkout main && git merge --ff-only phase1 && node tests/run.js
```

- [ ] **Step 2: إعادة تسمية المستودع** (يتطلب `gh auth login` من المالك)

```bash
gh auth status
gh repo rename tamim-ops --repo Mextox/csv-merger --yes
git remote set-url origin https://github.com/Mextox/tamim-ops.git
gh repo edit Mextox/tamim-ops --description "لوحة عمليات التميم — أدوات معالجة ملفات الكروت داخل المتصفح، تعمل بدون إنترنت" --homepage "https://mextox.github.io/tamim-ops/"
```

- [ ] **Step 3: الرفع ومتابعة النشر**

```bash
git push origin main
gh run watch --repo Mextox/tamim-ops --exit-status $(gh run list --repo Mextox/tamim-ops --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: نجاح مهمتَي `test` و`publish`.

- [ ] **Step 4: فحص حي للنسخة المنشورة**

```bash
sleep 60
node scripts/smoke.js "https://mextox.github.io/tamim-ops/"
```
Expected: `0 failed` مع `PASS: service worker registered`.

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

  check("Tamim.core loaded", await evaluate("!!(window.Tamim && Tamim.core && Tamim.core.csv && Tamim.core.merge && Tamim.core.zip && Tamim.core.xlsx && Tamim.core.profiles && Tamim.core.cards)"));
  check("home view shown by default", await evaluate("!document.querySelector('[data-view=home]').hidden"));

  // أول تشغيل: حوار اسم الجهاز
  const hadDialog = await evaluate("!!document.querySelector('dialog[open]')");
  check("first run asks for device name", hadDialog);
  if (hadDialog) {
    await evaluate("(() => { const d = document.querySelector('dialog[open]'); d.querySelector('input').value = 'جهاز الفحص'; d.querySelector('.btn-primary').click(); return true; })()");
    await sleep(400);
  }
  check("device name saved", (await evaluate("Tamim.app.store.meta('deviceName')")) === "جهاز الفحص");

  // الاستيراد من البداية للنهاية: ملف إعداد + ملف CSV ← فحص ← نتيجة ← سلة العمل ← الدمج
  await evaluate(`(async () => {
    const p = Object.assign(Tamim.core.profiles.defaultProfile(), {
      id: "smoke-1", name: "شركة الفحص",
      company: { from: "fixed", value: "smk" },
      categoryCodes: { "10": "10", "20": "20" },
      detect: { headers: ["PIN", "SN", "Value"], fileName: [], sheetNames: [] },
    });
    p.fields.pin = { names: ["PIN"], index: null };
    p.fields.serial = { names: ["SN"], index: null };
    p.fields.category = { from: "column", names: ["Value"], index: null };
    await Tamim.app.store.put("profiles", p);
    return true;
  })()`);
  await evaluate("location.hash = '#/import'");
  await sleep(400);
  await evaluate(`Tamim.tools.import.addFiles([new File(["PIN,SN,Value\\n111,S1,10\\n222,S2,10\\n333,S3,20\\n"], "supplier.csv", { type: "text/csv" })]).then(() => true)`);
  await sleep(600);
  check("import auto-detects profile", (await evaluate("document.querySelector('#importRoot .t-file-profile select').value")) === "smoke-1");
  await evaluate("[...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('معالجة')).click(); true");
  await sleep(800);
  check("import result shows 2 output files", (await evaluate("document.querySelectorAll('#importRoot .t-result tbody tr').length")) === 2);
  check("import reconcile ok", await evaluate("!!document.querySelector('#importRoot .t-reconcile.ok')"));
  // السيريالات فيها حروف (S1) ← تحذير NON_DIGIT يمنع التنزيل حتى التأكيد
  const dlDisabled = "[...document.querySelectorAll('#importRoot .t-result button')].find(b => b.textContent.includes('تنزيل')).disabled";
  check("warning blocks download until acknowledged", await evaluate(dlDisabled));
  await evaluate("document.querySelector('#importRoot .t-ack input').click(); true");
  await sleep(300);
  check("import download enabled after acknowledging", !(await evaluate(dlDisabled)));
  await evaluate("[...document.querySelectorAll('#importRoot .t-result button')].find(b => b.textContent.includes('سلة العمل')).click(); true");
  await sleep(300);
  check("workspace has 2 datasets", (await evaluate("Tamim.app.workspace.list().length")) === 2);
  await evaluate("location.hash = '#/home'");
  await sleep(300);
  check("home lists workspace items", (await evaluate("document.querySelectorAll('#homeRoot .t-workspace tbody tr').length")) === 2);
  await evaluate("[...document.querySelectorAll('#homeRoot .t-workspace button')].find(b => b.textContent.includes('إلى الدمج')).click(); true");
  await sleep(600);
  check("workspace item opened in merge", (await evaluate("document.querySelectorAll('#filesList .file-card').length")) === 1);
  check("merge preview has workspace rows", (await evaluate("document.querySelectorAll('#previewTable tbody tr').length")) === 2);
  await evaluate("document.getElementById('clearBtn').click(); Tamim.app.workspace.clear(); true");

  // نفس الملف مرتين باسمين مختلفين ← تحذير
  await evaluate("location.hash = '#/import'");
  await sleep(300);
  await evaluate(`(async () => { const clear = [...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('مسح الكل')); if (clear) clear.click();
    const body = "PIN,SN,Value\\n111,222,10\\n";
    await Tamim.tools.import.addFiles([new File([body], "a.csv"), new File([body], "b.csv")]); return true; })()`);
  await sleep(700);
  await evaluate("[...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('معالجة')).click(); true");
  await sleep(900);
  check("same file twice warns", await evaluate("[...document.querySelectorAll('#importRoot .issue')].some(li => li.textContent.includes('نفس الملف مضاف أكثر من مرة'))"));

  // حزمة الإعدادات: استيراد حزمة فيها ملف إعداد جديد ← جدول الفروق ← تطبيق
  await evaluate("location.hash = '#/settings'");
  await sleep(500);
  await evaluate(`(async () => {
    const p = Object.assign(Tamim.core.profiles.defaultProfile(), { id: "pack-1", name: "شركة من الحزمة", updatedAt: new Date().toISOString(), updatedBy: "جهاز آخر", company: { from: "fixed", value: "pk" } });
    p.fields.pin = { names: ["PIN"], index: null }; p.fields.serial = { names: ["SN"], index: null }; p.fields.category = { from: "column", names: ["Value"], index: null };
    const pack = Tamim.core.settingsPack.makePack({ device: "جهاز آخر", now: new Date().toISOString(), stores: { profiles: [p] } });
    const input = document.querySelector('#settingsRoot input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(pack)], "tamim-settings.json", { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    return true; })()`);
  await sleep(800);
  check("settings pack import shows the diff", await evaluate("[...document.querySelectorAll('#settingsRoot .t-pack td')].some(td => td.textContent === 'جديد')"));
  await evaluate("[...document.querySelectorAll('#settingsRoot .t-pack button')].find(b => b.textContent.includes('تطبيق')).click(); true");
  await sleep(900);
  check("settings pack applied", await evaluate("Tamim.app.store.all('profiles').then(ps => ps.some(p => p.id === 'pack-1' && p.updatedBy === 'جهاز آخر'))"));

  // ملف Excel محمي بكلمة سر: يُطلب الباسورد، ويُرفض الخاطئ، ويُفتح بالصحيح (الملف التجريبي: Tamim-123)
  if (url.startsWith("http")) {
    await evaluate("location.hash = '#/import'");
    await sleep(300);
    await evaluate(`(async () => { const clear = [...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('مسح الكل')); if (clear) clear.click();
      const buf = await (await fetch('tests/fixtures/encrypted-agile.xlsx')).arrayBuffer();
      window.__enc = Tamim.tools.import.addFiles([new File([buf], "مورد-محمي.xlsx")]); return true; })()`);
    await sleep(700);
    check("protected file asks for a password", await evaluate("!!document.querySelector('dialog[open] input[type=password]')"));
    await evaluate("(() => { const d = document.querySelector('dialog[open]'); d.querySelector('input').value = 'خطأ'; d.querySelector('.btn-primary').click(); return true; })()");
    await sleep(900);
    check("wrong password asks again", await evaluate("!!document.querySelector('dialog[open] .t-hint-error')"));
    await evaluate("(() => { const d = document.querySelector('dialog[open]'); d.querySelector('input').value = 'Tamim-123'; d.querySelector('.btn-primary').click(); return true; })()");
    await sleep(1200);
    await evaluate("window.__enc.then(() => true)");
    await sleep(400);
    check("protected file opened after correct password", await evaluate("!document.querySelector('#importRoot .t-file-error') && document.querySelectorAll('#importRoot .t-file-card').length === 1"));
    await evaluate("const clear = [...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('مسح الكل')); if (clear) clear.click(); true");
    await sleep(300);
  }

  // أداة التقسيم والتصدير: تمبلت أكواد + قالب Batch ← أخذ آخر 3 أسطر وتقسيمها، وسحب كمية بقالب
  await evaluate(`(async () => {
    await Tamim.app.store.put("templates", { id: "tpl-codes", kind: "codes", name: "ليبيانا", code: "10", categories: [{ name: "فئة 5", code: "5" }] });
    await Tamim.app.store.put("templates", { id: "tpl-batch", kind: "batch", name: "قالب 5", code: "5", start: "Batch:1\\n[BEGIN]", end: "[END]" });
    return true; })()`);
  const dropInto = async (root, name, text) => {
    await evaluate(`(() => { const input = document.querySelector('${root} input[type=file]');
      const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: "text/csv" }));
      input.files = dt.files; input.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(700);
  };
  const cardsCsv = ["p1,s1,10,5", "p2,s2,10,5", "p3,s3,10,5", "p4,s4,10,5", "p5,s5,10,5"].join("\n");
  const runStep = (root) => evaluate(`(() => { const b = [...document.querySelectorAll('${root} .btn-big')].find(x => !x.disabled); if (!b) return false; b.click(); return true; })()`);

  // DOJON: سحب كمية بقالب المورد — خطوات مرقّمة، وكمية لكل ملف، وجدول يشرح كل ملف ناتج
  await evaluate("location.hash = '#/pull'");
  await sleep(600);
  check("DOJON page shows numbered steps", (await evaluate("document.querySelectorAll('#pullRoot .t-step').length")) === 2);
  check("DOJON page names the old program", await evaluate("document.querySelector('#pullRoot .t-old-name').textContent.includes('DOJON')"));
  await dropInto("#pullRoot", "cards.csv", cardsCsv);
  check("DOJON found the export template from the file", await evaluate("document.querySelector('#pullRoot .file-meta').textContent.includes('قالب 5')"));
  check("DOJON says why it cannot run yet", await evaluate("document.querySelector('#pullRoot .t-hint').textContent.includes('الكمية')"));
  await evaluate(`(() => { const q = document.querySelector('#pullRoot .t-ask input');
    q.value = "3"; q.dispatchEvent(new Event('input')); return true; })()`);
  await sleep(300);
  check("DOJON enabled the action after the quantity", await evaluate("!document.querySelector('#pullRoot .btn-big').disabled"));
  check("«إضافة ملفات أخرى» opens the file picker, not a folder picker", (await evaluate(`(() => { let hit = "none";
    document.querySelectorAll('#pullRoot input[type=file]').forEach((i) => i.addEventListener('click', (e) => { hit = i.hasAttribute('webkitdirectory') ? 'folder' : 'files'; e.preventDefault(); }, true));
    [...document.querySelectorAll('#pullRoot button')].find((b) => b.textContent.includes('إضافة ملفات أخرى')).click(); return hit; })()`)) === "files");
  await runStep("#pullRoot");
  await sleep(600);
  check("DOJON lists both output files", (await evaluate("document.querySelectorAll('#pullRoot .t-step-result tbody tr').length")) === 2);
  check("DOJON explains the export file", await evaluate("document.querySelector('#pullRoot .t-step-result').textContent.includes('export/cards_1.csv')"));
  check("DOJON explains the remaining file", await evaluate("document.querySelector('#pullRoot .t-step-result').textContent.includes('ضعه مكان الملف القديم')"));

  // M_L: أخذ كروت وتقسيمها — التمبلت يُكتشف من الملف نفسه
  await evaluate("location.hash = '#/take'");
  await sleep(600);
  await dropInto("#takeRoot", "cards.csv", cardsCsv);
  check("M_L auto-detected the codes template", await evaluate("[...document.querySelectorAll('#takeRoot select')].some(s => s.selectedOptions[0].textContent.includes('ليبيانا'))"));
  check("M_L auto-detected the category", await evaluate("[...document.querySelectorAll('#takeRoot select')].some(s => s.selectedOptions[0].textContent.includes('فئة 5'))"));
  await evaluate(`(() => { const inputs = document.querySelectorAll('#takeRoot .t-grid input[inputmode=numeric]');
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
    set(inputs[0], "3"); set(inputs[1], "2"); return true; })()`); // آخر 3 أسطر، تقسيم كل 2
  await sleep(300);
  await runStep("#takeRoot");
  await sleep(600);
  check("M_L produced 2 parts + remaining", (await evaluate("document.querySelectorAll('#takeRoot .t-step-result tbody tr').length")) === 3);
  check("M_L summary says what was taken", await evaluate("document.querySelector('#takeRoot .t-summary').textContent.includes('أُخذ 3')"));

  // GEN: توليد أكواد ويُحفظ سجلها كبصمات فقط
  await evaluate("location.hash = '#/gen'");
  await sleep(600);
  await evaluate(`(() => { const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
    const inputs = document.querySelectorAll('#genRoot .t-grid input[type=text]');
    set(inputs[0], "5"); set(inputs[1], "8"); set(inputs[2], "77"); return true; })()`);
  await sleep(300);
  await runStep("#genRoot");
  await sleep(700);
  check("codes generated with serials", (await evaluate("document.querySelectorAll('#genRoot .t-step-result tbody tr').length")) === 5);
  check("generated codes have the right shape", await evaluate("/^\\d{8}$/.test(document.querySelector('#genRoot .t-step-result tbody td').textContent)"));
  check("GEN says what will be downloaded", await evaluate("document.querySelector('#genRoot .t-step-result').textContent.includes('ملف واحد سيُنزَّل')"));
  await evaluate("[...document.querySelectorAll('#genRoot button')].find(b => b.textContent.includes('حفظ في السجل')).click(); true");
  await sleep(800);
  check("code history saved (hashes only)", (await evaluate("Tamim.app.store.all('codes').then(c => c.length)")) === 5);
  check("history stores no code text", await evaluate("Tamim.app.store.all('codes').then(c => c.every(x => /^[0-9a-f]{32}$/.test(x.id)))"));

  // EXPORT_SN: استخراج عمود
  await evaluate("location.hash = '#/extract'");
  await sleep(600);
  await dropInto("#extractRoot", "cols.csv", "a1,b1,c1\na2,b2,c2\n");
  await runStep("#extractRoot");
  await sleep(500);
  check("column extraction result", await evaluate("document.querySelector('#extractRoot .t-step-result').textContent.includes('cols_serial.csv')"));
  check("column extraction counts lines", await evaluate("[...document.querySelectorAll('#extractRoot .t-step-result tbody td')].some(t => t.textContent === '2')"));

  // كل صفحة مهمة تفتح بعنوانها واسم البرنامج القديم وخطوة أولى جاهزة
  for (const [route, rootId] of [["pull", "pullRoot"], ["take", "takeRoot"], ["append", "appendRoot"], ["serial-add", "serialAddRoot"],
    ["extract", "extractRoot"], ["len", "lenRoot"], ["match", "matchRoot"], ["find", "findRoot"]]) {
    await evaluate(`location.hash = '#/${route}'`);
    await sleep(250);
    check(`page #/${route} has a title, an old name and a first step`,
      await evaluate(`(() => { const r = document.getElementById('${rootId}');
        return !!r.querySelector('.t-task-title') && !!r.querySelector('.t-old-name') && !!r.querySelector('.t-step'); })()`));
  }

  // معالج شركة جديدة: ملف بعناوين غير معروفة ← المعالج ← ملف إعداد جديد مختار تلقائيًا
  await evaluate("location.hash = '#/import'");
  await sleep(300);
  await evaluate(`(async () => { const clear = [...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('مسح الكل')); if (clear) clear.click();
    await Tamim.tools.import.addFiles([new File(["الرقم السري,رقم التسلسل,الفئة\\n5550001,8880001,10 LYD\\n5550002,8880002,10 LYD\\n"], "مورد-جديد.csv", { type: "text/csv" })]); return true; })()`);
  await sleep(500);
  check("unknown file offers the new-company wizard", await evaluate("!![...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('شركة جديدة'))"));
  await evaluate("[...document.querySelectorAll('#importRoot button')].find(b => b.textContent.includes('شركة جديدة')).click(); true");
  await sleep(500);
  check("wizard guessed pin/serial/category columns", (await evaluate("[...document.querySelectorAll('dialog[open] .t-wizard select')].slice(0, 2).map(s => s.value).join(',')")) === "0,1");
  check("wizard preview shows cards", (await evaluate("document.querySelectorAll('dialog[open] .t-wiz-preview tbody tr').length")) === 2);
  await evaluate(`(() => { const inputs = document.querySelectorAll('dialog[open] .t-wizard input[type=text]');
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
    set(inputs[0], 'مورد جديد'); set(inputs[1], 'new1');
    [...document.querySelectorAll('dialog[open] .btn-primary')][0].click(); return true; })()`);
  await sleep(800);
  check("wizard saved profile and selected it", await evaluate("document.querySelector('#importRoot .t-file-profile select').selectedOptions[0].textContent.includes('مورد جديد')"));
  check("new profile detects the file next time", (await evaluate("Tamim.app.store.all('profiles').then(ps => ps.find(p => p.name === 'مورد جديد').detect.headers.length)")) === 3);
  await evaluate("location.hash = '#/settings'");
  await sleep(400);
  check("settings lists the profile", (await evaluate("document.querySelector('#settingsRoot').textContent.includes('شركة الفحص')")));
  await evaluate("location.hash = '#/home'");
  await sleep(300);
  await evaluate("location.hash = '#/merge'");
  await sleep(300);
  check("merge view shown after navigation", await evaluate("!document.querySelector('[data-view=merge]').hidden && document.querySelector('[data-view=home]').hidden"));
  check("title updated", (await evaluate("document.getElementById('viewTitle').textContent")) === "الدمج والتوزيع");
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
    // العمل بدون نت: انتظر تفعيل الـ SW، اقطع الشبكة، أعد التحميل
    await evaluate("navigator.serviceWorker.ready.then(() => true)");
    await send("Network.enable");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await send("Page.reload", { ignoreCache: false });
    await sleep(2500);
    check("works offline after reload", await evaluate("!!(window.Tamim && Tamim.core && Tamim.core.xlsx) && !!document.getElementById('dropzone')"));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
  check("no console errors", errors.length === 0, errors);

  console.log(`\n${passed} passed, ${failed} failed`);
  ws.close();
  browser.kill();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL: smoke crashed | " + e); browser.kill(); process.exit(1); });

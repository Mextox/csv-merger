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

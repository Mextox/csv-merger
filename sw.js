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
  "css/tools.css",
  "js/app/version.js",
  "js/core/text.js",
  "js/core/csv.js",
  "js/core/merge.js",
  "js/core/zip.js",
  "js/core/xlsx.js",
  "js/core/batchtxt.js",
  "js/core/profiles.js",
  "js/core/cards.js",
  "js/core/settings-pack.js",
  "js/app/store.js",
  "js/app/workspace.js",
  "js/app/ui.js",
  "js/tools/home.js",
  "js/tools/wizard.js",
  "js/tools/import.js",
  "js/tools/merge.js",
  "js/tools/settings.js",
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

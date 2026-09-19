"use strict";
/* الحفظ في المتصفح (IndexedDB): ملفات الإعداد + بيانات الجهاز. الكروت لا تُحفظ هنا أبدًا.
 * قاعدة "tamim" — الإصدار 1: مخزن profiles (المفتاح id) ومخزن meta (مفتاح/قيمة). */
(function () {
  const T = (globalThis.Tamim = globalThis.Tamim || {});
  T.app = T.app || {};

  const DB_NAME = "tamim";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("المتصفح لا يدعم الحفظ المحلي (IndexedDB).")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("تعذّر فتح قاعدة البيانات المحلية."));
      req.onblocked = () => reject(new Error("قاعدة البيانات مفتوحة بإصدار أقدم في تبويب آخر — أغلق التبويبات الأخرى وأعد المحاولة."));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function run(storeName, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const st = tx.objectStore(storeName);
      let result;
      const req = fn(st);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("أُلغيت عملية الحفظ."));
    }));
  }

  const listeners = new Set();
  const notify = (store) => listeners.forEach((fn) => { try { fn(store); } catch (e) { console.error(e); } });

  const meta = (key) => run("meta", "readonly", (st) => st.get(key));
  const setMeta = (key, value) => run("meta", "readwrite", (st) => st.put(value, key)).then(() => notify("meta"));

  const all = (store) => run(store, "readonly", (st) => st.getAll()).then((r) => r || []);
  const get = (store, id) => run(store, "readonly", (st) => st.get(id));

  // يحفظ عنصرًا. keepMeta=true (عند الاستيراد من حزمة) يحفظه كما هو دون تغيير updatedAt/updatedBy.
  async function put(store, item, opts) {
    const copy = JSON.parse(JSON.stringify(item));
    if (!(opts && opts.keepMeta)) {
      copy.updatedAt = new Date().toISOString();
      copy.updatedBy = (await meta("deviceName")) || "";
    }
    await run(store, "readwrite", (st) => st.put(copy));
    await run("meta", "readwrite", (st) => st.put(new Date().toISOString(), "lastChangeAt"));
    notify(store);
    return copy;
  }

  async function remove(store, id) {
    await run(store, "readwrite", (st) => st.delete(id));
    await run("meta", "readwrite", (st) => st.put(new Date().toISOString(), "lastChangeAt"));
    notify(store);
  }

  async function persist() {
    if (!(navigator.storage && navigator.storage.persist)) return false;
    try { return await navigator.storage.persist(); } catch (e) { return false; }
  }
  async function persisted() {
    if (!(navigator.storage && navigator.storage.persisted)) return false;
    try { return await navigator.storage.persisted(); } catch (e) { return false; }
  }

  const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));

  T.app.store = { open, all, get, put, remove, meta, setMeta, persist, persisted, newId, on: (fn) => listeners.add(fn) };
})();

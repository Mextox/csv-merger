"use strict";
/* سلة العمل: نتائج الأدوات تبقى في ذاكرة الصفحة فقط لتنتقل بين الأدوات — لا تُحفظ أبدًا. */
(function () {
  const T = (globalThis.Tamim = globalThis.Tamim || {});
  T.app = T.app || {};

  const items = [];
  const listeners = new Set();
  let seq = 0;
  const notify = () => listeners.forEach((fn) => { try { fn(items.slice()); } catch (e) { console.error(e); } });

  // dataset: { name, header: string[] | null, rows: string[][], origin: { tool, files, profileId? } }
  function add(dataset) {
    const item = Object.assign({ id: "w" + ++seq, createdAt: new Date().toISOString() }, dataset);
    items.push(item);
    notify();
    return item.id;
  }
  const list = () => items.slice();
  const get = (id) => items.find((x) => x.id === id) || null;
  function remove(id) {
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) { items.splice(i, 1); notify(); }
  }
  function clear() { items.length = 0; notify(); }

  // تنبيه المتصفح القياسي قبل إغلاق صفحة فيها نتائج غير منزَّلة
  window.addEventListener("beforeunload", (e) => {
    if (items.length === 0) return;
    e.preventDefault();
    e.returnValue = "";
  });

  T.app.workspace = { add, list, get, remove, clear, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
})();

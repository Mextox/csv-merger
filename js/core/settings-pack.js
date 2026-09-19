"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.settingsPack = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function () {
/* =====================================================================
 * حزمة الإعدادات — منطق نقل الإعدادات بين الأجهزة عبر ملف JSON.
 * منطق خالص: لا يقرأ ولا يكتب IndexedDB (طبقة المتصفح منفصلة).
 * الاستيراد لا يحذف شيئًا أبدًا: يضيف الجديد ويحدّث الأحدث فقط.
 * ===================================================================== */

const FORMAT = "tamim-settings";
const FORMAT_VERSION = 1;
const KNOWN_VERSIONS = [1];
const META_FIELDS = ["updatedAt", "updatedBy"]; // لا تُعرض ضمن الحقول المختلفة

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// مساواة عميقة لقيم JSON: ترتيب مفاتيح الكائنات لا يهم، وترتيب عناصر المصفوفات يهم.
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function makePack({ device, now, stores }) {
  return { format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt: now, device, stores: copy(stores) };
}

// يعيد رسالة الخطأ الأولى في العنصر، أو "" إن كان سليمًا.
function itemError(item, store, index) {
  const where = `العنصر رقم ${index + 1} في "${store}"`;
  if (!isObject(item)) return `${where} ليس كائنًا صالحًا.`;
  if (typeof item.id !== "string" || item.id === "") return `${where} بلا معرّف (id) صالح.`;
  if (typeof item.updatedAt !== "string" || isNaN(Date.parse(item.updatedAt))) return `${where} بلا تاريخ تعديل (updatedAt) صالح.`;
  if (typeof item.name !== "string") return `${where} بلا اسم (name).`;
  return "";
}

function parsePack(text) {
  const fail = (error) => ({ ok: false, error });
  let pack;
  try {
    pack = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    return fail("الملف ليس بصيغة JSON صالحة.");
  }
  if (!isObject(pack)) return fail("محتوى الملف ليس ملف إعدادات صالحًا.");
  if (pack.format !== FORMAT) return fail("هذا الملف ليس ملف إعدادات لوحة التميم.");
  if (!KNOWN_VERSIONS.includes(pack.formatVersion)) {
    return fail(`إصدار ملف الإعدادات (${pack.formatVersion}) غير مدعوم في هذه النسخة من البرنامج.`);
  }
  if (!isObject(pack.stores)) return fail("ملف الإعدادات لا يحتوي على قسم الإعدادات (stores).");
  for (const [store, items] of Object.entries(pack.stores)) {
    if (!Array.isArray(items)) return fail(`القسم "${store}" في ملف الإعدادات ليس قائمة.`);
    for (let i = 0; i < items.length; i++) {
      const err = itemError(items[i], store, i);
      if (err) return fail(err);
    }
  }
  return { ok: true, pack };
}

// مفاتيح المستوى الأول المختلفة بين النسختين (بدون حقول التتبع)، مرتبة.
function differingFields(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !META_FIELDS.includes(k) && !deepEqual(a[k], b[k])).sort();
}

function diffPack(localStores, pack) {
  const entries = [];
  for (const [store, items] of Object.entries(pack.stores)) {
    const localList = (localStores && Array.isArray(localStores[store])) ? localStores[store] : [];
    const byId = new Map(localList.map((it) => [it.id, it]));
    for (const incoming of items) {
      const local = byId.has(incoming.id) ? byId.get(incoming.id) : null;
      const entry = { store, id: incoming.id, name: incoming.name, status: "new", apply: true, local, incoming, fields: [] };
      if (local) {
        // تطبيع العنصر المحلي بصيغة JSON (كما سيُصدَّر) قبل المقارنة
        const localPlain = copy(local);
        if (deepEqual(localPlain, incoming)) {
          entry.status = "same";
          entry.apply = false;
        } else {
          const incomingNewer = Date.parse(incoming.updatedAt) > Date.parse(local.updatedAt);
          entry.status = incomingNewer ? "incomingNewer" : "localNewer";
          entry.apply = incomingNewer;
          entry.fields = differingFields(localPlain, incoming);
        }
      }
      entries.push(entry);
    }
  }
  return entries;
}

function itemsToApply(diff) {
  return diff.filter((e) => e.apply === true).map((e) => ({ store: e.store, item: copy(e.incoming) }));
}

return { FORMAT, FORMAT_VERSION, makePack, parsePack, diffPack, itemsToApply };
});

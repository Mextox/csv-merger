"use strict";
const SP = require("../js/core/settings-pack.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });
// مقارنة عميقة مستقلة عن الوحدة: ترتيب مفاتيح الكائنات ثابت قبل التحويل إلى نص
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));
const deq = (name, got, want) => check(name, canon(got) === canon(want), { got, want });

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-02T10:00:00.000Z";
const T3 = "2026-09-03T10:00:00.000Z";
const prof = (id, extra) => Object.assign({ id, name: "ملف " + id, updatedAt: T1, updatedBy: "pc-1", rules: { a: 1 } }, extra);

/* ---------- الثوابت و makePack ---------- */
eq("FORMAT", SP.FORMAT, "tamim-settings");
eq("FORMAT_VERSION", SP.FORMAT_VERSION, 1);

const source = { profiles: [prof("p1"), prof("p2", { tags: ["x", "y"] })] };
const pack = SP.makePack({ device: "جهاز المكتب", now: T3, stores: source });
eq("makePack format", pack.format, "tamim-settings");
eq("makePack formatVersion", pack.formatVersion, 1);
eq("makePack exportedAt", pack.exportedAt, T3);
eq("makePack device", pack.device, "جهاز المكتب");
deq("makePack stores content", pack.stores, source);
source.profiles[0].rules.a = 99;
source.profiles.push(prof("p3"));
eq("makePack deep copy (nested mutation)", pack.stores.profiles[0].rules.a, 1);
eq("makePack deep copy (array mutation)", pack.stores.profiles.length, 2);

/* ---------- parsePack: رحلة كاملة ---------- */
const rt = SP.parsePack(JSON.stringify(pack));
check("round trip ok", rt.ok === true, rt);
deq("round trip pack equals original", rt.pack, pack);

/* ---------- parsePack: حالات الرفض ---------- */
function rejects(name, text, mustInclude) {
  const r = SP.parsePack(text);
  const msg = r && r.error;
  check("reject " + name, r && r.ok === false && typeof msg === "string" && msg.length > 0, r);
  (mustInclude || []).forEach((s) => check(`reject ${name} mentions "${s}"`, typeof msg === "string" && msg.includes(s), msg));
}
const good = () => JSON.parse(JSON.stringify(pack));
const withItem = (item) => { const p = good(); p.stores.profiles[1] = item; return JSON.stringify(p); };

rejects("invalid JSON", "{not json");
rejects("empty text", "");
rejects("null", "null");
rejects("array root", "[]");
rejects("number root", "42");
rejects("wrong format", JSON.stringify(Object.assign(good(), { format: "other-app" })));
rejects("missing format", JSON.stringify(Object.assign(good(), { format: undefined })));
rejects("unknown formatVersion 2", JSON.stringify(Object.assign(good(), { formatVersion: 2 })), ["2"]);
rejects("formatVersion as string", JSON.stringify(Object.assign(good(), { formatVersion: "1" })));
rejects("missing stores", JSON.stringify(Object.assign(good(), { stores: undefined })));
rejects("stores is array", JSON.stringify(Object.assign(good(), { stores: [] })));
rejects("store not an array", JSON.stringify(Object.assign(good(), { stores: { profiles: {} } })), ["profiles"]);
rejects("item not an object", withItem("p2"), ["profiles", "2"]);
rejects("item missing id", withItem({ name: "x", updatedAt: T1, updatedBy: "pc" }), ["profiles", "2"]);
rejects("item numeric id", withItem({ id: 5, name: "x", updatedAt: T1, updatedBy: "pc" }), ["profiles", "2"]);
rejects("item empty id", withItem({ id: "", name: "x", updatedAt: T1, updatedBy: "pc" }), ["profiles", "2"]);
rejects("item missing updatedAt", withItem({ id: "p2", name: "x", updatedBy: "pc" }), ["profiles", "2"]);
rejects("item updatedAt not a date", withItem({ id: "p2", name: "x", updatedAt: "yesterday", updatedBy: "pc" }), ["profiles", "2"]);
rejects("item updatedAt not a string", withItem({ id: "p2", name: "x", updatedAt: 1756720800000, updatedBy: "pc" }), ["profiles", "2"]);
rejects("item missing name", withItem({ id: "p2", updatedAt: T1, updatedBy: "pc" }), ["profiles", "2"]);

const emptyStores = SP.parsePack(JSON.stringify(Object.assign(good(), { stores: {} })));
check("accepts empty stores object", emptyStores.ok === true, emptyStores);

/* ---------- diffPack: الحالات الأربع في حزمة واحدة ---------- */
const local = {
  profiles: [
    prof("same", { rules: { a: 1, b: [1, 2] } }),
    prof("older", { updatedAt: T1 }),
    prof("newer", { updatedAt: T3, rules: { a: 5 } }),
    prof("tie", { updatedAt: T2, rules: { a: 1 } }),
    prof("localOnly"),
  ],
};
const incomingPack = SP.makePack({
  device: "جهاز 2", now: T3,
  stores: {
    profiles: [
      prof("new1"),
      // نفس المحتوى بترتيب مفاتيح مختلف (حتى داخل الكائنات المتداخلة) ← same
      { rules: { b: [1, 2], a: 1 }, updatedBy: "pc-1", updatedAt: T1, name: "ملف same", id: "same" },
      prof("older", { updatedAt: T2, updatedBy: "pc-2", name: "اسم جديد", rules: { a: 2 } }),
      prof("newer", { updatedAt: T2, rules: { a: 7 } }),
      prof("tie", { updatedAt: T2, rules: { a: 9 } }),
    ],
  },
});
const diff = SP.diffPack(local, incomingPack);
deq("diff ids in pack order", diff.map((e) => e.id), ["new1", "same", "older", "newer", "tie"]);
deq("diff statuses", diff.map((e) => e.status), ["new", "same", "incomingNewer", "localNewer", "localNewer"]);
deq("diff apply flags", diff.map((e) => e.apply), [true, false, true, false, false]);
check("diff entries carry store", diff.every((e) => e.store === "profiles"), diff.map((e) => e.store));
deq("diff entries carry name from incoming", diff.map((e) => e.name), ["ملف new1", "ملف same", "اسم جديد", "ملف newer", "ملف tie"]);
check("new: local is null", diff[0].local === null, diff[0].local);
deq("new: fields empty", diff[0].fields, []);
check("new: incoming is pack item", diff[0].incoming === incomingPack.stores.profiles[0]);
check("same: local is the local item", diff[1].local === local.profiles[0]);
deq("same (key order only): fields empty", diff[1].fields, []);
deq("incomingNewer fields sorted, exclude updatedAt/updatedBy", diff[2].fields, ["name", "rules"]);
deq("localNewer fields", diff[3].fields, ["rules"]);
check("equal timestamps + different content -> localNewer", diff[4].status === "localNewer" && diff[4].apply === false, diff[4]);
check("local-only item produces no entry", !diff.some((e) => e.id === "localOnly"));

// لا فرق إلا في updatedAt: ليس "same" لأن المقارنة تشمل كل الحقول، لكن fields فارغة
const tsOnly = SP.diffPack({ profiles: [prof("p", { updatedAt: T1 })] }, SP.makePack({ device: "d", now: T3, stores: { profiles: [prof("p", { updatedAt: T2 })] } }));
eq("timestamp-only change -> incomingNewer", tsOnly[0].status, "incomingNewer");
deq("timestamp-only change -> fields empty", tsOnly[0].fields, []);

// ترتيب عناصر المصفوفات مهم
const arr = SP.diffPack({ profiles: [prof("p", { list: [1, 2] })] }, SP.makePack({ device: "d", now: T3, stores: { profiles: [prof("p", { list: [2, 1] })] } }));
check("array order difference is not same", arr[0].status !== "same", arr[0].status);
deq("array order difference listed in fields", arr[0].fields, ["list"]);

// حقل موجود في جهة واحدة فقط يظهر في fields
const extraKey = SP.diffPack({ profiles: [prof("p", { updatedAt: T1, old: "x" })] }, SP.makePack({ device: "d", now: T3, stores: { profiles: [prof("p", { updatedAt: T2, added: true })] } }));
deq("keys present on one side only listed in fields", extraKey[0].fields, ["added", "old"]);

// مخزن غير معروف محليًا يُقارن بنفس الطريقة (كل عناصره جديدة)، ومخزن معروف بعنصر same
const unknown = SP.diffPack(
  { profiles: [prof("p1")], widgets: [{ id: "w1", name: "أداة", updatedAt: T1, updatedBy: "pc", size: 2 }] },
  SP.makePack({ device: "d", now: T3, stores: {
    profiles: [prof("p1")],
    widgets: [{ id: "w1", name: "أداة", updatedAt: T2, updatedBy: "pc", size: 3 }],
    futureStore: [{ id: "f1", name: "مستقبلي", updatedAt: T1, updatedBy: "pc" }],
  } }));
deq("generic stores: store names", unknown.map((e) => e.store), ["profiles", "widgets", "futureStore"]);
deq("generic stores: statuses", unknown.map((e) => e.status), ["same", "incomingNewer", "new"]);
deq("generic stores: widget fields", unknown[1].fields, ["size"]);
deq("store missing locally -> new with null local", [unknown[2].status, unknown[2].local], ["new", null]);

deq("no local stores at all -> everything new", SP.diffPack({}, incomingPack).map((e) => e.status), ["new", "new", "new", "new", "new"]);

/* ---------- itemsToApply ---------- */
const toApply = SP.itemsToApply(diff);
deq("itemsToApply only apply=true", toApply.map((x) => x.store + "/" + x.item.id), ["profiles/new1", "profiles/older"]);
deq("itemsToApply uses incoming item content", toApply[1].item, diff[2].incoming);
check("itemsToApply item is a copy, not the same object", toApply[1].item !== diff[2].incoming);
toApply[1].item.rules.a = 1000;
toApply[1].item.name = "تعديل";
eq("mutating result does not change diff incoming (nested)", diff[2].incoming.rules.a, 2);
eq("mutating result does not change diff incoming (top-level)", diff[2].incoming.name, "اسم جديد");
deq("itemsToApply on empty diff", SP.itemsToApply([]), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

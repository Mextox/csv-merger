# لوحة عمليات التميم — خطة الدفعة 1ب (الاستيراد)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** أداة "استيراد كروت المورد" بملفات إعدادات الشركات، مع الفحوص، والحفظ في المتصفح، وحزمة الإعدادات، وسلة العمل، ومحرّر ملفات الإعداد.

**Architecture:** منطق نقي مختبَر في `js/core/{text,batchtxt,profiles,cards,settings-pack}.js` (نفس غلاف الوحدات في 1أ)، وطبقة متصفح في `js/app/{store,workspace,ui}.js`، وثلاث أدوات واجهة `js/tools/{import,settings,home}.js`. الواجهة لا تحتوي أي منطق تحويل؛ كل قرار في core.

**Tech Stack:** JavaScript عادي، IndexedDB، Node ≥ 20 للاختبارات.

**المرجع:** وثيقة التصميم، الأقسام 4–10. أرقام الأقسام أدناه تشير إليها.

---

## الواجهات (العقود بين الوحدات)

### `js/core/text.js` → `Tamim.core.text`
| الدالة | السلوك |
|---|---|
| `normalizeCell(v)` | `null/undefined` ← `""`؛ نص؛ حذف المسافات في الطرفين؛ أرقام عربية/فارسية ← لاتينية؛ `^-?\d+\.0+$` ← بلا كسور |
| `normalizeKey(s)` | `normalizeCell` + أحرف صغيرة + دمج المسافات المتتالية |
| `digitsOnly(s)` | الأرقام فقط |
| `firstNumber(s)` / `lastNumber(s)` | أول/آخر عدد متصل، أو `""` |
| `editDistance(a, b)` | مسافة ليفنشتاين |
| `isScientific(s)` | يطابق `^\d(\.\d+)?[eE]\+?\d+$` |
| `hasPrecisionLoss(raw)` | يحتوي `e/E`، أو عدد الأرقام (بعد حذف الإشارة والفاصلة العشرية والأصفار البادئة) > 15 |

### `js/core/xlsx.js` (إضافة، بلا كسر الواجهة الحالية)
- `cellValue(t, content, sst, sAttr, styleFmts, date1904, flag)` — `flag` اختياري: يُستدعى بـ `"lossy"` لخلية رقمية غير تاريخ `hasPrecisionLoss(raw)`، وبـ `"date"` لخلية رقمية حُوّلت إلى تاريخ.
- `parseSheet(xml, sst, styleFmts, date1904, flags)` — `flags` اختياري `{ lossy: [], date: [] }` يُملأ بـ `{ row, col }` (فهارس صفرية في الصفوف الناتجة).
- `parseXlsx(bytes)` — كل عنصر ناتج يضاف له `flags: { lossy, date }`.

### `js/core/batchtxt.js` → `Tamim.core.batchtxt`
- `parseBatchTxt(text)` → `{ header: {مفتاح: قيمة}, rows: string[][], lines: number[], issues: [] }`
  - الرأس: أسطر `مفتاح:قيمة` قبل `[BEGIN]`. البيانات بين `[BEGIN]` و`[END]`، كل سطر غير فارغ يُقسَّم على المسافات.
  - غياب `[BEGIN]` أو `[END]` ← `BATCH_FORMAT` (error). سطر عدد أجزائه ≠ العدد الأكثر تكرارًا ← `BATCH_FORMAT` (error) برقم السطر.
  - `Quantity` في الرأس ≠ عدد الأسطر ← `BATCH_QUANTITY` (error).

### `js/core/profiles.js` → `Tamim.core.profiles`
| الدالة | السلوك |
|---|---|
| `defaultProfile()` | ملف إعداد فارغ بالقيم الافتراضية (القسم 5.1) |
| `validateProfile(p)` | `{ ok, errors: string[] }` — كل عملية ومعامل ومصدر معروف، الحقول المطلوبة موجودة |
| `scoreProfile(p, info)` | `info = { fileName, headers: string[] \| null, sheetNames: string[] }` ← 0–100 (القسم 5.6) |
| `rankProfiles(list, info)` | `[{ profile, score }]` تنازليًا + `decision: "auto" \| "confirm" \| "manual"` |
| `resolveColumn(ref, headers)` | `{ index, byIndex }` أو `{ error }` (القسم 5.2) |
| `readSource(p, source)` | `source = { fileName, sheets: [{ sheetName, rows, flags }] }` أو `{ fileName, batch }` ← جداول موحّدة `[{ sheet, headers, dataRows, rowNumbers, flags }]` + `issues` |
| `applyProfile(p, source, answers)` | `answers = { company, category }` للقيم `ask` ← `{ records, readRows, skippedEmpty, issues }`؛ كل سجل `{ pin, serial, company, categoryRaw, file, sheet, row, srcFlags }` |

### `js/core/cards.js` → `Tamim.core.cards`
| الدالة | السلوك |
|---|---|
| `missingCategoryCodes(records, codes)` | الفئات الخام التي ليس لها كود، مع اقتراح `digitsOnly` لكل منها |
| `assignCodes(records, codes)` | `{ cards: [{ pin, serial, company, category, … }], issues }` — `NO_CATEGORY_CODE`/`NO_COMPANY_CODE` |
| `checkCards(cards, opts)` | الفحوص: `EMPTY_FIELD`، `PRECISION_LOST`، `DATE_FORMATTED_ID`، `DUP_PIN`، `DUP_SERIAL`، `LENGTH_OUTLIER`، `NON_DIGIT` (القسم 7) |
| `buildOutputs(cards, output, meta)` | `[{ company, fileName, path, rows, text }]` + `issues` (`NAME_COLLISION`) — القسم 5.5 |
| `encodeOutput(text, output)` | `Uint8Array` مع/بدون BOM |
| `summarize(result)` | عدد لكل (شركة، فئة) + معادلة المطابقة |

شكل كل فحص: `{ level: "error"|"warning"|"info", code, message, file, sheet, rows: number[] }`.

### `js/core/settings-pack.js` → `Tamim.core.settingsPack`
- `makePack({ device, now, stores })` → كائن الحزمة (القسم 9.2).
- `parsePack(text)` → `{ ok, pack }` أو `{ ok: false, error }`.
- `diffPack(localStores, pack)` → `[{ store, id, name, status: "new"|"same"|"incomingNewer"|"localNewer", apply: boolean, local, incoming, fields: string[] }]`.
- `itemsToApply(diff)` → `[{ store, item }]` لما `apply === true`.

### طبقة المتصفح
- `js/app/store.js` → `Tamim.app.store`: `open()`, `all(store)`, `put(store, item)` (يضبط `updatedAt/updatedBy`)، `remove(store, id)`, `meta(key)`, `setMeta(key, value)`, `persist()`. قاعدة `tamim` إصدار 1، مخزنا `profiles` و`meta`.
- `js/app/workspace.js` → `Tamim.app.workspace`: `add(dataset)`, `list()`, `remove(id)`, `clear()`, `on(fn)`؛ تنبيه `beforeunload` عند عدم الفراغ.
- `js/app/ui.js` → `Tamim.app.ui`: `el(tag, attrs, children)`, `dropzone(opts)`, `issuesList(issues)`, `download(name, bytes, type)`, `dialog(opts)`.

---

## المهام

### Task 1: `text.js` + اختبارات
- [ ] اختبارات `tests/text.test.js`: الأرقام العربية `"١٢٣"`→`"123"`، `"12345.0"`→`"12345"`، `"12.50"` يبقى، `normalizeKey(" PIN  Code ")`→`"pin code"`، `firstNumber("Order #3830 - LTT - 10 LYD")`→`"3830"`، `lastNumber`→`"10"`، `editDistance("etisalst","etisalat")`→`1`، `isScientific("1.23E+15")`، `hasPrecisionLoss("1234567890123456")` صحيح و`"123456789012345"` خطأ و`"000123"` خطأ و`"1.5E+3"` صحيح.
- [ ] التنفيذ، التشغيل، commit.

### Task 2: علامات فقد الدقة والتاريخ في `xlsx.js`
- [ ] اختبارات `tests/xlsx-flags.test.js` (بمصنّف يُبنى في الاختبار بـ `buildZip`): خلية رقمية `1234567890123456` ← `lossy`؛ `1.23456789012346E+19` ← `lossy`؛ `12345` ← لا شيء؛ خلية بنمط تاريخ ← `date`؛ خلية نصية طويلة ← لا شيء. الـ 181 القديمة تبقى ناجحة.
- [ ] التنفيذ (معامل اختياري فقط)، commit.

### Task 3: `batchtxt.js`
- [ ] اختبارات: ملف سليم (رأس + 3 أسطر)؛ `Quantity:4` مع 3 أسطر ← `BATCH_QUANTITY`؛ بلا `[END]` ← `BATCH_FORMAT`؛ سطر بثلاثة أجزاء بين أسطر بجزأين ← `BATCH_FORMAT` برقم السطر؛ أسطر فارغة بين البيانات تُتجاهل.
- [ ] التنفيذ، commit.

### Task 4: `profiles.js` — المخطط والتحقق والتعرّف
- [ ] اختبارات: `validateProfile(defaultProfile())` ناجح بعد تعبئة الحقول المطلوبة؛ عملية مجهولة ← خطأ يذكر موضعها؛ `scoreProfile` حسب الجدول (عناوين 2/3 مع اسم ملف مطابق = 100×(60×⅔+25)/85)؛ ملف إعداد بلا معايير ← 0؛ `rankProfiles` يعطي `auto` ≥ 70، `confirm` 40–69، `manual` < 40 أو تعادل.
- [ ] التنفيذ، commit.

### Task 5: `profiles.js` — القراءة والقواعد
- [ ] اختبارات لكل مصدر ولكل قاعدة (القسم 5.2 و5.3): عمود بالاسم/الجزئي/الرقم (`COLUMN_BY_INDEX`)؛ فئة من اسم الملف (أول/آخر رقم)، من اسم الورقة، من رأس Batch، ثابتة، `ask`؛ شركة ثابتة/`ask`/عمود+`map`/اسم ورقة مع `fuzzy` (`FUZZY_COMPANY`)؛ `fillDown`، `digitsOnly`، `padStart`، `concat` (يقرأ القيم الأصلية)، `copy`، `replace`، `map` (صارم ← `MAP_STRICT`)، `prefixIf`؛ الصف الفارغ يُحدَّد قبل القواعد؛ تخطّي الأوراق حسب `skipSheets`؛ `header: "no"`.
- [ ] التنفيذ، commit.

### Task 6: `cards.js`
- [ ] اختبارات: `missingCategoryCodes`؛ `assignCodes`؛ كل فحص في القسم 7 (بما فيها عدم فحص تكرار السيريال عندما يكون منسوخًا من السري)؛ `buildOutputs` (تجميع بالشركة ثم الفئة، `groupBy: none`، `chunkSize`، المتغيرات `{company}{category}{categoryRaw}{part}{source}{sourceNumber}{date}`، التصادم `_2`، الاقتباس كـ Python csv، الفاصل، العناوين، نهاية السطر)؛ `encodeOutput` مع/بدون BOM؛ `summarize` ومعادلة المطابقة.
- [ ] التنفيذ، commit.

### Task 7: `settings-pack.js`
- [ ] اختبارات: `makePack`/`parsePack` ذهابًا وإيابًا؛ رفض `format` أو `formatVersion` مجهول أو JSON تالف؛ `diffPack` للحالات الأربع والقيم الافتراضية لـ `apply`؛ `fields` تذكر الحقول المختلفة؛ العنصر غير الصالح يُرفض؛ `itemsToApply`.
- [ ] التنفيذ، commit.

### Task 8: طبقة المتصفح (`store`, `workspace`, `ui`)
- [ ] `store.js` بواجهة القسم أعلاه؛ `workspace.js`؛ `ui.js`.
- [ ] تحديث `index.html` (السكربتات بالترتيب)، `sw.js` (ASSETS)، رفع الإصدار إلى 9؛ اختبار `app-shell` يمر.
- [ ] commit.

### Task 9: أداة الإعدادات (`#/settings`)
- [ ] قائمة ملفات الإعداد، جديد/تعديل (نموذج + JSON مع تحقّق قبل الحفظ)/حذف مع تأكيد، اسم الجهاز، تصدير الحزمة، استيراد الحزمة مع جدول الفروق والاختيار، حالة الحفظ الدائم.
- [ ] فحص حي (`scripts/smoke.js` يُمدَّد)، commit.

### Task 10: أداة الاستيراد (`#/import`)
- [ ] الخطوات السبع في القسم 8 (المعالج والتشفير في 1ج: ملف مشفّر ← رسالة "غير مدعوم بعد" واضحة).
- [ ] فحص حي بملفات تجريبية، commit.

### Task 11: الرئيسية وسلة العمل وربط الدمج
- [ ] الرئيسية: سلة العمل (قائمة، حذف، تفريغ)، تنبيه النسخ الاحتياطي (القسم 9.2)، طلب اسم الجهاز عند أول تشغيل.
- [ ] أداة الدمج: زر "إضافة من سلة العمل".
- [ ] commit.

### Task 12: تحقق نهائي
- [ ] `node tests/run.js`، والفحص الحي من `file://` و`http` في Chrome وEdge، ومراجعة الكود.

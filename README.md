# 🧩 دمج ملفات CSV — CSV Merger

**أداة ويب احترافية لدمج عدة ملفات CSV في ملف واحد، مع فحص ذكي للتناقضات والأخطاء الشائعة — تعمل بالكامل داخل المتصفح ولا يُرفع أو يُخزَّن أي شيء.**

### 🔗 جرّبها الآن: <https://mextox.github.io/csv-merger/>

---

## المميزات

- **ارفع ملفًا أو أكثر** بالسحب والإفلات أو الاختيار، وشاهد الدمج والمعاينة فورًا.
- **خصوصية كاملة:** كل المعالجة تتم عبر JavaScript داخل متصفحك — لا خادم، لا رفع، لا تخزين، لا أي تبعيات خارجية.
- **حذف الأعمدة غير المطلوبة:** اضغط ✕ فوق أي عمود في المعاينة لاستبعاده من الناتج ومن التقسيم — ويعود بالضغط على "إعادة الضبط التلقائي".
- **التقسيم حسب الشركات (تقسيم الكروت):** وزّع صفوف كل ملف (فئة) على عدة شركات بأعداد تحددها أنت، مع خيار "دمج" لكل شركة (ملف واحد مدموج أو ملف لكل فئة)، والناتج ملف **ZIP** فيه مجلد لكل شركة ومجلد "المتبقي".
- **دعم الملفات بدون صف عناوين:** تُكتشف تلقائيًا (مع مفتاح تحكم يدوي لكل ملف)، وتُدمج بمحاذاة موضعية، وإذا كانت كل الملفات بدون رأس فلن يُضاف صف عناوين للناتج.
- **اكتشاف تلقائي** لفاصل الأعمدة (`,` `;` `Tab` `|`) ولترميز الملف (UTF-8 / UTF-16 / Windows-1256) حتى لا تظهر الحروف العربية مشوهة.
- **محاذاة الأعمدة بالاسم** وليس بالموقع، مع خيار اتحاد كل الأعمدة أو الأعمدة المشتركة فقط.
- **تنزيل الناتج** بترميز UTF-8 مع BOM ليفتح في Excel بشكل صحيح (وكذلك كل ملفات الـ ZIP).

## التقسيم حسب الشركات

بعض العملاء يريدون الملفات مدموجة، وبعضهم يريد كل فئة في ملف منفصل. زر **"تقسيم"** يفتح قسمًا تكتب فيه اسم الشركة وعدد الكروت (الصفوف) التي تأخذها من كل فئة:

- التوزيع **تسلسلي** من أعلى كل ملف: الشركة الأولى تأخذ أول N صف، ثم التي تليها، وهكذا. ما لم يُوزَّع يبقى في "المتبقي".
- الأعداد تُقصّ تلقائيًا حتى لا تتجاوز المتاح، مع عرض المتبقي لكل فئة مباشرةً.
- لكل شركة مربع **"دمج"**: إن فُعّل تُجمع كروتها من كل الفئات في ملف CSV واحد (بنفس منطق الدمج والمحاذاة)، وإن أُلغي تحصل على ملف CSV لكل فئة (بأعمدة الملف الأصلية، والملفات بلا رأس تبقى بلا رأس).
- عند الاستخراج إذا بقيت صفوف بلا شركة يسألك: استخراج المتبقي مدموجًا أم بدون دمج.
- الناتج **ملف ZIP** واحد (مبني بالكامل داخل المتصفح، طريقة STORE بلا ضغط، بلا أي مكتبات) فيه مجلد باسم كل شركة + مجلد "المتبقي" عند الحاجة.

## الفحوصات الذكية

قبل الدمج تعرض الأداة قائمة مصنّفة (خطأ / تحذير / ملاحظة) تكشف:

| الفحص | مثال |
|---|---|
| أعمدة إضافية أو ناقصة بين الملفات | عمود "الهاتف" موجود في ملف واحد فقط |
| ملف بدون صف عناوين | الصف الأول يحتوي أرقامًا أو بريدًا — يُعامل كبيانات ولا يُفرض عليه رأس |
| جدول إضافي مدموج داخل الملف | صف العناوين مكرر وسط البيانات |
| صفوف عدد حقولها لا يطابق الأعمدة | فاصلة داخل نص غير محاط بعلامات اقتباس |
| قيم شاذة في عمود رقمي أو تاريخ | "خمسة وأربعون" وسط أعمار رقمية |
| عناوين مكررة أو فارغة أو بمسافات زائدة | يُعاد تسميتها تلقائيًا |
| اختلاف ترتيب الأعمدة أو حالة الأحرف | "Email" و "email" |
| صفوف مكررة داخل الملف أو بين الملفات | مع خيار حذفها |
| صفوف فارغة، ملفات فارغة، علامات اقتباس غير مغلقة | |

## خيارات الدمج

- اتحاد كل الأعمدة (الافتراضي) أو الأعمدة المشتركة فقط
- تجاهل الصفوف الفارغة
- إزالة الصفوف المكررة
- تجاهل حالة الأحرف في أسماء الأعمدة
- إضافة عمود باسم الملف المصدر
- مفتاح "الصف الأول عناوين" لكل ملف على حدة
- حذف أي عمود من الناتج، وإعادة ترتيب الأعمدة بالسحب

## التشغيل محليًا

لا يحتاج أي تبعيات أو خطوة بناء — افتح `index.html` في المتصفح مباشرة، أو:

```bash
git clone https://github.com/Mextox/csv-merger.git
cd csv-merger
# أي خادم ملفات ثابتة، مثلًا:
python -m http.server 8000
```

## الاختبارات

منطق التحليل والدمج والتقسيم وكاتب الـ ZIP مغطّى بـ 106 اختبار وحدة:

```bash
node test.js
```

---

## English

**CSV Merger** — a professional client-side tool that merges multiple CSV files into one, with smart consistency checks (schema differences, stacked tables, ragged rows, type outliers, duplicates, encoding issues, headerless files). Everything runs in your browser via vanilla JavaScript — **nothing is ever uploaded or stored, no dependencies, no CDN**.

Key features:

- **Delete unwanted columns** — click ✕ on any output column to exclude it from the merged download *and* from the split output; restore with "reset".
- **Split by company** — allocate each file's rows (a "category") across several companies with per-category counts (sequential from the top, auto-clamped to what's available). Each company has a **merge** toggle: merged → one CSV; unmerged → one CSV per category (keeping that file's own columns; headerless files stay headerless). Leftover rows go to a remainder folder. The result is a single **ZIP** file with one folder per company — built entirely in-browser with a dependency-free STORE-method ZIP writer (CRC-32 + local headers + central directory + EOCD, UTF-8 filename flag for Arabic).
- Auto-detects delimiter, encoding (UTF-8 / UTF-16 / Windows-1256), and whether each file has a header row (with a per-file manual toggle); aligns columns by name — or by position for headerless files — and exports UTF-8 CSV with BOM for Excel compatibility. When all files are headerless, the merged output contains no header row.

**Live:** <https://mextox.github.io/csv-merger/> · Run tests with `node test.js` (106 unit tests) · No dependencies, no build step.

## License

[MIT](LICENSE)

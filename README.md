# 🧩 دمج ملفات CSV — CSV Merger

**أداة ويب احترافية لدمج عدة ملفات CSV في ملف واحد، مع فحص ذكي للتناقضات والأخطاء الشائعة — تعمل بالكامل داخل المتصفح ولا يُرفع أو يُخزَّن أي شيء.**

### 🔗 جرّبها الآن: <https://mextox.github.io/csv-merger/>

---

## المميزات

- **ارفع ملفًا أو أكثر** بالسحب والإفلات أو الاختيار، وشاهد الدمج والمعاينة فورًا.
- **خصوصية كاملة:** كل المعالجة تتم عبر JavaScript داخل متصفحك — لا خادم، لا رفع، لا تخزين.
- **دعم الملفات بدون صف عناوين:** تُكتشف تلقائيًا (مع مفتاح تحكم يدوي لكل ملف)، وتُدمج بمحاذاة موضعية، وإذا كانت كل الملفات بدون رأس فلن يُضاف صف عناوين للناتج.
- **اكتشاف تلقائي** لفاصل الأعمدة (`,` `;` `Tab` `|`) ولترميز الملف (UTF-8 / UTF-16 / Windows-1256) حتى لا تظهر الحروف العربية مشوهة.
- **محاذاة الأعمدة بالاسم** وليس بالموقع، مع خيار اتحاد كل الأعمدة أو الأعمدة المشتركة فقط.
- **تنزيل الناتج** بترميز UTF-8 مع BOM ليفتح في Excel بشكل صحيح.

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

## التشغيل محليًا

لا يحتاج أي تبعيات أو خطوة بناء — افتح `index.html` في المتصفح مباشرة، أو:

```bash
git clone https://github.com/Mextox/csv-merger.git
cd csv-merger
# أي خادم ملفات ثابتة، مثلًا:
python -m http.server 8000
```

## الاختبارات

منطق التحليل والدمج مغطى بـ 58 اختبار وحدة:

```bash
node test.js
```

---

## English

**CSV Merger** — a professional client-side tool that merges multiple CSV files into one, with smart consistency checks (schema differences, stacked tables, ragged rows, type outliers, duplicates, encoding issues, headerless files). Everything runs in your browser via vanilla JavaScript — **nothing is ever uploaded or stored**. Auto-detects delimiter, encoding (UTF-8 / UTF-16 / Windows-1256), and whether each file has a header row (with a per-file manual toggle); aligns columns by name — or by position for headerless files — and exports UTF-8 CSV with BOM for Excel compatibility. When all files are headerless, the merged output contains no header row.

**Live:** <https://mextox.github.io/csv-merger/> · Run tests with `node test.js` · No dependencies, no build step.

## License

[MIT](LICENSE)

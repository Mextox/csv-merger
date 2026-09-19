"use strict";
// يجمع كل وحدات js/core في كائن واحد — تستخدمه الاختبارات القديمة التي كانت تحمّل app.js
const names = ["csv", "merge", "zip", "xlsx"];
module.exports = Object.assign({}, ...names.map((n) => require(`../../js/core/${n}.js`)));

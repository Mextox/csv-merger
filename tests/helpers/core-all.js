"use strict";
// يجمع كل وحدات js/core في كائن واحد — تستخدمه الاختبارات القديمة التي كانت تحمّل app.js
const names = ["text", "csv", "merge", "zip", "xlsx", "ole", "crypto", "xlsx-crypt", "batchtxt", "profiles", "cards", "settings-pack"];
module.exports = Object.assign({}, ...names.map((n) => require(`../../js/core/${n}.js`)));

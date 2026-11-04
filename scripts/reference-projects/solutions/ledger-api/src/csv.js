'use strict';
const { formatCents } = require('./money.js');
const q = (v) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(entries) {
  return ['id,date,description,category,amount', ...entries.map((e) => [e.id, e.date, e.description, e.category, formatCents(e.amount_cents)].map(q).join(','))].join('\n');
}
module.exports = { toCsv };

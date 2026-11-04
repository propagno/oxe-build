'use strict';
const crypto = require('crypto');
const { parseAmount } = require('./money.js');
function validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const x = new Date(d + 'T00:00:00Z');
  return !isNaN(x) && x.toISOString().slice(0, 10) === d;
}
function createEntry({ description, amount, category, date } = {}) {
  const desc = typeof description === 'string' ? description.trim() : '';
  if (!desc) throw new TypeError('description');
  const d = date == null ? new Date().toISOString().slice(0, 10) : date;
  if (!validDate(d)) throw new TypeError('date');
  const cat = typeof category === 'string' && category.trim() ? category.trim().toLowerCase() : 'other';
  return { id: crypto.randomUUID(), description: desc, amount_cents: parseAmount(amount), category: cat, date: d };
}
module.exports = { createEntry };

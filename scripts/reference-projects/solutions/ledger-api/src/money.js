'use strict';
function parseAmount(text) {
  if (typeof text !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(text.trim())) throw new TypeError('invalid amount');
  const t = text.trim();
  const neg = t.startsWith('-');
  const [i, d = ''] = t.replace('-', '').split('.');
  const cents = Number(i) * 100 + Number((d + '00').slice(0, 2));
  return neg ? -cents : cents;
}
function formatCents(c) {
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
}
module.exports = { parseAmount, formatCents };

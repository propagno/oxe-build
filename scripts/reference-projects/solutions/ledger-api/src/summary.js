'use strict';
function summarizeByCategory(entries) {
  const m = new Map();
  for (const e of entries) {
    const c = m.get(e.category) || { category: e.category, total_cents: 0, count: 0 };
    c.total_cents += e.amount_cents;
    c.count += 1;
    m.set(e.category, c);
  }
  return [...m.values()].sort((a, b) => b.total_cents - a.total_cents || a.category.localeCompare(b.category));
}
module.exports = { summarizeByCategory };

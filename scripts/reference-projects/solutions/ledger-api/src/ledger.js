'use strict';
const { createEntry } = require('./entry.js');
function createLedger() {
  const items = [];
  let seq = 0;
  return {
    add(input) { const e = createEntry(input); items.push({ e, seq: seq++ }); return { ...e }; },
    get(id) { const f = items.find((x) => x.e.id === id); return f ? { ...f.e } : null; },
    remove(id) { const i = items.findIndex((x) => x.e.id === id); if (i < 0) return false; items.splice(i, 1); return true; },
    list({ category, from, to } = {}) {
      return items
        .filter(({ e }) => (!category || e.category === String(category).toLowerCase()) && (!from || e.date >= from) && (!to || e.date <= to))
        .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.seq - b.seq)
        .map((x) => ({ ...x.e }));
    },
    balance() { return items.reduce((s, x) => s + x.e.amount_cents, 0); },
  };
}
module.exports = { createLedger };

'use strict';
const { formatCents } = require('../money.js');
function createHandlers(ledger) {
  return {
    createEntry(body) {
      try { return { status: 201, body: ledger.add(body || {}) }; } catch (e) { return { status: 400, body: { error: e.message || 'invalid' } }; }
    },
    listEntries(q = {}) { return { status: 200, body: ledger.list({ category: q.category, from: q.from, to: q.to }) }; },
    getBalance() { const b = ledger.balance(); return { status: 200, body: { balance_cents: b, balance: formatCents(b) } }; },
    deleteEntry(p) { return ledger.remove(p.id) ? { status: 204 } : { status: 404, body: { error: 'not_found' } }; },
  };
}
module.exports = { createHandlers };

'use strict';
const id = 'no-duplicate-heading';
function check(doc) {
  const seen = new Map();
  const out = [];
  for (const h of doc.headings) {
    const key = h.text.trim().toLowerCase();
    if (seen.has(key)) out.push({ rule: id, line: h.line, message: `duplicate heading (first at line ${seen.get(key)})` });
    else seen.set(key, h.line);
  }
  return out;
}
module.exports = { id, check };

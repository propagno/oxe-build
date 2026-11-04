'use strict';
const rules = require('./rules/index.js');
function fixText(text, config) {
  let out = String(text);
  for (const rule of rules) {
    if (typeof rule.fix !== 'function' || !(config && config.rules && config.rules[rule.id])) continue;
    out = rule.fix(out);
  }
  const a = String(text).split('\n');
  const b = out.split('\n');
  let fixed = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) fixed++;
  return { text: out, fixed };
}
module.exports = { fixText };

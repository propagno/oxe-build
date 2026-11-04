'use strict';
const { parseMarkdown } = require('./parse.js');
const rules = require('./rules/index.js');
function lintText(text, config, { file = '<stdin>' } = {}) {
  const doc = parseMarkdown(text);
  const out = [];
  for (const rule of rules) {
    const setting = config && config.rules ? config.rules[rule.id] : undefined;
    if (!setting) continue;
    const options = typeof setting === 'object' ? setting : {};
    for (const i of rule.check(doc, options)) out.push({ file, line: i.line, rule: rule.id, message: i.message });
  }
  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
module.exports = { lintText };

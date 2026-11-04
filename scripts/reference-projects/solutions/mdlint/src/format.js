'use strict';
function formatText(issues) {
  if (!issues.length) return 'no problems';
  return [...issues.map((i) => `${i.file}:${i.line}  ${i.rule}  ${i.message}`), `${issues.length} problem(s)`].join('\n');
}
function formatJson(issues) { return JSON.stringify(issues, null, 2); }
module.exports = { formatText, formatJson };

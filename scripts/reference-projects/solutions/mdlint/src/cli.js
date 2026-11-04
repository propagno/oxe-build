'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config.js');
const { lintText } = require('./runner.js');
const { formatText, formatJson } = require('./format.js');
const { fixText } = require('./fix.js');
function run(argv, { cwd, stdout, stderr }) {
  const files = [];
  let format = 'text';
  let fix = false;
  let configFile;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format') format = argv[++i];
    else if (a === '--fix') fix = true;
    else if (a === '--config') configFile = argv[++i];
    else if (a.startsWith('-')) { stderr.write(`unknown flag ${a}\n`); return 2; }
    else files.push(a);
  }
  if (!files.length) { stderr.write('usage: mdlint [--format text|json] [--fix] [--config file] <files...>\n'); return 2; }
  if (format !== 'text' && format !== 'json') { stderr.write(`invalid format ${format}\n`); return 2; }
  let config;
  try { config = loadConfig(cwd, configFile); } catch (e) { stderr.write(e.message + '\n'); return 2; }
  const issues = [];
  for (const f of files) {
    const full = path.resolve(cwd, f);
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { stderr.write(`cannot read ${f}\n`); return 2; }
    if (fix) { const r = fixText(text, config); if (r.fixed) fs.writeFileSync(full, r.text); text = r.text; }
    issues.push(...lintText(text, config, { file: f }));
  }
  stdout.write((format === 'json' ? formatJson(issues) : formatText(issues)) + '\n');
  return issues.length ? 1 : 0;
}
module.exports = { run };

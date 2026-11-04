'use strict';

/**
 * Reference project 2 (1.21 maturity scorecard): `mdlint`, a Markdown linter CLI in plain Node. Two program phases,
 * ten tasks. The acceptance tests are the planner's (frozen before execution); the oracle is independent.
 */

const H = "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst src = (m) => require('../../src/' + m);\n";
const DOC = "'# Title\\n\\nText  \\n\\n### Skipped level\\n\\n```\\n# not a heading   \\n```\\n\\n## Title\\n'";

const F1 = {
  id: 'F1',
  title: 'Parser e regras',
  scope: 'parser de linhas e títulos ATX com blocos de código, e as quatro regras de lint',
  tasks: [
    {
      id: 'T1', wave: 1, title: 'Parser de Markdown', files: ['src/parse.js'], aceite: 'A1',
      criterion: 'O parser numera as linhas, marca as que estão em bloco de código e extrai os títulos ATX fora deles',
      goal: 'parseMarkdown(text) devolve { lines: [{ number (1-based), text, inCode }], headings: [{ line, level, text }] }. Quebras \\n ou \\r\\n. Cercas ``` e ~~~ abrem e fecham blocos (a linha da cerca também é inCode). Título ATX: 1 a 6 "#" seguidos de espaço; text sem os "#" de fechamento e sem espaços nas pontas. Títulos dentro de código não contam.',
      symbols: [['src/parse.js', 'parseMarkdown']],
      commit: 'feat(parse): line and ATX heading parser aware of code fences',
    },
    {
      id: 'T2', wave: 2, dependsOn: ['T1'], title: 'Regra heading-increment', files: ['src/rules/heading-increment.js'], aceite: 'A2',
      criterion: 'Um título não pode pular mais de um nível em relação ao anterior',
      goal: 'Exporta o objeto { id: "heading-increment", check(doc) } em que doc é o retorno de parseMarkdown; check devolve [{ rule, line, message }] para cada título cujo nível passa do anterior + 1 (o primeiro título não é cobrado). Declare check como função e exporte com module.exports = { id, check }.',
      symbols: [['src/rules/heading-increment.js', 'check']],
      commit: 'feat(rules): heading-increment',
    },
    {
      id: 'T3', wave: 2, dependsOn: ['T1'], title: 'Regra no-trailing-spaces com correção', files: ['src/rules/trailing-space.js'], aceite: 'A3',
      criterion: 'Espaços ou tabs no fim da linha são apontados fora de código e podem ser removidos',
      goal: 'Exporta { id: "no-trailing-spaces", check(doc), fix(text) }. check aponta cada linha fora de código terminada em espaço ou tab. fix(text) devolve o texto sem o espaço final dessas linhas, sem tocar linhas de código, preservando as quebras de linha. Declare check e fix como funções e exporte com module.exports = { id, check, fix }.',
      symbols: [['src/rules/trailing-space.js', 'check'], ['src/rules/trailing-space.js', 'fix']],
      commit: 'feat(rules): no-trailing-spaces with autofix',
    },
    {
      id: 'T4', wave: 2, dependsOn: ['T1'], title: 'Regra line-length', files: ['src/rules/line-length.js'], aceite: 'A4',
      criterion: 'Linhas longas demais são apontadas, exceto código e linhas que são só uma URL',
      goal: 'Exporta { id: "line-length", check(doc, options = {}) } com options.max (padrão 100). Aponta linhas fora de código com mais de max caracteres; ignora linhas cujo conteúdo (sem espaços nas pontas) é uma única URL http(s). A message cita o comprimento e o máximo. Declare check como função e exporte com module.exports = { id, check }.',
      symbols: [['src/rules/line-length.js', 'check']],
      commit: 'feat(rules): line-length',
    },
    {
      id: 'T5', wave: 2, dependsOn: ['T1'], title: 'Regra no-duplicate-heading', files: ['src/rules/no-duplicate-heading.js'], aceite: 'A5',
      criterion: 'Títulos repetidos (sem diferenciar maiúsculas) são apontados citando a primeira ocorrência',
      goal: 'Exporta { id: "no-duplicate-heading", check(doc) } que aponta cada título cujo texto (trim, minúsculas) já apareceu antes, em qualquer nível; a message contém o número da linha da primeira ocorrência. Declare check como função e exporte com module.exports = { id, check }.',
      symbols: [['src/rules/no-duplicate-heading.js', 'check']],
      commit: 'feat(rules): no-duplicate-heading',
    },
  ],
  acceptance: {
    A1: `${H}const { parseMarkdown } = src('parse.js');
test('A1 parseMarkdown', () => {
  const doc = parseMarkdown(${DOC});
  assert.equal(doc.lines.length, 12);
  assert.deepEqual(doc.lines[2], { number: 3, text: 'Text  ', inCode: false });
  assert.deepEqual(doc.lines.filter((l) => l.inCode).map((l) => l.number), [7, 8, 9]);
  assert.deepEqual(doc.headings, [
    { line: 1, level: 1, text: 'Title' },
    { line: 5, level: 3, text: 'Skipped level' },
    { line: 11, level: 2, text: 'Title' },
  ]);
  assert.deepEqual(parseMarkdown('## Closed ##\\r\\n#NoSpace').headings, [{ line: 1, level: 2, text: 'Closed' }]);
});
`,
    A2: `${H}const { parseMarkdown } = src('parse.js');
const rule = src('rules/heading-increment.js');
test('A2 heading-increment', () => {
  assert.equal(rule.id, 'heading-increment');
  const issues = rule.check(parseMarkdown(${DOC}));
  assert.deepEqual(issues.map((i) => [i.rule, i.line]), [['heading-increment', 5]]);
  assert.equal(typeof issues[0].message, 'string');
  assert.deepEqual(rule.check(parseMarkdown('## a\\n### b\\n# c\\n## d')), []);
});
`,
    A3: `${H}const { parseMarkdown } = src('parse.js');
const rule = src('rules/trailing-space.js');
test('A3 no-trailing-spaces', () => {
  assert.equal(rule.id, 'no-trailing-spaces');
  assert.deepEqual(rule.check(parseMarkdown(${DOC})).map((i) => i.line), [3]);
  assert.deepEqual(rule.check(parseMarkdown('a\\t\\nb')).map((i) => i.line), [1]);
  assert.equal(rule.fix(${DOC}), ${DOC}.replace('Text  ', 'Text'));
  assert.equal(rule.fix('x \\r\\ny'), 'x\\r\\ny');
});
`,
    A4: `${H}const { parseMarkdown } = src('parse.js');
const rule = src('rules/line-length.js');
test('A4 line-length', () => {
  assert.equal(rule.id, 'line-length');
  const long = 'x'.repeat(101);
  const text = ['ok', long, '  https://example.com/' + 'a'.repeat(120) + '  ', '\`\`\`', long, '\`\`\`'].join('\\n');
  const issues = rule.check(parseMarkdown(text));
  assert.deepEqual(issues.map((i) => i.line), [2]);
  assert.match(issues[0].message, /101/);
  assert.match(issues[0].message, /100/);
  assert.deepEqual(rule.check(parseMarkdown('abcdef'), { max: 5 }).map((i) => i.line), [1]);
});
`,
    A5: `${H}const { parseMarkdown } = src('parse.js');
const rule = src('rules/no-duplicate-heading.js');
test('A5 no-duplicate-heading', () => {
  assert.equal(rule.id, 'no-duplicate-heading');
  const issues = rule.check(parseMarkdown('# Intro\\n## Setup\\n### intro \\n## Setup'));
  assert.deepEqual(issues.map((i) => i.line), [3, 4]);
  assert.match(issues[0].message, /\\b1\\b/);
  assert.match(issues[1].message, /\\b2\\b/);
});
`,
  },
  oracle: `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('oracle F1', () => {
  const { parseMarkdown } = require('./src/parse.js');
  const doc = parseMarkdown('~~~\\n# x\\n~~~\\n# A #\\n#### B\\n# a');
  assert.deepEqual(doc.headings.map((h) => [h.line, h.level, h.text]), [[4, 1, 'A'], [5, 4, 'B'], [6, 1, 'a']]);
  assert.deepEqual(require('./src/rules/heading-increment.js').check(doc).map((i) => i.line), [5]);
  assert.deepEqual(require('./src/rules/no-duplicate-heading.js').check(doc).map((i) => i.line), [6]);
  assert.equal(require('./src/rules/trailing-space.js').fix('a  \\n~~~\\nb  \\n~~~\\n'), 'a\\n~~~\\nb  \\n~~~\\n');
  assert.deepEqual(require('./src/rules/line-length.js').check(parseMarkdown('1234567'), { max: 6 }).map((i) => i.line), [1]);
});
`,
};

const F2 = {
  id: 'F2',
  title: 'Configuração, execução e CLI',
  scope: 'config do projeto, registro de regras e runner, formatação, autocorreção e a CLI com códigos de saída',
  tasks: [
    {
      id: 'T6', wave: 1, title: 'Configuração do projeto', files: ['src/config.js'], aceite: 'A6',
      criterion: 'A configuração do projeto se combina com os padrões e regras podem ser desligadas',
      goal: 'loadConfig(dir, file = ".mdlintrc.json") lê o JSON (se existir) e combina com DEFAULTS = { rules: { "heading-increment": true, "no-trailing-spaces": true, "line-length": { max: 100 }, "no-duplicate-heading": true } }: a chave do usuário substitui a do padrão; false desliga a regra; objeto vira as opções. Exporta também DEFAULTS. JSON inválido lança Error cuja mensagem contém o nome do arquivo.',
      symbols: [['src/config.js', 'loadConfig']],
      commit: 'feat(config): project config merged with defaults',
    },
    {
      id: 'T7', wave: 1, title: 'Registro de regras e runner', files: ['src/rules/index.js', 'src/runner.js'], aceite: 'A7',
      criterion: 'O runner aplica as regras habilitadas e devolve os problemas ordenados com o arquivo',
      goal: 'src/rules/index.js exporta o array das quatro regras. lintText(text, config, { file = "<stdin>" } = {}) roda só as regras habilitadas em config.rules (objeto = opções da regra) e devolve [{ file, line, rule, message }] ordenado por line e depois por rule.',
      symbols: [['src/runner.js', 'lintText']],
      commit: 'feat(runner): run enabled rules and sort issues',
    },
    {
      id: 'T8', wave: 1, title: 'Formatação dos resultados', files: ['src/format.js'], aceite: 'A8',
      criterion: 'Os problemas saem em texto legível com resumo ou em JSON',
      goal: 'formatText(issues) devolve uma linha "file:line  rule  message" por problema e, por fim, "N problem(s)" (ou só "no problems" quando vazio), unidas por "\\n". formatJson(issues) devolve JSON.stringify(issues, null, 2).',
      symbols: [['src/format.js', 'formatText'], ['src/format.js', 'formatJson']],
      commit: 'feat(format): text and JSON output',
    },
    {
      id: 'T9', wave: 2, dependsOn: ['T6', 'T7'], title: 'Autocorreção', files: ['src/fix.js'], aceite: 'A9',
      criterion: 'As regras corrigíveis habilitadas são aplicadas e o número de linhas alteradas é informado',
      goal: 'fixText(text, config) aplica, em ordem, o fix(text) de cada regra habilitada que tenha fix e devolve { text, fixed } onde fixed é o número de linhas que mudaram em relação ao original.',
      symbols: [['src/fix.js', 'fixText']],
      commit: 'feat(fix): apply fixable rules',
    },
    {
      id: 'T10', wave: 3, dependsOn: ['T6', 'T7', 'T8', 'T9'], title: 'CLI com códigos de saída', files: ['src/cli.js', 'bin/mdlint.js'], aceite: 'A10',
      criterion: 'A CLI lê arquivos, formata, corrige e devolve 0 sem problemas, 1 com problemas e 2 em erro de uso',
      goal: 'run(argv, { cwd, stdout, stderr }) (argv sem "node script") aceita arquivos .md e as flags --format text|json, --fix e --config <arquivo>. Lê a config relativa a cwd, lint de cada arquivo (com --fix grava o texto corrigido antes do lint), escreve o resultado em stdout.write e devolve 0 sem problemas, 1 com problemas e 2 sem arquivos, com flag desconhecida, --format inválido ou arquivo ilegível (mensagem em stderr.write). bin/mdlint.js chama process.exit(run(process.argv.slice(2), { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr })).',
      symbols: [['src/cli.js', 'run']],
      commit: 'feat(cli): mdlint command with exit codes',
    },
  ],
  acceptance: {
    A6: `${H}const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, DEFAULTS } = src('config.js');
test('A6 loadConfig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlint-cfg-'));
  assert.deepEqual(loadConfig(dir), DEFAULTS);
  fs.writeFileSync(path.join(dir, '.mdlintrc.json'), JSON.stringify({ rules: { 'line-length': { max: 80 }, 'no-duplicate-heading': false } }));
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.rules['line-length'], { max: 80 });
  assert.equal(cfg.rules['no-duplicate-heading'], false);
  assert.equal(cfg.rules['heading-increment'], true);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{oops');
  assert.throws(() => loadConfig(dir, 'bad.json'), /bad\\.json/);
  fs.rmSync(dir, { recursive: true, force: true });
});
`,
    A7: `${H}const { lintText } = src('runner.js');
const rules = src('rules/index.js');
test('A7 lintText', () => {
  assert.equal(rules.length, 4);
  const text = '# A\\n### B  \\n# A';
  const all = lintText(text, { rules: { 'heading-increment': true, 'no-trailing-spaces': true, 'line-length': { max: 100 }, 'no-duplicate-heading': true } }, { file: 'x.md' });
  assert.deepEqual(all.map((i) => [i.file, i.line, i.rule]), [['x.md', 2, 'heading-increment'], ['x.md', 2, 'no-trailing-spaces'], ['x.md', 3, 'no-duplicate-heading']]);
  const some = lintText(text, { rules: { 'no-trailing-spaces': true, 'line-length': { max: 3 } } });
  assert.deepEqual(some.map((i) => [i.file, i.line, i.rule]), [['<stdin>', 2, 'line-length'], ['<stdin>', 2, 'no-trailing-spaces']]);
});
`,
    A8: `${H}const { formatText, formatJson } = src('format.js');
test('A8 format', () => {
  const issues = [{ file: 'a.md', line: 2, rule: 'line-length', message: 'too long' }];
  assert.equal(formatText(issues), 'a.md:2  line-length  too long\\n1 problem(s)');
  assert.equal(formatText([]), 'no problems');
  assert.deepEqual(JSON.parse(formatJson(issues)), issues);
});
`,
    A9: `${H}const { fixText } = src('fix.js');
test('A9 fixText', () => {
  const on = { rules: { 'no-trailing-spaces': true } };
  assert.deepEqual(fixText('a  \\nb\\nc\\t\\n', on), { text: 'a\\nb\\nc\\n', fixed: 2 });
  assert.deepEqual(fixText('a  \\n', { rules: { 'no-trailing-spaces': false } }), { text: 'a  \\n', fixed: 0 });
});
`,
    A10: `${H}const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = src('cli.js');
function io() { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(String(s)) }, stderr: { write: (s) => err.push(String(s)) } }; }
test('A10 cli', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlint-cli-'));
  fs.writeFileSync(path.join(cwd, 'ok.md'), '# Ok\\n\\nText\\n');
  fs.writeFileSync(path.join(cwd, 'bad.md'), '# Bad  \\n### Jump\\n');
  let s = io();
  assert.equal(run(['ok.md'], { cwd, ...s }), 0);
  s = io();
  assert.equal(run(['bad.md', '--format', 'json'], { cwd, ...s }), 1);
  assert.equal(JSON.parse(s.out.join('')).length, 2);
  s = io();
  assert.equal(run([], { cwd, ...s }), 2);
  assert.ok(s.err.join('').length > 0);
  assert.equal(run(['--nope', 'ok.md'], { cwd, ...io() }), 2);
  assert.equal(run(['missing.md'], { cwd, ...io() }), 2);
  assert.equal(run(['ok.md', '--format', 'xml'], { cwd, ...io() }), 2);
  s = io();
  assert.equal(run(['bad.md', '--fix'], { cwd, ...s }), 1);
  assert.equal(fs.readFileSync(path.join(cwd, 'bad.md'), 'utf8'), '# Bad\\n### Jump\\n');
  fs.writeFileSync(path.join(cwd, 'cfg.json'), JSON.stringify({ rules: { 'heading-increment': false } }));
  assert.equal(run(['bad.md', '--config', 'cfg.json'], { cwd, ...io() }), 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});
`,
  },
  oracle: `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('oracle F2', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlint-oracle-'));
  fs.writeFileSync(path.join(cwd, 'a.md'), '# A\\n\\n' + 'w'.repeat(90) + '\\n');
  fs.writeFileSync(path.join(cwd, '.mdlintrc.json'), JSON.stringify({ rules: { 'line-length': { max: 80 } } }));
  const bin = path.resolve('bin/mdlint.js');
  const r = spawnSync(process.execPath, [bin, 'a.md'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /a\\.md:3\\s+line-length/);
  assert.match(r.stdout, /1 problem\\(s\\)/);
  fs.writeFileSync(path.join(cwd, '.mdlintrc.json'), '{}');
  assert.equal(spawnSync(process.execPath, [bin, 'a.md'], { cwd, encoding: 'utf8' }).status, 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});
`,
};

module.exports = {
  name: 'mdlint',
  description: 'Linter de Markdown em CLI, Node puro, sem dependências.',
  objective: 'Apontar problemas comuns em arquivos Markdown (níveis de título, espaços no fim, linhas longas, títulos repetidos), com configuração por projeto, saída em texto ou JSON, autocorreção e códigos de saída para CI.',
  phases: [F1, F2],
};

'use strict';

/**
 * OXB-092 (minimal): production/homologation signals become change requests in the right phase — closing the ADLC
 * loop (signal → new intent) without a person retyping each finding.
 *
 * Sources (no live integrations):
 *   - an HML report file (markdown or JSON). Each finding `HML-F<n>-<m>` becomes a CR (defect | spec_gap) in phase F<n>.
 *       markdown: a line or heading with the id, e.g. `- **HML-F2-3** [defect] (A12) Settings: botão sem foco … \`src/x.tsx\``
 *                 (the following indented/plain lines up to the next finding are its body)
 *       JSON:     { "phase"?: "F2", "findings": [{ "id", "summary", "class"?, "criteria"?, "files"?, "phase"?, "evidence"? }] }
 *   - a GitHub issue URL (`gh issue view`), or `github:<owner/repo>` for every OPEN issue labelled `bug`.
 *
 * The criterion comes from the finding (A-ids it names); else from the traceability A* → T → files (the files it names,
 * the tasks of the current plan that own them, their acceptance); else from the standing criteria (OXB-091, e.g. A70:
 * zero UI defects). A finding with none goes to triage (reported, no CR). Re-importing the same finding never duplicates
 * its CR (`signal_id`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FINDING_ID_RE = /\b(HML-F(\d+)-(\d+))\b/;
const CLASS_RE = /\[(defect|spec_gap|spec-gap|constraint)\]/i;
const CRIT_RE = /\b(?:A\d+(?:\.\d+)?|G\d+)\b/g;
const FILE_RE = /`([^`\s]+\.[A-Za-z0-9]{1,6})`/g;

function normClass(c) {
  const v = String(c || '').toLowerCase().replace('-', '_');
  return v === 'spec_gap' || v === 'constraint' ? v : 'defect';
}

function fromText(id, phase, text, extra = {}) {
  const clean = String(text || '');
  const cls = CLASS_RE.exec(clean);
  const criteria = [...new Set(clean.replace(/`[^`]*`/g, ' ').match(CRIT_RE) || [])];
  const files = [...new Set([...clean.matchAll(FILE_RE)].map((m) => m[1]))];
  const summary = clean.split('\n')[0]
    .replace(/^[#\s>*-]+/, '').replace(/\*\*/g, '').replace(FINDING_ID_RE, '').replace(CLASS_RE, '')
    .replace(/^[\s:—–-]+/, '')
    // a leading "(A48)" / "(A12, A19.3)" names the criterion, it is not part of the summary
    .replace(/^\((?:\s*(?:A\d+(?:\.\d+)?|G\d+)\s*,?)+\)\s*/, '')
    .replace(/^[\s:—–-]+/, '').trim();
  return { id, phase, class: normClass(cls && cls[1]), criteria, files, summary: summary || clean.slice(0, 160), body: clean.trim(), ...extra };
}

/** Findings of an HML report (markdown or JSON). */
function parseReport(text, options = {}) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const doc = JSON.parse(trimmed);
    const list = Array.isArray(doc) ? doc : Array.isArray(doc.findings) ? doc.findings : [];
    return list.map((f, i) => {
      const id = String(f.id || `${options.prefix || 'SIG'}-${i + 1}`);
      const m = FINDING_ID_RE.exec(id);
      return {
        id,
        phase: f.phase || (m ? `F${Number(m[2])}` : doc.phase || null),
        class: normClass(f.class),
        criteria: (Array.isArray(f.criteria) ? f.criteria : []).map((c) => String(c).trim().toUpperCase()).filter(Boolean),
        files: (Array.isArray(f.files) ? f.files : []).map(String),
        summary: String(f.summary || f.title || '').trim(),
        body: String(f.evidence || f.body || '').trim(),
      };
    });
  }
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = FINDING_ID_RE.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { id: m[1], phase: `F${Number(m[2])}`, lines: [line] };
    } else if (cur) {
      if (/^#{1,3}\s/.test(line)) { out.push(cur); cur = null; } else cur.lines.push(line);
    }
  }
  if (cur) out.push(cur);
  return out.map((c) => fromText(c.id, c.phase, c.lines.join('\n')));
}

/** Findings of GitHub issues: one URL, or every open `bug` issue of `github:<owner/repo>`. */
function githubFindings(ref, options = {}) {
  const spawn = options.ghSpawn || spawnSync;
  const asFinding = (issue, repo) => {
    const text = `${issue.title || ''}\n${issue.body || ''}`;
    const m = FINDING_ID_RE.exec(text);
    const phaseMatch = /\b(?:fase|phase)\s*F?(\d+)\b|\bF(\d+)\b/i.exec(text);
    const f = fromText(m ? m[1] : `GH-${repo}#${issue.number}`, m ? `F${Number(m[2])}` : phaseMatch ? `F${Number(phaseMatch[1] || phaseMatch[2])}` : null, text, {});
    f.summary = String(issue.title || f.summary).replace(FINDING_ID_RE, '').replace(/^[\s:—–-]+/, '').trim();
    f.source_url = issue.url || null;
    f.labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    return f;
  };
  const single = /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/.exec(ref);
  if (single) {
    const res = spawn('gh', ['issue', 'view', single[2], '-R', single[1], '--json', 'number,title,body,labels,url,state'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (!res || res.status !== 0) throw new Error(`gh issue view falhou: ${(res && (res.stderr || res.error)) || 'sem saída'}`.trim());
    const issue = JSON.parse(res.stdout);
    const f = asFinding(issue, single[1]);
    if (!options.anyLabel && !f.labels.some((l) => /^bug$/i.test(l))) throw new Error(`issue #${issue.number} não tem o label bug (use --any-label para importar mesmo assim)`);
    return [f];
  }
  const repoList = /^github:([\w.-]+\/[\w.-]+)$/.exec(ref);
  if (repoList) {
    const res = spawn('gh', ['issue', 'list', '-R', repoList[1], '--label', 'bug', '--state', 'open', '--limit', '200', '--json', 'number,title,body,labels,url'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (!res || res.status !== 0) throw new Error(`gh issue list falhou: ${(res && (res.stderr || res.error)) || 'sem saída'}`.trim());
    return JSON.parse(res.stdout).map((i) => asFinding(i, repoList[1]));
  }
  return null;
}

/** Criteria of a finding through A* → T → files (tasks of the plan that own the files it names). */
function criteriaFromFiles(plan, files) {
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  const wanted = new Set((files || []).map(norm));
  const out = new Set();
  const tasks = [];
  for (const task of (plan && plan.tasks) || []) {
    const owns = (task.files || []).map(norm).some((f) => wanted.has(f) || [...wanted].some((w) => w.endsWith(`/${f}`) || f.endsWith(`/${w}`)));
    if (!owns) continue;
    tasks.push(task.id);
    for (const a of task.aceite || []) out.add(a);
  }
  return { criteria: [...out], tasks };
}

/**
 * OXB-122: imported text (issues, reports, PR comments) is DATA. Patterns of instructions aimed at an agent are flagged
 * (never silently dropped: the import goes on, marked, and the snippet is shown).
 */
const INJECTION_PATTERNS = [
  { id: 'override', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|all|earlier|the)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|context)\b/i },
  { id: 'override_pt', re: /\b(ignore|desconsidere|esqueça|esqueca)\b[^.\n]{0,40}\b(instruç(ões|ão)|instrucoes|regras?|orientaç(ões|ão)|o que foi dito)\b/i },
  // (JS \b is ASCII-only: no \b next to accented letters or '#')
  { id: 'role', re: /(?:\b(?:you are now|act as|pretend (?:to be|you are)|from now on,? you)\b|(?:^|\s)(?:você|voce) agora (?:é|e)(?=\s|$|[,:.])|a partir de agora,? (?:você|voce))/i },
  { id: 'system_prompt', re: /(?:\bsystem prompt\b|\bdeveloper message\b|<\/?system>|\[\/?INST\]|(?:^|\n)\s*###\s*(?:system|assistant)\b|<\|im_start\|>)/i },
  { id: 'exec', re: /\b(run|execute|exec|rode|execute este|executar)\b[^.\n]{0,40}\b(command|comando|script|shell|bash|powershell|cmd)\b/i },
  { id: 'fetch_exec', re: /\b(curl|wget|iwr|invoke-webrequest|invoke-expression|iex)\b[^\n]{0,80}(\|\s*(sh|bash|iex)|-o\s|>\s)|powershell(\.exe)?\s+-(e|enc|encodedcommand)\b/i },
  { id: 'install', re: /\b(npm|pnpm|yarn|pip|pip3|gem|cargo|go)\s+(install|i|add|get)\s+[^\s]+/i },
  { id: 'exfiltrate', re: /\b(send|upload|post|exfiltrate|envie|mande|enviar)\b[^.\n]{0,60}\b(token|secret|password|senha|api[_ -]?key|credential|credencia|\.env|ssh key|chave)\b/i },
  { id: 'config_change', re: /\b(change|modify|edit|disable|turn off|remove|altere|desative|desligue|remova)\b[^.\n]{0,40}\b(config(uration)?|settings|policy|policies|rules|hooks?|tests?|checks?|lint|ci|permissions?|configuração|regras|testes)\b[^.\n]{0,40}\b(to|para|so that|de modo)\b/i },
  { id: 'bypass', re: /\b(bypass|skip|circumvent|contorne|pule)\b[^.\n]{0,40}\b(verification|verify|tests?|checks?|review|approval|gates?|safety|security|verificação|aprovação|testes)\b/i },
  { id: 'hidden', re: /<!--[\s\S]{0,400}?(instruc|instruction|ignore|agent|assistant|claude|gpt)[\s\S]{0,400}?-->|\u200b|\u202e/i },
  { id: 'encoded_blob', re: /[A-Za-z0-9+/]{120,}={0,2}/ },
];

/** @returns {{ id: string, snippet: string }[]} */
function scanInjection(text) {
  const t = String(text || '');
  const flags = [];
  for (const p of INJECTION_PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const at = Math.max(0, m.index - 30);
    flags.push({ id: p.id, snippet: t.slice(at, m.index + Math.min(m[0].length, 120) + 30).replace(/\s+/g, ' ').trim() });
  }
  return flags;
}

module.exports = { parseReport, githubFindings, criteriaFromFiles, FINDING_ID_RE, scanInjection, INJECTION_PATTERNS };

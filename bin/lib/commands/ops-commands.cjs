'use strict';

/**
 * 1.22.1 (OXB-221-08): Extracted operational CLI commands (`acceptance-audit`, `release-readiness`,
 * `release-finalize`, `preflight`, `sync`, `gc-worktrees`, `worktree`, `session`, `quick`)
 * registered via `oxe-command-registry.cjs`.
 */

const fs = require('fs');
const path = require('path');
const { createCommandRegistry } = require('../oxe-command-registry.cjs');

function createOpsCommandRegistry(deps = {}) {
  const colors = deps.colors || {};
  const red = colors.red || '';
  const yellow = colors.yellow || '';
  const green = colors.green || '';
  const dim = colors.dim || '';
  const reset = colors.reset || '';
  const { oxeOperational, oxeHealth, sessionDirId } = deps;

  return createCommandRegistry([
    {
      name: 'acceptance-audit',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc acceptance-audit [--max-age-days <N>] [--dir <pasta>] [--json]
  Audita drift em specs de aceitação congeladas (tests/acceptance/** e e2e/acceptance/**) contra requisitos
  cortados/fora de escopo em SPEC/PRD/ROADMAP, imports relativos quebrados e referências em PLAN.json.\n`);
          return;
        }
        const o = { dir: process.cwd(), maxAgeDays: 0, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--max-age-days' && argv[i + 1]) o.maxAgeDays = Number(argv[++i]) || 0;
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        const out = require('../oxe-acceptance-audit.cjs').auditAcceptanceSpecs(o.dir, o);
        if (o.json) {
          console.log(JSON.stringify({ oxeAcceptanceAuditSchema: 1, ...out }, null, 2));
        } else {
          console.log(`  ${out.ok ? `${green}✓${reset}` : `${red}✗${reset}`} acceptance-audit: ${out.specs_scanned} spec(s) congelada(s) · ${out.errors} erro(s) · ${out.warnings} aviso(s)`);
          for (const f of out.findings) {
            const icon = f.severity === 'error' ? `${red}✗${reset}` : `${yellow}!${reset}`;
            console.log(`    ${icon} ${f.file} [${f.kind}]: ${f.reason}`);
          }
        }
        if (!out.ok) process.exitCode = 1;
      },
    },
    {
      name: 'release-readiness',
      async handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc release-readiness --version <X.Y.Z> [--require-assets] [--no-assets] [--dir <pasta>] [--json]
  Gate unificado pré-release: (1) cards sem fixVersion ou fora de Homologado, (2) gates hml/perf/smoke/acceptance,
  (3) completude de assets multi-plataforma (Desktop + Android APK + checksums).\n`);
          return;
        }
        const o = { dir: process.cwd(), version: null, requireAssets: false, checkAssets: true, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--require-assets') o.requireAssets = true;
          else if (a === '--no-assets') o.checkAssets = false;
          else if (a === '--version' && argv[i + 1]) o.version = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (!a.startsWith('-') && !o.version) o.version = a;
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = await require('../oxe-release-ops.cjs').checkReleaseReadiness(o.dir, o);
          if (o.json) {
            console.log(JSON.stringify({ oxeReleaseReadinessSchema: 1, ...out }, null, 2));
          } else {
            console.log(`  ${out.ok ? `${green}✓${reset}` : `${red}✗${reset}`} release-readiness ${out.tag}: ${out.blockers.length} bloqueio(s) · ${out.warnings.length} aviso(s)`);
            for (const b of out.blockers) console.log(`    ${red}✗${reset} ${b}`);
            for (const w of out.warnings) console.log(`    ${yellow}!${reset} ${w}`);
          }
          if (!out.ok) process.exitCode = 1;
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'release-finalize',
      async handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc release-finalize --version <X.Y.Z> [--apply|--dry-run] [--dir <pasta>] [--json]
  Finalização idempotente pós-publicação multi-workflow: valida Desktop + Android APK + checksums no GitHub Releases,
  fecha a versão no Jira e transita todos os cards Homologado da versão para Lançado. Padrão: --dry-run.\n`);
          return;
        }
        const o = { dir: process.cwd(), version: null, apply: false, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--apply') o.apply = true;
          else if (a === '--dry-run') o.apply = false;
          else if (a === '--version' && argv[i + 1]) o.version = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (!a.startsWith('-') && !o.version) o.version = a;
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = await require('../oxe-release-ops.cjs').finalizeRelease(o.dir, o);
          if (o.json) {
            console.log(JSON.stringify({ oxeReleaseFinalizeSchema: 1, ...out }, null, 2));
          } else if (!out.ok) {
            console.error(`  ${red}✗${reset} release-finalize ${out.tag} bloqueado:`);
            for (const e of out.errors) console.error(`    - ${e}`);
          } else if (out.dry_run) {
            console.log(`  ${yellow}(simulação)${reset} release-finalize ${out.tag}: ${out.planned_transitions.length} card(s) para transitar · ${out.already_released.length} já em Lançado`);
            console.log(`  ${dim}rode com --apply para transitar os cards e marcar a versão como lançada no Jira${reset}`);
          } else {
            console.log(`  ${green}✓${reset} release-finalize ${out.tag}: ${out.transitioned.length} card(s) transitado(s) · versão lançada=${out.version_released}`);
          }
          if (!out.ok) process.exitCode = 1;
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'preflight',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc preflight [--e2e-impact] [--e2e-impact-only] [--strict-e2e] [--strict-css-targets] [--no-triggers] [--no-css-targets] [--base <ref>] [--dir <pasta>] [--json]
  Executa guardas baratos (<5s) de preflight.checks, gatilhos de regressão UI/Perf (preflight.triggers),
  detector estático de impacto em seletores E2E e e2e/acceptance (--e2e-impact) e alerta CSS em src/design/targets/*.json.\n`);
          return;
        }
        const o = { dir: process.cwd(), json: false, base: null, e2eImpact: false, e2eImpactOnly: false, strictE2e: false, strictCssTargets: false, noTriggers: false, cssTargets: true };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--e2e-impact') o.e2eImpact = true;
          else if (a === '--e2e-impact-only') { o.e2eImpact = true; o.e2eImpactOnly = true; }
          else if (a === '--strict-e2e') { o.e2eImpact = true; o.strictE2e = true; }
          else if (a === '--strict-css-targets') o.strictCssTargets = true;
          else if (a === '--no-triggers') o.noTriggers = true;
          else if (a === '--no-css-targets') o.cssTargets = false;
          else if (a === '--base' && argv[i + 1]) o.base = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = require('../oxe-preflight.cjs').runPreflight(o.dir, o);
          if (o.json) {
            console.log(JSON.stringify({ oxePreflightSchema: 1, ...out }, null, 2));
          } else {
            console.log(`  ${out.ok ? `${green}✓${reset}` : `${red}✗${reset}`} preflight (${out.duration_ms} ms · ${out.changed_files} arquivo(s) vs ${out.base})`);
            for (const r of [...out.checks, ...out.triggers]) {
              console.log(`    ${r.ok ? `${green}✓${reset}` : `${red}✗${reset}`} [${r.kind}] ${r.name} (${r.duration_ms} ms)`);
              if (!r.ok && r.tail) console.log(r.tail.split('\n').map((l) => `        ${l}`).join('\n'));
            }
            if (out.e2e_impact) {
              const ei = out.e2e_impact;
              if (!ei.affected_specs.length) console.log(`    ${green}✓${reset} e2e-impact: 0 specs afetadas (${ei.specs_scanned} escaneadas)`);
              else {
                console.log(`    ${yellow}!${reset} e2e-impact: ${ei.affected_specs.length} spec(s) afetada(s) (${ei.frozen_affected.length} congelada(s)):`);
                for (const s of ei.affected_specs) console.log(`      - ${s.file}${s.frozen ? ' [CONGELADA]' : ''}: ${s.matched_tokens.map((t) => `${t.kind}:${t.token}`).join(', ')}`);
              }
            }
            if (out.css_targets && out.css_targets.alerts.length) {
              console.log(`    ${yellow}!${reset} design targets (${out.css_targets.alerts.length} alerta(s) de geometria CSS):`);
              for (const a of out.css_targets.alerts) console.log(`      - ${a.target_id} (${a.target_file}) ← ${a.css_file}: ${a.selectors.join(', ')}`);
            }
          }
          if (!out.ok) process.exitCode = 1;
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'sync',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc sync [--base <ref>] [--apply|--dry-run] [--verify "<comando>"] [--dir <pasta>] [--json]
  Detecta conflitos puramente sequenciais (migrações SQLite numeradas e ratchets declarados) contra a base
  e propõe/aplica auto-bump determinístico com revalidação opcional (--verify). Padrão: --dry-run.\n`);
          return;
        }
        const o = { dir: process.cwd(), base: null, apply: false, verify: null, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--apply') o.apply = true;
          else if (a === '--dry-run') o.apply = false;
          else if (a === '--base' && argv[i + 1]) o.base = String(argv[++i]);
          else if (a === '--verify' && argv[i + 1] != null) o.verify = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = require('../oxe-sync.cjs').syncSequentialResources(o.dir, o);
          if (o.json) {
            console.log(JSON.stringify({ oxeSyncSchema: 1, ...out }, null, 2));
          } else {
            const total = out.migration_bumps.length + out.ratchet_updates.length;
            if (!total) console.log(`  ${green}✓${reset} nenhum conflito sequencial (migrações/ratchets) contra ${out.base}`);
            else {
              console.log(`  ${out.dry_run ? `${yellow}(simulação)${reset}` : `${green}✓${reset}`} ${out.migration_bumps.length} migração(ões) · ${out.ratchet_updates.length} ratchet(s)`);
              for (const b of out.migration_bumps) console.log(`    - migração: ${b.from} → ${b.to} (colidiu com ${b.collided_with})`);
              for (const r of out.ratchet_updates) console.log(`    - ratchet: ${r.file}:${r.line} ${r.from} → ${r.to}`);
              if (out.dry_run) console.log(`  ${dim}rode com --apply para aplicar os bumps determinísticos${reset}`);
            }
            if (out.verify) console.log(`  ${out.verify.ok ? `${green}✓${reset}` : `${red}✗${reset}`} verify: ${out.verify.command}`);
          }
          if (!out.ok) process.exitCode = 1;
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'gc-worktrees',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc gc-worktrees [--merged] [--base <ref>] [--apply|--dry-run] [--delete-branches] [--include-nested] [--ignore-agent-settings] [--dir <pasta>] [--json]
  Remove com segurança worktrees secundárias limpas já mergeadas em origin/main (ou --base), protege destinos de junctions ativas e executa git worktree prune.
  Padrão: --dry-run (somente leitura); passe --apply para remover. Use --include-nested --ignore-agent-settings para limpar worktrees aninhados de agentes (.claude/worktrees).\n`);
          return;
        }
        const o = {
          dir: process.cwd(),
          json: false,
          mergedOnly: true,
          apply: false,
          deleteBranches: false,
          includeNested: false,
          ignoreAgentSettings: false,
          base: null,
        };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--merged') o.mergedOnly = true;
          else if (a === '--all') o.mergedOnly = false;
          else if (a === '--apply') o.apply = true;
          else if (a === '--dry-run') o.apply = false;
          else if (a === '--delete-branches') o.deleteBranches = true;
          else if (a === '--include-nested') o.includeNested = true;
          else if (a === '--ignore-agent-settings') o.ignoreAgentSettings = true;
          else if (a === '--base' && argv[i + 1]) o.base = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = require('../oxe-worktree-gc.cjs').gcWorktrees(o.dir, o);
          if (o.json) { console.log(JSON.stringify({ oxeGcWorktreesSchema: 1, ...out }, null, 2)); return; }
          if (!out.candidates.length) {
            console.log(`  ${green}✓${reset} nenhuma worktree elegível para limpeza (base: ${out.base || '—'})`);
          } else if (out.dry_run) {
            console.log(`  ${yellow}(simulação)${reset} ${out.candidates.length} worktree(s) limpa(s) mergeada(s) em ${out.base}:`);
            for (const c of out.candidates) {
              const tags = [
                c.prunable ? 'prunable' : null,
                c.nested_agent ? 'nested' : null,
                c.has_real_node_modules ? 'node_modules real' : null,
              ].filter(Boolean);
              console.log(`    - ${c.path} [${c.branch || 'detached'}]${tags.length ? ` (${tags.join(', ')})` : ''}`);
            }
            console.log(`  ${dim}rode com --apply para remover e executar git worktree prune${reset}`);
          } else {
            console.log(`  ${green}✓${reset} ${out.removed.length} worktree(s) removida(s) · prune=${out.pruned}`);
            for (const c of out.removed) console.log(`    - ${c.path} [${c.branch || 'detached'}]`);
          }
          if (out.skipped.length) {
            console.log(`  ${dim}mantidas (${out.skipped.length}): ${out.skipped.map((s) => `${path.basename(s.path)} (${s.reason})`).join(', ')}${reset}`);
          }
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'worktree',
      handler(argv) {
        const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
        if (sub === 'help' || argv.includes('--help') || argv.includes('-h')) {
          if (argv.some((a) => a.startsWith('-') && a !== '--help' && a !== '-h')) {
            const unknown = argv.find((a) => a.startsWith('-') && a !== '--help' && a !== '-h');
            console.error(`${red}Opção desconhecida:${reset} ${unknown}`);
            process.exitCode = 1;
            return;
          }
          console.log(`\n  oxe-cc worktree link-node-modules [--from <origem>] [--dir <destino>] [--check-only] [--force] [--json]
  Cria junction/symlink seguro de node_modules validando SHA-256 do package-lock.json e integridade dos pacotes (OXB-G03 / OXB-G15).\n`);
          return;
        }
        if (sub !== 'link-node-modules') {
          console.error(`${red}Subcomando desconhecido:${reset} worktree ${sub} (use link-node-modules)`);
          process.exitCode = 1;
          return;
        }
        const o = { dir: process.cwd(), from: null, checkOnly: false, force: false, json: false };
        for (let i = 1; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--check-only') o.checkOnly = true;
          else if (a === '--force') o.force = true;
          else if (a === '--from' && argv[i + 1]) o.from = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        const res = require('../oxe-worktree-deps.cjs').linkNodeModules(o.dir, o);
        if (o.json) {
          console.log(JSON.stringify({ oxeWorktreeDepsSchema: 1, ...res }, null, 2));
        } else if (!res.ok) {
          console.error(`  ${red}✗${reset} node_modules junction recusada:`);
          for (const e of res.errors || []) console.error(`    - ${e}`);
        } else if (res.check_only) {
          console.log(`  ${green}✓${reset} lockfile e pacotes compatíveis (${res.checked_packages || 0} pacotes verificados)`);
        } else if (res.skipped) {
          console.log(`  ${dim}ignorado (${res.skipped})${reset}`);
        } else {
          console.log(`  ${green}✓${reset} ${res.link_type} criado: ${res.link_path} → ${res.source}/node_modules (${res.checked_packages || 0} pacotes validados)`);
        }
        if (!res.ok) process.exitCode = 1;
      },
    },
    {
      name: 'session',
      handler(argv) {
        const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'list';
        if (argv.includes('--help') || argv.includes('-h') || sub === 'help') {
          console.log(`\n  oxe-cc session create <id> [--title "<título>"] [--dir <pasta>] [--json]   cria .oxe/sessions/<id>/ e ativa em .oxe/STATE.md
  oxe-cc session switch <id|--none> [--dir <pasta>] [--json]               alterna a sessão ativa em .oxe/STATE.md (--none limpa)
  oxe-cc session list [--dir <pasta>] [--json]                             lista sessões em .oxe/sessions/ (* marca a ativa)

  Ids: sNNN-slug (s001-auth) e o id de um card (OXE-294, OXE-294-cache) ficam como estão; outro id vira sNNN-<id>
  (ex.: "cache" → s002-cache), e --session cache / session switch cache o encontram. create/switch mantêm .oxe/SESSIONS.md.\n`);
          return;
        }
        const o = { dir: process.cwd(), json: false, title: '', none: false };
        const pos = [];
        for (let i = (argv[0] === sub ? 1 : 0); i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--none') o.none = true;
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--title' && argv[i + 1] != null) o.title = String(argv[++i]);
          else if (!a.startsWith('-')) pos.push(a);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        const oxeDir = path.join(o.dir, '.oxe');
        const sessionsDir = path.join(oxeDir, 'sessions');
        const stateFile = path.join(oxeDir, 'STATE.md');
        const setActiveInState = (sessRel) => {
          fs.mkdirSync(oxeDir, { recursive: true });
          const cur = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : '# STATE\n\nFase atual: `spec_pending`\n';
          const line = sessRel ? `**active_session:** ${sessRel}` : '**active_session:** none';
          const updated = /^\s*(?:[-*]\s*)?(?:\*\*)?active_session(?:\*\*)?\s*:.*$/m.test(cur)
            ? cur.replace(/^\s*(?:[-*]\s*)?(?:\*\*)?active_session(?:\*\*)?\s*:.*$/m, line)
            : `${cur.trimEnd()}\n\n${line}\n`;
          fs.writeFileSync(stateFile, updated, 'utf8');
        };
        const normSessionId = (raw) => String(raw || '').trim().replace(/^sessions\//, '').replace(/[^A-Za-z0-9._-]/g, '-');
        const sessionsIndex = path.join(oxeDir, 'SESSIONS.md');
        const today = () => new Date().toISOString().slice(0, 10);
        const touchIndex = (id, { title = '', created = false } = {}) => {
          const header = '# OXE — Índice de sessões\n\n| ID | Nome | Status | Criada | Última atividade | Resumo | Path |\n|----|------|--------|--------|------------------|--------|------|\n';
          let text = fs.existsSync(sessionsIndex) ? fs.readFileSync(sessionsIndex, 'utf8') : header;
          if (!/\|\s*ID\s*\|/.test(text)) text = `${text.trimEnd()}\n\n${header}`;
          const rowRe = new RegExp(`^\\|[^\\n]*\`sessions/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`[^\\n]*\\|\\s*$`, 'm');
          if (rowRe.test(text)) {
            text = text.replace(rowRe, (row) => {
              const cells = row.split('|');
              if (cells.length > 6) { cells[3] = ' active '; cells[5] = ` ${today()} `; }
              return cells.join('|');
            });
          } else {
            const m = /^(s\d{3})-(.+)$/.exec(id);
            const row = `| ${m ? m[1] : id} | ${m ? m[2] : id} | active | ${today()} | ${today()} | ${(title || (created ? 'Sessão criada por oxe-cc session create' : 'Sessão ativada por oxe-cc session switch')).replace(/\|/g, '/')} | \`sessions/${id}\` |\n`;
            const sep = /^\|-+\|.*\n/m.exec(text);
            text = sep ? `${text.slice(0, sep.index + sep[0].length)}${row}${text.slice(sep.index + sep[0].length)}` : `${text.trimEnd()}\n${row}`;
          }
          fs.writeFileSync(sessionsIndex, text, 'utf8');
        };
        const CARD_ID_RE = /^[A-Z][A-Z0-9]+-\d+(?:-[A-Za-z0-9._-]+)?$/;
        const nextSessionId = (slug) => {
          let max = 0;
          try { for (const n of fs.readdirSync(sessionsDir)) { const m = /^s(\d{3})-/.exec(n); if (m) max = Math.max(max, Number(m[1])); } } catch { /* sem sessões */ }
          return `s${String(max + 1).padStart(3, '0')}-${slug.toLowerCase()}`;
        };
        if (sub === 'create') {
          const raw = normSessionId(pos[0]);
          if (!raw) { console.error(`${red}✗${reset} informe o id da sessão: oxe-cc session create <id>`); process.exitCode = 1; return; }
          const existing = sessionDirId(o.dir, raw);
          const id = existing || (/^s\d{3}-/.test(raw) || CARD_ID_RE.test(raw) ? raw : nextSessionId(raw));
          const sessRel = `sessions/${id}`;
          const sessAbs = path.join(sessionsDir, id);
          for (const d of ['spec', 'plan', 'verification', 'runs']) fs.mkdirSync(path.join(sessAbs, d), { recursive: true });
          const metaFile = path.join(sessAbs, 'SESSION.md');
          if (!fs.existsSync(metaFile)) {
            fs.writeFileSync(metaFile, `# Sessão ${id}${o.title ? ` — ${o.title}` : ''}\n\n- Criada em: ${new Date().toISOString()}\n- Status: active\n`, 'utf8');
          }
          touchIndex(id, { title: o.title, created: true });
          setActiveInState(sessRel);
          const out = { oxeSessionSchema: 1, action: 'create', id, ...(id !== raw ? { requested: raw } : {}), active_session: sessRel, path: path.relative(o.dir, sessAbs).replace(/\\/g, '/') };
          if (o.json) console.log(JSON.stringify(out, null, 2));
          else console.log(`  ${green}✓${reset} sessão criada e ativada: ${sessRel}${id !== raw ? ` (id "${raw}" fora do formato sNNN-slug; use --session ${raw} ou ${id})` : ''}`);
          return;
        }
        if (sub === 'switch') {
          if (o.none) {
            setActiveInState(null);
            const out = { oxeSessionSchema: 1, action: 'switch', active_session: null };
            if (o.json) console.log(JSON.stringify(out, null, 2));
            else console.log(`  ${green}✓${reset} sessão ativa limpa`);
            return;
          }
          const raw = normSessionId(pos[0]);
          if (!raw) { console.error(`${red}✗${reset} informe a sessão: oxe-cc session switch <id> (ou --none)`); process.exitCode = 1; return; }
          const id = sessionDirId(o.dir, raw);
          if (!id) { console.error(`${red}✗${reset} sessão não encontrada: sessions/${raw} (crie com oxe-cc session create ${raw})`); process.exitCode = 1; return; }
          const sessRel = `sessions/${id}`;
          touchIndex(id);
          setActiveInState(sessRel);
          const out = { oxeSessionSchema: 1, action: 'switch', id, active_session: sessRel };
          if (o.json) console.log(JSON.stringify(out, null, 2));
          else console.log(`  ${green}✓${reset} sessão ativa: ${sessRel}`);
          return;
        }
        if (sub === 'list') {
          const curState = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : '';
          const active = oxeHealth.parseActiveSession(curState) || null;
          const entries = fs.existsSync(sessionsDir)
            ? fs.readdirSync(sessionsDir).filter((n) => fs.statSync(path.join(sessionsDir, n)).isDirectory()).sort()
            : [];
          const sessions = entries.map((id) => ({ id, path: `sessions/${id}`, active: active === `sessions/${id}` || active === id }));
          if (o.json) console.log(JSON.stringify({ oxeSessionSchema: 1, action: 'list', active_session: active, sessions }, null, 2));
          else if (!sessions.length) console.log('  nenhuma sessão em .oxe/sessions/');
          else for (const s of sessions) console.log(`  ${s.active ? '*' : ' '} ${s.path}`);
          return;
        }
        console.error(`${red}Subcomando desconhecido:${reset} session ${sub} (use create | switch | list)`);
        process.exitCode = 1;
      },
    },
    {
      name: 'quick',
      async handler(argv) {
        const SUBS = ['status', 'trailers', 'list', 'done', 'start', 'commit', 'cancel', 'promote'];
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc quick <KEY> "<objetivo>" [--by <papel>] [--replace] [--alm-dir <pasta>] [--no-alm] [--apply|--dry-run] [--plain|--json]
  oxe-cc quick status | trailers | list [--plain|--json]                                                                  o quick aberto, as linhas de trailer, os quicks do projeto
  oxe-cc quick commit -m "<mensagem>" [<arquivos…>|--all] [--plain|--json]                                                o commit do quick, feito pelo CLI com os trailers
  oxe-cc quick cancel --reason "…" [--evidence <url|caminho>] [--no-alm] [--apply|--dry-run] [--plain|--json]             abandona o quick aberto (nunca "feito"); o card é comentado, não avança
  oxe-cc quick done [--verify "<comando>"] [--no-commit] [--no-alm] [--apply|--dry-run] [--plain|--json]                  fecha: commits com OXE-Quick, verificação rodada pelo CLI
  oxe-cc quick promote [--id <Q-...>] [--open-pr] [--base <branch>] [--draft] [--dry-run] [--force] [--plain|--json]      roda check-origin, faz push da branch e abre PR com Fecha <KEY>

  Modos de escrita:
    --dry-run       simula sem gravar nem localmente (.oxe/quick/ e QUICK.md ficam intactos; commits sem origem falham no hook commit-msg).
    (sem --apply)   grava o quick localmente (.oxe/quick/, QUICK.md e trailers) sem escrever no ALM; passe --apply para gravar também no ALM.
    --no-alm        desliga descoberta/escrita ALM (não varre worktrees irmãs; útil em execução paralela multi-agente).
    --plain         saída sem cores/decoração ANSI (útil em logs e scripts).

  Com ALM: herda automaticamente o bloco "alm" de oxe.config.json, worktree principal, PROGRAM.json (forked_from) ou irmãs (ou --alm-dir <pasta>).
  Todo commit do quick leva OXE-Quick (e OXE-Card com ALM); o hook commit-msg do oxe-cc guards install acrescenta.
  Workflow: /oxe-quick · conferência no PR: oxe-cc ship check-origin <#PR>\n`);
          return;
        }
        const o = { dir: process.cwd(), json: false };
        const positional = [];
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--plain') o.plain = true;
          else if (a === '--apply') o.apply = true;
          else if (a === '--dry-run') o.dryRun = true;
          else if (a === '--replace') o.replace = true;
          else if (a === '--no-commit') o.noCommit = true;
          else if (a === '--no-alm') o.noAlm = true;
          else if (a === '--local') o.local = true;
          else if (a === '--open-pr') o.openPr = true;
          else if (a === '--draft') o.draft = true;
          else if (a === '--force') o.force = true;
          else if (a === '--all') o.all = true;
          else if ((a === '-m' || a === '--message') && argv[i + 1] != null) o.message = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--alm-dir' && argv[i + 1]) o.almDir = path.resolve(argv[++i]);
          else if (a === '--from-card' && argv[i + 1]) o.fromCard = String(argv[++i]);
          else if (['--by', '--verify', '--id', '--key', '--objective', '--reason', '--evidence', '--base'].includes(a) && argv[i + 1] != null) o[a.slice(2)] = String(argv[++i]);
          else if (!a.startsWith('-')) positional.push(a);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        let action = 'status';
        if (positional[0] && SUBS.includes(positional[0])) action = positional.shift();
        else if (positional.length || o.fromCard) action = 'start';
        if (action === 'commit') o.paths = positional;
        if (action === 'list' && !o.all) o.local = true;
        if (action === 'start') {
          if (!o.key && positional[0] && /^[A-Za-z][A-Za-z0-9]*-\d+$|^\d+$/.test(positional[0])) o.key = positional.shift();
          if (!o.objective && positional.length) o.objective = positional.join(' ');
        }
        try {
          const out = await oxeOperational.runtimeQuick(o.dir, null, { action, ...o });
          if (o.json) { console.log(JSON.stringify({ oxeQuickSchema: 1, action, ...out }, null, 2)); if (out.closed === false) process.exitCode = 1; return; }
          const almLine = (a) => {
            if (!a) return;
            if (a.skipped) { console.log(`  ${yellow}!${reset} ALM: ${a.why}`); return; }
            if (a.pending) { console.log(`  ${yellow}⇢${reset} ALM: ${a.why}`); return; }
            if (a.error) { console.log(`  ${red}✗${reset} ALM: ${a.error}`); process.exitCode = 1; return; }
            const tag = a.dry_run ? `${yellow}(simulação)${reset} ` : '';
            if (a.from) {
              const srcLabel = a.from_kind === 'main' ? 'worktree principal' : a.from_kind === 'explicit' ? '--alm-dir' : 'worktree';
              console.log(`  ${dim}ALM herdado da ${srcLabel} ${a.from} (esta worktree não tem o bloco "alm")${reset}`);
            }
            if (a.comment) console.log(`  ${tag}${a.comment.planned ? 'comentaria' : a.comment.queued ? 'comentário na fila do MCP' : 'comentou'} no card`);
            if (a.move) console.log(`  ${tag}${a.move.skipped ? `não moveu: ${a.move.why}` : a.move.planned ? `moveria para "${a.move.planned.state}"` : a.move.queued ? 'movimento na fila do MCP' : a.move.changed === false ? `já em "${a.move.state}"` : `→ movido para "${a.move.state}"`}`);
            if (a.dry_run) console.log(`  ${dim}nada foi gravado no ALM; para gravar, rode com --apply${o.dryRun ? ' e sem --dry-run' : ''}${reset}`);
          };
          if (action === 'status') console.log(out.open ? `  quick aberto: ${out.open.id}${out.open.key ? ` (${out.open.key})` : ''} — ${out.open.objective}` : '  nenhum quick aberto (oxe-cc quick <KEY> "<objetivo>")');
          else if (action === 'trailers') console.log(out.trailers.join('\n'));
          else if (action === 'commit' && out.dry_run) console.log(`  ${yellow}(simulação)${reset} commitaria ${out.files.length} arquivo(s): ${out.files.join(', ') || '—'}\n${out.message.split('\n').map((l) => `      ${l}`).join('\n')}\n  ${dim}nada foi preparado nem commitado${reset}`);
          else if (action === 'commit') {
            console.log(`  ${green}✓${reset} ${out.sha.slice(0, 9)} ${out.message.split('\n')[0]} · ${out.files.length} arquivo(s) · ${out.id}${out.key ? ` (${out.key})` : ''}`);
            if (Array.isArray(out.other_staged) && out.other_staged.length) {
              console.log(`  ${yellow}!${reset} aviso: havia outro(s) arquivo(s) no stage fora dos paths informados (${out.other_staged.join(', ')}) — não foram incluídos neste commit`);
            }
          } else if (action === 'list') {
            if (!out.quicks.length) console.log(`  nenhum quick registrado${o.all ? '' : ' nesta worktree (use --all para incluir worktrees irmãs)'}`);
            for (const r of out.quicks) {
              const mark = r.active ? '*' : ' ';
              const loc = r.worktree || r.branch ? ` [${[r.worktree, r.branch].filter(Boolean).join(' · ')}]` : '';
              console.log(`  ${mark} ${r.id} ${String(r.status || '').padEnd(8)} ${r.key || '—'}${loc} · ${(r.commits || []).length} commit(s) · ${r.objective}`);
            }
          } else if (action === 'start') {
            console.log(out.dry_run ? `  ${yellow}(simulação)${reset} abriria ${out.id}${out.key ? ` (${out.key})` : ''} — ${out.objective}${out.would_replace ? ` · substituiria ${out.would_replace}` : ''}` : `  ${green}✓${reset} ${out.resumed ? 'retomado' : 'aberto'}: ${out.id}${out.key ? ` (${out.key})` : ''} — ${out.objective}`);
            console.log(`  commits deste quick levam: ${out.trailers.join(' · ')}`);
            almLine(out.alm);
            if (out.dry_run) console.log(`  ${dim}simulação: nenhum registro, QUICK.md, evento ou card gravado${reset}`);
            else console.log(`  ${dim}Próximo: /oxe-quick preenche passos e verificação no QUICK.md; feche com oxe-cc quick done --verify "<comando>"${reset}`);
          } else if (action === 'cancel') {
            console.log(out.dry_run ? `  ${yellow}(simulação)${reset} abandonaria ${out.id} — ${out.cancel.reason}` : `  ${green}✓${reset} ${out.id} abandonado (não conta como feito) · ${out.commits.length} commit(s) · ${out.cancel.reason}${out.cancel.evidence ? ` · evidência: ${out.cancel.evidence}` : ''}`);
            almLine(out.alm);
          } else if (action === 'done') {
            if (out.dry_run) { console.log(`  ${yellow}(simulação)${reset} fecharia ${out.id} com ${out.commits.length} commit(s)${out.would_verify ? ` depois de rodar: ${out.would_verify}` : ''}; nada rodado nem gravado`); return; }
            if (out.closed === false) { console.log(`  ${red}✗${reset} ${out.id}: a verificação falhou (exit ${out.verify.exit}); o quick continua aberto\n${out.verify.tail.split('\n').map((l) => `      ${l}`).join('\n')}`); process.exitCode = 1; return; }
            console.log(`  ${green}✓${reset} ${out.id} concluído · ${out.commits.length} commit(s)${out.verify ? ` · verificação ${out.verify.ok ? 'passou' : 'falhou'}` : ' · sem verificação informada'}`);
            almLine(out.alm);
            try {
              const nx = oxeHealth.buildHealthReport(o.dir).next;
              if (nx && nx.cursorCmd) console.log(`  ${dim}Próximo: ${nx.cursorCmd} — ${nx.reason}${reset}`);
            } catch { /* auxiliar */ }
          } else if (action === 'promote') {
            for (const w of out.warnings || []) console.log(`  ${yellow}!${reset} ${w}`);
            if (out.promoted) {
              console.log(`  ${green}✓${reset} PR aberto para ${out.id}${out.key ? ` (${out.key})` : ''}: ${out.pr || out.title}`);
            } else {
              console.log(`  ${yellow}(simulação)${reset} abriria PR para ${out.id}${out.key ? ` (${out.key})` : ''} (${out.branch || 'HEAD'} → ${out.base}): ${out.title}`);
              console.log(`  ${dim}para fazer push e abrir o PR, rode: oxe-cc quick promote --open-pr${reset}`);
            }
          }
        } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      },
    },
    {
      name: 'onboard',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc onboard [--json] [--write] [--propose-config [--dry-run|--apply]] [--dir <pasta>] [--session <id>]
  Gera dossiê de onboarding 100% read-only e agnóstico para qualquer agente ou dev recém-chegado:
  detecta stack, pipelines de CI (GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket, CircleCI,
  Jenkins ou local), ALM (Jira, Azure DevOps, custom ou sem ALM), vazamento stripEnvPrefixes e
  lacunas de espelhamento entre CI e phase_gates locais.
  Use --write para gravar .oxe/ONBOARDING.md.
  Use --propose-config para propor patch declarativo de .oxe/config.json (--dry-run padrão; --apply mescla sem destruir chaves existentes).\n`);
          return;
        }
        const o = { dir: process.cwd(), json: false, write: false, proposeConfig: false, apply: false, dryRun: false, activeSession: null };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--write') o.write = true;
          else if (a === '--propose-config') o.proposeConfig = true;
          else if (a === '--apply') o.apply = true;
          else if (a === '--dry-run') o.dryRun = true;
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--session' && argv[i + 1]) o.activeSession = String(argv[++i]).replace(/\\/g, '/');
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const onboardMod = require('../oxe-onboard.cjs');
          const resolvedSession = o.activeSession || (typeof sessionDirId === 'function' ? sessionDirId(o.dir) : null);
          if (o.proposeConfig) {
            const res = onboardMod.proposeOnboardingConfig(o.dir, {
              apply: o.apply && !o.dryRun,
              dryRun: o.dryRun || !o.apply,
              activeSession: resolvedSession,
            });
            if (o.json) {
              console.log(JSON.stringify({ oxeOnboardProposeSchema: 1, ...res }, null, 2));
            } else {
              console.log(res.dry_run
                ? `  ${yellow}(simulação)${reset} proposta para ${res.config_path}: +${res.added_gates.length} phase_gate(s)${res.proposed_patch.profile ? `, profile="${res.proposed_patch.profile}"` : ''}${res.proposed_patch.worktree ? `, worktree.auto_gc="${res.proposed_patch.worktree.auto_gc}"` : ''}`
                : `  ${green}✓${reset} ${res.config_path} atualizado de forma não-destrutiva (+${res.added_gates.length} phase_gate(s))`);
              for (const g of res.added_gates) console.log(`    + [${g.id}] ${g.command}`);
              if (res.dry_run) console.log(`  ${dim}nenhum arquivo foi gravado; rode com --apply para aplicar${reset}`);
            }
            return;
          }
          const pack = onboardMod.buildOnboardingPack(o.dir, {
            write: o.write,
            activeSession: resolvedSession,
          });
          if (o.json) {
            console.log(JSON.stringify({ oxeOnboardSchema: 1, ...pack }, null, 2));
          } else {
            console.log(pack.prompt_markdown);
            if (pack.written_path) console.log(`\n  ${green}✓${reset} gravado em ${pack.written_path}`);
          }
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'agents',
      handler(argv) {
        const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'list';
        if (sub === 'help' || argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc agents <register|heartbeat|release|list|collisions|send|inbox> [opções] [--json]
  Coordenação multi-agente local via <git-common-dir>/oxe/active-agents.json e agent-messages.ndjson:
    register   --id <id> [--provider <nome>] [--role <papel>] [--task <Tn>] [--files a,b] [--ttl-ms <ms>]
    heartbeat  --id <id> [--task <Tn>] [--files a,b]
    release    --id <id>
    list       [--dir <pasta>] [--json]
    collisions --files a,b [--exclude <id>] [--dir <pasta>] [--json]
    send       --from <id> [--to <id|all>] [--topic <t>] --body "…"
    inbox      [--to <id>] [--limit <N>] [--json]\n`);
          return;
        }
        const o = { dir: process.cwd(), json: false, strict: false, id: null, provider: null, role: null, task: null, files: [], ttlMs: null, pid: null, exclude: null, from: null, to: null, topic: null, body: null, limit: 50 };
        const startIdx = argv[0] && !argv[0].startsWith('-') ? 1 : 0;
        for (let i = startIdx; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--strict') o.strict = true;
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--id' && argv[i + 1]) o.id = String(argv[++i]);
          else if (a === '--provider' && argv[i + 1]) o.provider = String(argv[++i]);
          else if (a === '--role' && argv[i + 1]) o.role = String(argv[++i]);
          else if (a === '--task' && argv[i + 1]) o.task = String(argv[++i]);
          else if (a === '--files' && argv[i + 1]) o.files.push(...String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean));
          else if (a === '--ttl-ms' && argv[i + 1]) o.ttlMs = Number(argv[++i]);
          else if (a === '--pid' && argv[i + 1]) o.pid = Number(argv[++i]);
          else if (a === '--exclude' && argv[i + 1]) o.exclude = String(argv[++i]);
          else if (a === '--from' && argv[i + 1]) o.from = String(argv[++i]);
          else if (a === '--to' && argv[i + 1]) o.to = String(argv[++i]);
          else if (a === '--topic' && argv[i + 1]) o.topic = String(argv[++i]);
          else if (a === '--body' && argv[i + 1]) o.body = String(argv[++i]);
          else if (a === '--limit' && argv[i + 1]) o.limit = Number(argv[++i]) || 50;
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        const coord = require('../oxe-agent-coord.cjs');
        try {
          let payload;
          if (sub === 'register') {
            const lease = coord.registerAgentLease(o.dir, { agent_id: o.id, provider: o.provider, role: o.role, task: o.task, write_set: o.files, pid: o.pid != null ? o.pid : null, ttl_ms: o.ttlMs != null ? o.ttlMs : undefined });
            payload = { ok: true, action: 'register', lease };
          } else if (sub === 'heartbeat') {
            if (!o.id) throw new Error('informe --id <agent_id>');
            const lease = coord.heartbeatAgentLease(o.dir, o.id, { ...(o.task != null ? { task: o.task } : {}), ...(o.files.length ? { write_set: o.files } : {}), ...(o.ttlMs != null ? { ttl_ms: o.ttlMs } : {}) });
            payload = { ok: Boolean(lease), action: 'heartbeat', lease };
          } else if (sub === 'release') {
            if (!o.id) throw new Error('informe --id <agent_id>');
            payload = { ok: true, action: 'release', ...coord.releaseAgentLease(o.dir, o.id) };
          } else if (sub === 'collisions') {
            const col = coord.detectWriteSetCollisions(o.dir, o.files, { excludeAgentId: o.exclude, excludeWorktree: o.exclude ? null : o.dir });
            payload = { action: 'collisions', ...col };
            if (!col.ok && o.strict) process.exitCode = 1;
          } else if (sub === 'send') {
            if (!o.body) throw new Error('informe --body "…"');
            const message = coord.postAgentMessage(o.dir, { from: o.from || o.id || 'agent', to: o.to || 'all', topic: o.topic, body: o.body });
            payload = { ok: true, action: 'send', message };
          } else if (sub === 'inbox') {
            const messages = coord.readAgentMessages(o.dir, { to: o.to || o.id || null, limit: o.limit });
            payload = { ok: true, action: 'inbox', messages };
          } else {
            const agents = coord.listActiveAgents(o.dir);
            payload = { ok: true, action: 'list', agents };
          }
          if (o.json) {
            console.log(JSON.stringify({ oxeAgentsSchema: 1, ...payload }, null, 2));
          } else if (sub === 'list') {
            console.log(`  Agentes ativos: ${payload.agents.length}`);
            for (const a of payload.agents) console.log(`    - ${a.agent_id} [${a.provider}] ${a.branch || '—'} · tarefa=${a.task || '—'} · files=${(a.write_set || []).length}`);
          } else if (sub === 'collisions') {
            console.log(payload.ok ? `  ${green}✓${reset} 0 colisões de write_set` : `  ${yellow}!${reset} ${payload.collisions.length} colisão(ões) de write_set`);
            for (const c of payload.collisions) console.log(`    - ${c.file} em uso por ${c.agent_id} (${c.provider}, ${c.branch || c.worktree})`);
          } else {
            console.log(`  ${green}✓${reset} agents ${sub} concluído`);
          }
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'reevaluate',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc reevaluate [--against <ref>] [--since <sha>] [--dir <pasta>] [--json]
  Compara commits que pousaram na base (padrão origin/main) contra as tarefas pendentes do PLAN.json,
  classificando cada tarefa em no_impact, mechanical_sync (oxe-cc sync) ou contract_drift (CR focado).\n`);
          return;
        }
        const o = { dir: process.cwd(), against: null, since: null, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if ((a === '--against' || a === '--base') && argv[i + 1]) o.against = String(argv[++i]);
          else if (a === '--since' && argv[i + 1]) o.since = String(argv[++i]);
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const out = require('../oxe-reevaluate.cjs').reevaluateAgainstBase(o.dir, o);
          if (o.json) {
            console.log(JSON.stringify({ oxeReevaluateSchema: 1, ...out }, null, 2));
          } else {
            console.log(`  reevaluate vs ${out.base} (${out.upstream_commits_count} commit(s) upstream) → ${out.overall_status}`);
            for (const t of out.tasks) {
              const icon = t.classification === 'contract_drift' ? `${red}✗${reset}` : t.classification === 'mechanical_sync' ? `${yellow}!${reset}` : `${green}✓${reset}`;
              console.log(`    ${icon} ${t.id} [${t.classification}] ${t.title} → ${t.recommended_action}`);
            }
          }
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
    {
      name: 'mcp',
      async handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc mcp [--dir <pasta>] [--session <sessão>]
  Inicia o servidor MCP (Model Context Protocol) nativo do OXE em JSON-RPC 2.0 sobre stdio
  (zero dependências externas), expondo ferramentas tipadas como oxe_status, oxe_onboard,
  oxe_agents_list, oxe_agents_collisions, oxe_reevaluate, oxe_plan_lint e oxe_scorecard.\n`);
          return;
        }
        const o = { dir: process.cwd(), session: null };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--session' && argv[i + 1]) o.session = String(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        await require('../oxe-mcp-server.cjs').startStdioServer({
          projectRoot: o.dir,
          activeSession: o.session,
        });
      },
    },
    {
      name: 'primer',
      handler(argv) {
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc primer [--dir <pasta>] [--session <sessão>] [--json]
  Guia compacto (< 80 linhas) para qualquer agente compreender imediatamente o uso do OXE,
  detectando greenfield/brownfield, entrega ativa e o protocolo único de \`oxe-cc deliver\`.\n`);
          return;
        }
        const o = { dir: process.cwd(), session: null, json: false };
        for (let i = 0; i < argv.length; i += 1) {
          const a = argv[i];
          if (a === '--json') o.json = true;
          else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
          else if (a === '--session' && argv[i + 1]) o.session = String(argv[++i]);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        const primerMod = require('../oxe-primer.cjs');
        const primer = primerMod.buildPrimer(o.dir, { activeSession: o.session });
        if (o.json) {
          console.log(JSON.stringify(primer, null, 2));
        } else {
          process.stdout.write(primerMod.formatPrimerMarkdown(primer));
        }
      },
    },
    {
      name: 'deliver',
      async handler(argv) {
        const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'status';
        const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;
        if (argv.includes('--help') || argv.includes('-h')) {
          console.log(`\n  oxe-cc deliver <init|mode|answer|approve|next|advance|run|resume|status|cancel> [opções]
  Orquestrador autônomo ponta-a-ponta (Briefing → SPEC/Fases → Testes Congelados → Execução → FINAL_SMOKE → DELIVERY.md).
    init --from <briefing.md> | --text "..." [--approval single-ok|auto] [--max-budget-usd <N>] [--dir <pasta>] [--json]
    mode <single-ok|auto> [--dir <pasta>] [--json]
    answer --answers-json '{"Q1":"..."}' [--dir <pasta>] [--json]
    approve [--by <autor>] [--dir <pasta>] [--json]
    next [--dir <pasta>] [--json]
    advance [--frozen-tests a.test.cjs,b.test.cjs] [--verify "<cmd>"] [--smoke "<cmd>"] [--dir <pasta>] [--json]
    run [--from <briefing.md>] [--approval single-ok|auto] [--executor claude|codex] [--max-budget-usd <N>] [--dir <pasta>] [--json]
    resume [--note "..."] [--add-budget-usd <N>] [--dir <pasta>] [--json]
    status [--dir <pasta>] [--json]
    cancel [--reason "..."] [--dir <pasta>] [--json]\n`);
          return;
        }
        const o = {
          dir: process.cwd(),
          session: null,
          json: false,
          from: null,
          text: null,
          approval: null,
          maxBudgetUsd: null,
          maxAttempts: null,
          frozenTests: null,
          verifyCommand: null,
          smokeCommand: null,
          answersJson: null,
          by: null,
          note: null,
          reason: null,
          executor: null,
          addBudgetUsd: null,
          positional: [],
        };
        for (let i = 0; i < rest.length; i += 1) {
          const a = rest[i];
          if (a === '--json') o.json = true;
          else if (a === '--dir' && rest[i + 1]) o.dir = path.resolve(rest[++i]);
          else if (a === '--session' && rest[i + 1]) o.session = String(rest[++i]);
          else if (a === '--from' && rest[i + 1]) o.from = String(rest[++i]);
          else if (a === '--text' && rest[i + 1]) o.text = String(rest[++i]);
          else if (a === '--approval' && rest[i + 1]) o.approval = String(rest[++i]);
          else if (a === '--max-budget-usd' && rest[i + 1]) o.maxBudgetUsd = Number(rest[++i]);
          else if (a === '--max-attempts' && rest[i + 1]) o.maxAttempts = Number(rest[++i]);
          else if (a === '--frozen-tests' && rest[i + 1]) o.frozenTests = String(rest[++i]).split(',').map((x) => x.trim()).filter(Boolean);
          else if (a === '--verify' && rest[i + 1]) o.verifyCommand = String(rest[++i]);
          else if (a === '--smoke' && rest[i + 1]) o.smokeCommand = String(rest[++i]);
          else if (a === '--answers-json' && rest[i + 1]) o.answersJson = String(rest[++i]);
          else if (a === '--by' && rest[i + 1]) o.by = String(rest[++i]);
          else if (a === '--note' && rest[i + 1]) o.note = String(rest[++i]);
          else if (a === '--reason' && rest[i + 1]) o.reason = String(rest[++i]);
          else if (a === '--executor' && rest[i + 1]) o.executor = String(rest[++i]);
          else if (a === '--add-budget-usd' && rest[i + 1]) o.addBudgetUsd = Number(rest[++i]);
          else if (!a.startsWith('-')) o.positional.push(a);
          else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exitCode = 1; return; }
        }
        try {
          const intake = require('../oxe-deliver-intake.cjs');
          const engine = require('../oxe-deliver-engine.cjs');
          let out = null;
          if (sub === 'init') {
            out = intake.initDelivery(o.dir, {
              from: o.from,
              briefingText: o.text,
              approval: o.approval,
              session: o.session,
              maxBudgetUsd: o.maxBudgetUsd,
              maxAttempts: o.maxAttempts,
            });
          } else if (sub === 'mode') {
            const targetMode = o.approval || o.positional[0];
            out = engine.setApprovalMode(o.dir, targetMode, { session: o.session });
          } else if (sub === 'answer') {
            const answers = o.answersJson ? JSON.parse(o.answersJson) : {};
            out = engine.answerClarification(o.dir, answers, { session: o.session });
          } else if (sub === 'approve') {
            out = engine.approveDelivery(o.dir, { session: o.session, by: o.by });
          } else if (sub === 'next') {
            out = engine.getNextDeliveryStep(o.dir, { session: o.session });
          } else if (sub === 'advance') {
            out = engine.advanceDelivery(o.dir, {
              session: o.session,
              frozenTests: o.frozenTests,
              verifyCommand: o.verifyCommand,
              smokeCommand: o.smokeCommand,
            });
          } else if (sub === 'resume') {
            out = engine.resumeDelivery(o.dir, { session: o.session, note: o.note, addBudgetUsd: o.addBudgetUsd });
          } else if (sub === 'cancel') {
            out = engine.cancelDelivery(o.dir, { session: o.session, reason: o.reason });
          } else if (sub === 'run') {
            const runnerPath = path.join(__dirname, '..', 'oxe-deliver-runner.cjs');
            if (!fs.existsSync(runnerPath)) throw new Error('Runner headless (oxe-deliver-runner.cjs) indisponível.');
            out = await require(runnerPath).runAutonomousDelivery(o.dir, {
              from: o.from,
              briefingText: o.text,
              approval: o.approval,
              executor: o.executor,
              maxBudgetUsd: o.maxBudgetUsd,
              maxAttempts: o.maxAttempts,
              session: o.session,
            });
          } else {
            out = engine.getDeliveryStatus(o.dir, { session: o.session });
          }
          if (o.json) {
            console.log(JSON.stringify(out, null, 2));
          } else if (sub === 'init') {
            console.log(`  ${green}✓${reset} deliver init: ${out.deliver_id} · status=${out.state.status} · modo=${out.state.approval_mode}`);
            if (out.approval_prompt) console.log(`  ${yellow}?${reset} ${out.approval_prompt}`);
          } else if (sub === 'next') {
            console.log(`  deliver next [${out.state}]${out.phase ? ` (${out.phase.id} ${out.phase.index}/${out.phase.total})` : ''}`);
            console.log(`  Instrução: ${out.instruction}`);
            if (out.advance_cmd) console.log(`  Avançar:   ${out.advance_cmd}`);
          } else if (sub === 'status') {
            if (!out.exists) console.log('  Nenhuma entrega ativa. Inicie com `oxe-cc deliver init --from <briefing.md>`.');
            else console.log(`  deliver ${out.deliver_id} · status=${out.state.status} · fases=${out.progress.closed}/${out.progress.total} (${out.progress.pct}%) · modo=${out.state.approval_mode}`);
          } else {
            console.log(`  ${out && out.ok === false ? `${red}✗${reset}` : `${green}✓${reset}`} deliver ${sub}: ${out && out.error ? out.error : (out && out.state ? out.state.status : 'ok')}`);
          }
          if (out && out.ok === false) process.exitCode = 1;
        } catch (err) {
          console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
          process.exitCode = 1;
        }
      },
    },
  ]);
}

module.exports = { createOpsCommandRegistry };

'use strict';

/**
 * 1.22.2 (OXB-222-16, ADR D-6 Fatia 2): Extracted spec, program (phase/criterion/export),
 * policy, prd, and rfc CLI command handlers with unified active-session resolution (OXB-222-14).
 */

const fs = require('fs');
const path = require('path');
const { createCommandRegistry } = require('../oxe-command-registry.cjs');

function createSpecProgramCommandRegistry(deps = {}) {
  const colors = deps.colors || {};
  const red = colors.red || '';
  const yellow = colors.yellow || '';
  const green = colors.green || '';
  const dim = colors.dim || '';
  const reset = colors.reset || '';
  const { oxeOperational, useAnsiColors } = deps;
  const libDir = path.resolve(__dirname, '..');

  async function dispatchSpecProgram(command, argv) {
    // OXB-058: `oxe-cc spec amend|add …` and `oxe-cc program phase add|export …`.
    // OXB-099: import the frozen tests of a PR / commit into the program.
    // 1.21.2: the quality gate of the upstream, and the approval that closes it.
    if (command === 'spec' && (argv[0] === 'check' || argv[0] === 'approve')) {
      const sub = argv[0];
      const o = { dir: process.cwd(), json: false, fast: false };
      for (let i = 1; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (a === '--fast') o.fast = true;
        else if (a === '--ears') o.ears = true;
        else if (a === '--strict-ears') { o.ears = true; o.strictEars = true; }
        else if (a === '--by' && argv[i + 1]) o.by = String(argv[++i]);
        else if (a === '--card' && argv[i + 1]) o.card = String(argv[++i]);
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else if (!a.startsWith('-')) o.dir = path.resolve(a);
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      try {
        const out = sub === 'check' ? oxeOperational.runtimeSpecCheck(o.dir, null, o) : oxeOperational.runtimeSpecApprove(o.dir, null, o);
        if (sub === 'check' && o.ears) {
          const earsLib = require(path.join(libDir, 'oxe-spec-ears.cjs'));
          const specPath = path.join(o.dir, '.oxe', 'SPEC.md');
          const ears = earsLib.validateSpecEars(fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '', { strictEars: Boolean(o.strictEars) });
          out.ears = ears;
          for (const e of ears.errors) out.errors.push(e.message);
          for (const w of ears.warnings) out.warnings.push(w.message);
          if (!ears.ok) out.ok = false;
        }
        if (o.json) { console.log(JSON.stringify({ oxeSpecCheckSchema: 1, ...out }, null, 2)); if (sub === 'check' && !out.ok) process.exitCode = 1; return; }
        const check = sub === 'check' ? out : out.check;
        const s = check.summary;
        console.log(`  SPEC: ${s.criteria} critério(s) · ${s.requirements} requisito(s) · ${s.stories} história(s) · ${s.terms} termo(s) · grill ${s.grill}${s.risky && s.risky.length ? ` · risco P0/P1: ${s.risky.join(', ')}` : ''}`);
        for (const e of check.errors) console.log(`  ${red}✗${reset} ${e}`);
        for (const w of check.warnings) console.log(`  ${yellow}!${reset} ${w}`);
        if (sub === 'check') {
          console.log(check.ok ? `  ${green}✓${reset} spec check verde${check.warnings.length ? ` (${check.warnings.length} aviso(s))` : ''} — próximo: oxe-cc spec probe, e oxe-cc spec approve --by <papel> com o OK do usuário` : `  ${red}spec check reprovado${reset}: ${check.errors.length} erro(s)`);
          if (!check.ok) process.exitCode = 1;
        } else console.log(`  ${green}✓${reset} spec aprovada por ${out.by} (${out.hash}) — mudanças daqui em diante: oxe-cc spec amend`);
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

    if (command === 'spec' && argv[0] === 'freeze') {
      const o = { dir: process.cwd(), json: false };
      for (let i = 1; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (['--from', '--paths', '--criteria', '--cr', '--command', '--task', '--by', '--reason'].includes(a) && argv[i + 1]) o[a.slice(2)] = String(argv[++i]);
        else if (a === '--proves-filter' && argv[i + 1]) o.provesFilter = String(argv[++i]);
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      try {
        if (!o.from) throw new Error('use: oxe-cc spec freeze --from <#PR|sha> [--paths "tests/acceptance/**"] [--criteria A12] [--cr CR-n] [--task Tn] [--command "…"] [--proves-filter "<padrão>"] [--by <papel>]');
        const out = oxeOperational.runtimeSpecFreeze(o.dir, null, o);
        if (o.json) { console.log(JSON.stringify({ oxeSpecFreezeSchema: 1, ...out }, null, 2)); if (out.refused.length) process.exitCode = 1; return; }
        for (const f of out.frozen) console.log(`  ${green}✓${reset} ${f.file} → ${f.criterion} (${f.proves} título(s), origem ${f.origin})`);
        for (const r of out.refused) console.log(`  ${red}✗${reset} ${r.why}`);
        for (const w of out.rigor || []) console.log(`  ${yellow}!${reset} ${w}`);
        // the CR stays open until the verify runs this test green (oxe-change resolveByVerify); never silently
        if (o.cr && out.frozen.length) console.log(`  ${dim}${String(o.cr).toUpperCase()} segue aberto: o verify o resolve quando este teste passar (runtime verify); para fechar antes: oxe-cc runtime feedback resolve ${String(o.cr).toUpperCase()}${reset}`);
        if (out.refused.length) process.exitCode = 1;
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

    // OXB-143: stress test of the spec by independent readers.
    if (command === 'spec' && argv[0] === 'stress') {
      const accept = argv[1] === 'accept';
      const o = { dir: process.cwd(), json: false, ids: [] };
      for (let i = accept ? 2 : 1; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (['--phase', '--methods', '--changes', '--by', '--model'].includes(a) && argv[i + 1]) o[a.slice(2)] = String(argv[++i]);
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else if (/^A\d+$/i.test(a)) o.ids.push(a.toUpperCase());
        else if (accept && /^stress-/.test(a)) o.run = a;
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      try {
        const out = await oxeOperational.runtimeSpecStress(o.dir, null, { action: accept ? 'accept' : 'run', ids: o.ids, phase: o.phase, methods: o.methods, changes: o.changes, by: o.by, run: o.run, model: o.model });
        if (o.json) { console.log(JSON.stringify({ oxeSpecStressSchema: 1, ...out, prompts: undefined }, null, 2)); return; }
        if (accept) { for (const a of out.accepted) console.log(`  ${green}✓${reset} ${a.n} → ${a.criterion} (${a.method}) · ${a.cr}`); return; }
        for (const p of out.proposals) console.log(p.n ? `  ${p.n}. ${p.criterion} [${p.method}] ${p.text}` : `  ${yellow}?${reset} ${p.criterion} [${p.method}] não rodou: ${p.reason}`);
        console.log(`  → .oxe/stress/${out.id}.json · aceite: oxe-cc spec stress accept ${out.id} --changes 1,3 --by <papel>`);
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

    // OXB-123: edge and prohibition probes on the spec.
    if (command === 'spec' && argv[0] === 'probe') {
      const o = { dir: process.cwd(), json: false, ids: [] };
      for (let i = 1; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (a === '--all') o.ids = [];
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else if (/^A\d+$/i.test(a)) o.ids.push(a.toUpperCase());
        else if (!a.startsWith('-')) o.dir = path.resolve(a);
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      try {
        const out = oxeOperational.runtimeSpecProbe(o.dir, null, { ids: o.ids });
        if (o.json) { console.log(JSON.stringify({ oxeSpecProbeSchema: 1, ...out }, null, 2)); return; }
        console.log(`  ${green}✓${reset} ${out.edges.length} borda(s) e ${out.prohibitions.length} proibição(ões) novas em ${out.spec} — marque cada borda como coberta | descartada (com motivo) | prova_extra | aberta, e cada proibição como teste | julgamento`);
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

    if (command === 'spec' || command === 'program') {
      // OXB-076: `program phase edit Fn …` and `program criterion move A<n> --from Fn --to Fm`.
      const sub = command === 'spec' ? argv[0]
        : argv[0] === 'phase' ? `phase ${argv[1]}`
          : argv[0] === 'criterion' ? `criterion ${argv[1]}`
            : 'export';
      const rest = command === 'program' && (argv[0] === 'phase' || argv[0] === 'criterion') ? argv.slice(2) : argv.slice(1);
      if (command === 'program' && !['phase add', 'phase edit', 'phase restore-close', 'criterion move', 'export'].includes(sub)) {
        console.error(`${red}Use:${reset} oxe-cc program phase add --after Fn --title "…" [--requirements R14] [--acceptance A42,A43] [--scope "…"] --by <papel>`);
        console.error(`     oxe-cc program phase edit Fn [--title "…"] [--add-requirements R17] [--remove-requirements R2] [--add-acceptance A58] [--remove-acceptance A3] [--scope "…" [--keep-bullets] | --scope-file escopo.md] --by <papel>`);
        console.error(`     oxe-cc program phase restore-close Fn --from-history --by <papel> --reason "…" [--dry-run]   (fase reaberta por um CR que não mudou código)`);
        console.error(`     oxe-cc program criterion move A<n> --from Fn --to Fm --by <papel>`);
        process.exit(1);
      }
      const o = { dir: process.cwd(), session: null, json: false };
      const positional = [];
      const VALUE_FLAGS = { '--by': 'by', '--reason': 'reason', '--text': 'text', '--append': 'append', '--verify': 'verify', '--risk': 'risk', '--phase': 'phase', '--criteria': 'criteria', '--before': 'before', '--version': 'version', '--after': 'after', '--title': 'title', '--requirements': 'requirements', '--acceptance': 'acceptance', '--scope': 'scope', '--add-requirements': 'addRequirements', '--remove-requirements': 'removeRequirements', '--add-acceptance': 'addAcceptance', '--remove-acceptance': 'removeAcceptance', '--from': 'from', '--to': 'to', '--out': 'out', '--scope-file': 'scopeFile', '--depends-on': 'dependsOn', '--cr': 'cr' };
      for (let i = 0; i < rest.length; i += 1) {
        const a = rest[i];
        if (VALUE_FLAGS[a] && rest[i + 1] != null) o[VALUE_FLAGS[a]] = String(rest[++i]);
        else if (a === '--dir' && rest[i + 1]) o.dir = path.resolve(rest[++i]);
        else if (a === '--session' && rest[i + 1]) o.session = String(rest[++i]).replace(/\\/g, '/');
        else if (a === '--additive') o.additive = true;
        else if (a === '--allow-gap') o.allowGap = true;
        else if (a === '--keep-bullets') o.keepBullets = true;
        else if (a === '--standing') o.standing = true;
        else if (a === '--json') o.json = true;
        // OXB-C30: only restore-close has a preview; elsewhere --dry-run stays an unknown option (never a silent write)
        else if (a === '--dry-run' && sub === 'phase restore-close') o.dryRun = true;
        else if (a === '--from-history' && sub === 'phase restore-close') o.fromHistory = true;
        else if (a.startsWith('-')) { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
        else positional.push(a);
      }
      const c = useAnsiColors();
      try {
        let out;
        if (command === 'spec' && sub === 'amend') {
          out = oxeOperational.runtimeSpecAmend(o.dir, o.session, { ...o, id: positional[0] });
          if (!o.json) {
            console.log(`  ${c ? green : ''}✓${c ? reset : ''} ${out.id} → v${out.version} (${out.cr.id}${out.attached ? ', emenda do CR aberto' : `, ${out.cr.amendment}`}) na fase ${out.phase || '—'}`);
            console.log(`  antes:  ${out.before}\n  depois: ${out.after}`);
            if (out.reopened_tasks && out.reopened_tasks.length) console.log(`  Reabertas: ${out.reopened_tasks.join(', ')}`);
          }
        } else if (command === 'spec' && sub === 'add') {
          out = oxeOperational.runtimeSpecAdd(o.dir, o.session, { ...o, kind: positional[0], id: positional[1] });
          if (!o.json) console.log(`  ${c ? green : ''}✓${c ? reset : ''} ${out.id} adicionado à SPEC: ${out.after}`);
        } else if (sub === 'phase add') {
          out = oxeOperational.runtimeProgramPhaseAdd(o.dir, o.session, o);
          if (!o.json) {
            if (!out.already) console.log(`  ${c ? green : ''}✓${c ? reset : ''} fase ${out.phase} inserida depois de ${out.after}${out.renumbered.length ? ` · renumeradas: ${out.renumbered.map((r) => `${r.from}→${r.to}`).join(', ')}` : ''}`);
            if (out.moved_change_records) console.log(`  ${out.moved_change_records} registro(s) de mudança acompanharam a fase renumerada`);
            for (const w of out.warnings) console.log(`  ${yellow}!${reset} ${w}`);
            for (const l of out.leftovers) console.log(`  ${yellow}!${reset} ${l}`);
          }
        } else if (sub === 'phase edit') {
          out = oxeOperational.runtimeProgramPhaseEdit(o.dir, o.session, { ...o, phase: positional[0] || o.phase });
          if (!o.json) {
            console.log(`  ${c ? green : ''}✓${c ? reset : ''} ${out.phase} editada: R ${out.after.requirements.join(', ') || '—'} · A ${out.after.acceptance.join(', ') || '—'}${out.after.title !== out.before.title ? ` · título "${out.after.title}"` : ''}`);
            if (out.plan_removed_tests.length || out.plan_removed_tasks.length) console.log(`  plano atual: testes removidos ${out.plan_removed_tests.join(', ') || '—'} · tarefas removidas ${out.plan_removed_tasks.join(', ') || '—'}`);
            for (const w of out.warnings) console.log(`  ${yellow}!${reset} ${w}`);
          }
        } else if (sub === 'phase restore-close') {
          out = oxeOperational.runtimeProgramPhaseRestoreClose(o.dir, o.session, { ...o, phase: positional[0] || o.phase });
          if (!o.json) {
            const what = `${out.phase}: ${out.from_status} → closed (close de ${out.closed_at}, commit ${out.closed_commit ? String(out.closed_commit).slice(0, 8) : '—'})${out.reopened_by_cr ? ` · reaberta por ${out.reopened_by_cr}${out.reopened_by_class ? ` (${out.reopened_by_class})` : ''}` : ''}`;
            console.log(out.dry_run ? `  ${c ? yellow : ''}[simulação]${c ? reset : ''} ${what} — nada foi gravado` : `  ${c ? green : ''}✓${c ? reset : ''} close restaurado: ${what}`);
          }
        } else if (sub === 'criterion move') {
          out = oxeOperational.runtimeProgramCriterionMove(o.dir, o.session, { ...o, id: positional[0] });
          if (!o.json) {
            console.log(`  ${c ? green : ''}✓${c ? reset : ''} ${out.criterion}: ${out.from} → ${out.to}${out.moved_change_records ? ` · ${out.moved_change_records} CR(s) acompanharam` : ''}`);
            if (out.plan_removed_tests.length || out.plan_removed_tasks.length) console.log(`  plano atual: testes removidos ${out.plan_removed_tests.join(', ') || '—'} · tarefas removidas ${out.plan_removed_tasks.join(', ') || '—'}`);
            for (const w of out.warnings) console.log(`  ${yellow}!${reset} ${w}`);
          }
        } else if (sub === 'export') {
          // OXB-083: the positional is the PROJECT dir, as in every other command; the output is --out (default export_dir).
          if (positional[0]) {
            const projectDir = path.resolve(positional[0]);
            if (!fs.existsSync(path.join(projectDir, '.oxe')) && fs.existsSync(path.join(o.dir, '.oxe'))) {
              throw new Error(`${positional[0]} não é um projeto OXE (sem .oxe/). O posicional é a pasta do projeto; para escolher a saída use --out ${positional[0]}`);
            }
            o.dir = projectDir;
          }
          out = oxeOperational.runtimeProgramExport(o.dir, o.session, { dir: o.out || null });
          if (!o.json) {
            console.log(`  ${c ? green : ''}✓${c ? reset : ''} exportado para ${out.dir}: ${out.written.map((w) => path.basename(w)).join(', ')}`);
            if (out.missing.length) console.log(`  ${c ? dim : ''}ausentes:${c ? reset : ''} ${out.missing.join(', ')}`);
          }
        } else {
          console.error(`${red}Use:${reset} oxe-cc spec amend A<n> (--text|--append|--verify|--risk) --by <papel> --reason "…" [--additive] | oxe-cc spec add criterion A<n> --text "…" --verify "…" [--risk P1] --by <papel> --reason "…" | oxe-cc spec add requirement R<n> --text "…" [--criteria A<n>] [--before "<cabeçalho>"] --by <papel> --reason "…"`);
          process.exit(1);
        }
        if (o.json) console.log(JSON.stringify({ oxeProgramEditSchema: 1, ...out, program: undefined }, null, 2));
        else if (out && out.export && out.export.written) console.log(`  ${c ? dim : ''}export atualizado:${c ? reset : ''} ${out.export.dir}`);
        process.exit(0);
      } catch (err) {
        console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`);
        process.exit(1);
      }
    }

    // OXB-118: oxe-cc policy list [--json] [--dir]
    if (command === 'policy') {
      const rest = argv.slice(argv[0] === 'list' ? 1 : 0);
      let dir = process.cwd();
      let json = false;
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '--json') json = true;
        else if (rest[i] === '--dir' && rest[i + 1]) dir = path.resolve(rest[++i]);
        else if (!rest[i].startsWith('-')) dir = path.resolve(rest[i]);
      }
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'config.json'), 'utf8')) || {}; } catch { cfg = {}; }
      const rows = require('../oxe-policy-rules.cjs').classifyRules(cfg.policy_rules);
      if (json) { console.log(JSON.stringify({ oxePolicySchema: 1, enforced: rows.filter((r) => r.state === 'enforced').length, advisory: rows.filter((r) => r.state === 'advisory').length, rules: rows.map(({ rule, ...r }) => r) }, null, 2)); process.exit(0); }
      const c = useAnsiColors();
      console.log(`  Regras do projeto: ${rows.filter((r) => r.state === 'enforced').length} aplicada(s), ${rows.filter((r) => r.state === 'advisory').length} só texto`);
      for (const r of rows) console.log(`  ${r.state === 'enforced' ? (c ? green : '') + 'aplicada ' : (c ? yellow : '') + 'só texto '}${c ? reset : ''} ${r.id.padEnd(14)} ${r.kind.padEnd(8)} ${r.text.slice(0, 90)}${r.problem ? ` — ${r.problem}` : ''}`);
      process.exit(0);
    }

  }

  async function dispatchPrdRfc(command, argv) {
    // 1.21.2: PRD traceability.
    if (command === 'prd') {
      if (argv.includes('--help') || argv.includes('-h')) {
        console.log(`
    oxe-cc prd lint [--json] [--dir <pasta>]   valida rastreabilidade US-n → R* / A* e métricas no PRD.md
  `);
        return;
      }
      const o = { dir: process.cwd(), json: false, session: null };
      for (let i = argv[0] === 'lint' ? 1 : 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (a === '--session' && argv[i + 1]) o.session = String(argv[++i]).replace(/\\/g, '/');
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else if (!a.startsWith('-')) o.dir = path.resolve(a);
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      try {
        const out = oxeOperational.runtimePrd(o.dir, o.session);
        if (o.json) { console.log(JSON.stringify({ oxePrdSchema: 1, ...out }, null, 2)); }
        else {
          console.log(out.exists ? `  PRD ${out.file} (v${out.version}): ${out.stories} história(s), ${out.metrics} métrica(s)` : `  ${yellow}Sem PRD${reset} (${out.file}) — o /oxe-spec gera a partir de oxe/templates/PRD.template.md`);
          for (const e of out.errors) console.log(`  ${red}✗${reset} ${e}`);
          for (const w of out.warnings) console.log(`  ${yellow}!${reset} ${w}`);
          if (out.exists && !out.errors.length && !out.warnings.length) console.log(`  ${green}✓${reset} rastreabilidade ok`);
        }
        if (!out.ok) process.exitCode = 1;
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

    // 1.21.2: RFCs before the plan of a risky phase.
    if (command === 'rfc') {
      if (argv.includes('--help') || argv.includes('-h')) {
        console.log(`
    oxe-cc rfc list [--json] [--dir <pasta>]                                 lista RFCs e perguntas em aberto
    oxe-cc rfc new --title "…" [--phase F<n>] [--by <papel>]                 cria rascunho de RFC antes do plano
    oxe-cc rfc accept <RFC-n> [--by <papel>] [--force]                       aceita RFC e publica decisão/ADR
    oxe-cc rfc reject <RFC-n> --reason "…" [--by <papel>]                    recusa RFC com motivo registrado
  `);
        return;
      }
      const SUBS = ['new', 'list', 'accept', 'reject'];
      const sub = SUBS.includes(argv[0]) ? argv[0] : 'list';
      const o = { dir: process.cwd(), json: false };
      const positional = [];
      for (let i = sub === argv[0] ? 1 : 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') o.json = true;
        else if (a === '--force') o.force = true;
        else if (a === '--dir' && argv[i + 1]) o.dir = path.resolve(argv[++i]);
        else if (['--title', '--phase', '--by', '--reason'].includes(a) && argv[i + 1]) o[a.slice(2)] = String(argv[++i]);
        else if (!a.startsWith('-')) positional.push(a);
        else { console.error(`${red}Opção desconhecida:${reset} ${a}`); process.exit(1); }
      }
      if (sub === 'accept' || sub === 'reject') { o.id = positional[0]; if (!o.id) { console.error(`${red}Uso:${reset} oxe-cc rfc ${sub} <RFC-…>${sub === 'reject' ? ' --reason "…"' : ' [--by <papel>]'}`); process.exit(1); } }
      else if (positional[0]) o.dir = path.resolve(positional[0]);
      try {
        const out = oxeOperational.runtimeRfc(o.dir, null, { action: sub, ...o });
        if (o.json) { console.log(JSON.stringify({ oxeRfcSchema: 1, ...out }, null, 2)); return; }
        if (sub === 'new') console.log(`  ${green}✓${reset} ${out.id} → ${out.file} (preencha e rode oxe-cc rfc accept ${out.id})`);
        else if (sub === 'accept') console.log(`  ${green}✓${reset} ${out.rfc} aceito → decisão ${out.decision} (ADR publicado)`);
        else if (sub === 'reject') console.log(`  ${green}✓${reset} ${out.rfc} recusado`);
        else if (!out.rfcs.length) console.log('  Nenhum RFC. Crie com: oxe-cc rfc new --title "…"');
        else for (const r of out.rfcs) console.log(`  ${String(r.id).padEnd(12)} ${(r.phase || '—').padEnd(4)} ${require('../oxe-rfc.cjs').STATUS_PT[r.status].padEnd(11)} ${r.title}${r.decision ? `  → ${r.decision}` : ''}${r.open_questions.length ? `  (${r.open_questions.length} pergunta(s) em aberto)` : ''}`);
      } catch (err) { console.error(`  ${red}✗${reset} ${err && err.message ? err.message : err}`); process.exitCode = 1; }
      return;
    }

  }

  return createCommandRegistry([
    { name: 'spec', async handler(argv) { await dispatchSpecProgram('spec', argv); } },
    { name: 'program', async handler(argv) { await dispatchSpecProgram('program', argv); } },
    { name: 'policy', async handler(argv) { await dispatchSpecProgram('policy', argv); } },
    { name: 'prd', async handler(argv) { await dispatchPrdRfc('prd', argv); } },
    { name: 'rfc', async handler(argv) { await dispatchPrdRfc('rfc', argv); } },
  ]);
}

module.exports = { createSpecProgramCommandRegistry };

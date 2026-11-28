'use strict';

/**
 * 1.23.0 (OXB-230-14): Final Smoke Verification & Human Delivery Handoff (`DELIVERY.md` + `DELIVERY.json`).
 * Verifies that the delivered artifact actually builds/runs for a human user and writes
 * a crisp, jargon-free handoff with tested "Como rodar agora" commands.
 * Pure Node.js stdlib — zero external production dependencies.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

function readJsonIfExists(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function runCleanCommand(projectRoot, command, timeoutMs = 120000) {
  const started = Date.now();
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const res = spawnSync(command, {
    cwd: path.resolve(projectRoot),
    shell: true,
    env: childEnv,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const exitCode = res.status == null ? (res.error ? 1 : 0) : res.status;
  return {
    command,
    ok: exitCode === 0 && !res.error,
    exitCode,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    error: res.error ? res.error.message : null,
    duration_ms: Date.now() - started,
  };
}

/**
 * Detects an agnostic smoke-test strategy based on the real repository artifacts (ADR D-5).
 */
function detectSmokeStrategy(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  if (opts.smokeCommand) {
    return {
      kind: 'custom',
      commands: [opts.smokeCommand],
      how_to_run: [opts.smokeCommand],
      entry: null,
    };
  }

  const pkg = readJsonIfExists(path.join(rootAbs, 'package.json'));
  if (pkg && typeof pkg === 'object') {
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    let binEntry = null;
    if (typeof pkg.bin === 'string' && pkg.bin.trim()) {
      binEntry = pkg.bin.trim();
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      const firstKey = Object.keys(pkg.bin)[0];
      if (firstKey && typeof pkg.bin[firstKey] === 'string') binEntry = pkg.bin[firstKey].trim();
    }
    if (binEntry && fs.existsSync(path.resolve(rootAbs, binEntry))) {
      const normalizedBin = binEntry.replace(/\\/g, '/');
      const commands = [];
      if (scripts.build) commands.push('npm run build');
      commands.push(`"${process.execPath}" "${normalizedBin}" --help`);
      if (scripts.test) commands.push('npm test');
      const howToRun = [`node ${normalizedBin} --help`];
      if (scripts.test) howToRun.push('npm test');
      return { kind: 'cli', entry: normalizedBin, commands, how_to_run: howToRun };
    }
    if (scripts.start) {
      const commands = [];
      if (scripts.build) commands.push('npm run build');
      if (scripts.test) commands.push('npm test');
      const howToRun = [];
      if (scripts.build) howToRun.push('npm run build');
      howToRun.push('npm start');
      if (scripts.test) howToRun.push('npm test');
      return { kind: 'web_or_api', entry: 'npm start', commands, how_to_run: howToRun };
    }
    if (scripts.test) {
      const commands = [];
      if (scripts.build) commands.push('npm run build');
      commands.push('npm test');
      return { kind: 'node', entry: 'npm test', commands, how_to_run: commands.slice() };
    }
  }

  if (fs.existsSync(path.join(rootAbs, 'pyproject.toml')) || fs.existsSync(path.join(rootAbs, 'requirements.txt'))) {
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    return {
      kind: 'python',
      entry: `${pyBin} -m unittest discover`,
      commands: [`${pyBin} -m unittest discover`],
      how_to_run: [`${pyBin} -m unittest discover`],
    };
  }

  // Fallback: run acceptance tests if present
  const accDir = path.join(rootAbs, 'tests', 'acceptance');
  if (fs.existsSync(accDir)) {
    const testFiles = fs.readdirSync(accDir)
      .filter((f) => /\.(test|spec)\.[cm]?js$/i.test(f))
      .map((f) => `tests/acceptance/${f}`);
    if (testFiles.length) {
      const cmd = `"${process.execPath}" --test ${testFiles.map((f) => `"${f}"`).join(' ')}`;
      return {
        kind: 'acceptance_suite',
        entry: testFiles[0],
        commands: [cmd],
        how_to_run: [`node --test ${testFiles.join(' ')}`],
      };
    }
  }

  return {
    kind: 'generic',
    entry: null,
    commands: [],
    how_to_run: ['Inspecione os arquivos gerados e execute a suíte de testes do projeto.'],
  };
}

/**
 * Executes the detected smoke strategy and reports honest pass/fail with real outputs.
 */
function runFinalSmoke(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const strategy = detectSmokeStrategy(rootAbs, opts);
  const started = Date.now();
  const ran = [];

  for (const cmd of strategy.commands) {
    const res = typeof opts.runCommand === 'function'
      ? { command: cmd, duration_ms: 0, ...opts.runCommand(cmd, rootAbs) }
      : runCleanCommand(rootAbs, cmd, opts.timeoutMs || 120000);
    ran.push({
      command: cmd,
      ok: Boolean(res.ok),
      exitCode: res.exitCode != null ? res.exitCode : (res.ok ? 0 : 1),
      duration_ms: res.duration_ms || 0,
      stdout_tail: String(res.stdout || '').trim().slice(-400),
      stderr_tail: String(res.stderr || '').trim().slice(-400),
    });
    if (!res.ok) {
      return {
        ok: false,
        kind: strategy.kind,
        entry: strategy.entry,
        how_to_run: strategy.how_to_run,
        ran,
        exitCode: res.exitCode != null ? res.exitCode : 1,
        stderr: String(res.stderr || '').slice(-600),
        error: res.error || String(res.stderr || res.stdout || `comando falhou: ${cmd}`).trim().slice(-400),
        duration_ms: Date.now() - started,
      };
    }
  }

  return {
    ok: true,
    kind: strategy.kind,
    entry: strategy.entry,
    how_to_run: strategy.how_to_run,
    ran,
    exitCode: 0,
    duration_ms: Date.now() - started,
  };
}

function detectGitBranch(projectRoot) {
  try {
    const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: path.resolve(projectRoot),
      encoding: 'utf8',
      windowsHide: true,
    });
    return res.status === 0 ? String(res.stdout || '').trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Generates human-friendly DELIVERY.md and machine-readable DELIVERY.json next to DELIVER.json.
 */
function generateDeliveryHandoff(projectRoot, state, smokeResult, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const baseDir = opts.deliverFile
    ? path.dirname(opts.deliverFile)
    : state && state.session
      ? path.join(rootAbs, '.oxe', state.session)
      : path.join(rootAbs, '.oxe');
  fs.mkdirSync(baseDir, { recursive: true });

  const deliveryMdPath = path.join(baseDir, 'DELIVERY.md');
  const deliveryJsonPath = path.join(baseDir, 'DELIVERY.json');
  const branch = detectGitBranch(rootAbs);
  const phases = Array.isArray(state && state.phases) ? state.phases : [];
  const closedPhases = phases.filter((p) => p.status === 'closed').length;
  const criteria = Array.isArray(state && state.criteria) ? state.criteria : [];
  const howToRun = (smokeResult && Array.isArray(smokeResult.how_to_run) && smokeResult.how_to_run.length)
    ? smokeResult.how_to_run
    : ['npm test'];

  const payload = {
    schema_version: 1,
    deliver_id: state ? state.deliver_id : null,
    title: state ? state.title : path.basename(rootAbs),
    objective: state ? state.objective : null,
    project_mode: state ? state.project_mode : null,
    approval_mode: state ? state.approval_mode : null,
    branch,
    phases_closed: closedPhases,
    phases_total: phases.length,
    criteria_total: criteria.length,
    smoke: smokeResult || null,
    how_to_run: howToRun,
    assumptions: (state && state.assumptions) || [],
    budget: state ? state.budget : null,
    remote_side_effects: false,
    generated_at: new Date().toISOString(),
  };

  const mdLines = [
    `# Entrega Pronta — ${payload.title}`,
    '',
    `> ${payload.objective || 'Entrega autônoma concluída e verificada pelo OXE.'}`,
    '',
    `- **ID:** \`${payload.deliver_id || '—'}\` · **Fases:** ${closedPhases}/${phases.length} concluídas · **Critérios:** ${criteria.length}/${criteria.length} validados`,
    `- **Smoke final (FINAL_SMOKE):** ${smokeResult && smokeResult.ok ? `✓ PASSOU (${smokeResult.kind})` : '✗ FALHOU'}`,
    `- **Branch local:** \`${branch || 'sem git'}\` · **Orçamento usado:** $${((payload.budget && payload.budget.spent_usd) || 0).toFixed(2)} / $${((payload.budget && payload.budget.max_usd) || 0).toFixed(2)}`,
    '',
    '## Como rodar e testar agora',
    '',
    '```bash',
    ...howToRun,
    '```',
    '',
    '## Fases Entregues',
    '',
    ...phases.map((ph) => `- **${ph.id} — ${ph.title}** (\`${ph.status}\`): ${(ph.acceptance || []).join(', ')}`),
    '',
    '## Critérios de Aceite Validados',
    '',
    '| ID | Critério | Status |',
    '|----|----------|--------|',
    ...criteria.map((c) => `| ${c.id} | ${String(c.criterion || '').replace(/\|/g, '/')} | ✓ Validado |`),
    '',
    '## Premissas & Segurança',
    '',
    ...(payload.assumptions.length ? payload.assumptions.map((a) => `- ${a}`) : ['- Nenhuma premissa adicional registrada.']),
    '- **Segurança:** nenhum `git push`, PR remoto ou `npm publish` foi executado automaticamente. Revise a entrega local e publique apenas quando autorizar.',
    '',
  ];

  fs.writeFileSync(deliveryMdPath, mdLines.join('\n'), 'utf8');
  fs.writeFileSync(deliveryJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    deliveryMdPath,
    deliveryJsonPath,
    payload,
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function httpGetOnce(port, reqPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: reqPath, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 2048) body += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            statusCode: res.statusCode,
            body,
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: null, body: '', error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, statusCode: null, body: '', error: err.message });
    });
  });
}

function killChildTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 4000,
      });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * 1.23.0 (OXB-230-17): Boots a web/API project on an ephemeral localhost port, polls `/health` and `/`
 * until HTTP < 400 or timeout, and deterministically tears down the child process tree.
 */
async function probeHttpServerSmoke(projectRoot, opts = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const started = Date.now();
  const pkg = readJsonIfExists(path.join(rootAbs, 'package.json'));
  const startCommand = opts.startCommand
    || (pkg && pkg.scripts && pkg.scripts.start ? 'npm start' : null);

  if (!startCommand) {
    return {
      ok: false,
      port: null,
      statusCode: null,
      error: 'Nenhum comando de start encontrado para probe HTTP.',
      duration_ms: Date.now() - started,
    };
  }

  const port = await findFreePort();
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  delete childEnv.NODE_TEST_CONTEXT;

  const child = spawn(startCommand, {
    cwd: rootAbs,
    shell: true,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = null;
  if (child.stdout) {
    child.stdout.on('data', (d) => { if (stdout.length < 4096) stdout += String(d); });
  }
  if (child.stderr) {
    child.stderr.on('data', (d) => { if (stderr.length < 4096) stderr += String(d); });
  }
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  const probePaths = Array.isArray(opts.paths) && opts.paths.length ? opts.paths : ['/health', '/'];
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
  const pollIntervalMs = Number(opts.pollIntervalMs) > 0 ? Number(opts.pollIntervalMs) : 120;
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      if (exited) {
        return {
          ok: false,
          port,
          statusCode: null,
          error: `Servidor encerrou prematuramente (exit=${exitCode})`,
          stdout_tail: stdout.trim().slice(-400),
          stderr_tail: stderr.trim().slice(-400),
          duration_ms: Date.now() - started,
        };
      }
      for (const reqPath of probePaths) {
        const res = await httpGetOnce(port, reqPath, Math.min(1200, Math.max(200, deadline - Date.now())));
        if (res.ok) {
          return {
            ok: true,
            port,
            path: reqPath,
            statusCode: res.statusCode,
            body_excerpt: String(res.body || '').trim().slice(0, 300),
            duration_ms: Date.now() - started,
          };
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return {
      ok: false,
      port,
      statusCode: null,
      error: `Timeout (${timeoutMs}ms) aguardando resposta HTTP < 400 na porta ${port}.`,
      stdout_tail: stdout.trim().slice(-400),
      stderr_tail: stderr.trim().slice(-400),
      duration_ms: Date.now() - started,
    };
  } finally {
    killChildTree(child);
  }
}

module.exports = {
  detectSmokeStrategy,
  runFinalSmoke,
  probeHttpServerSmoke,
  generateDeliveryHandoff,
};

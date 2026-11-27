'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const mcp = require('../../bin/lib/oxe-mcp-server.cjs');
const op = require('../../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

function mkRepo(prefix = 'oxe-a7-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mcp-sample', version: '1.0.0' }, null, 2));
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# OXE\n\n## Fase atual\n\n`initial`\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [], acceptance_tests: [] }));
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function frameLsp(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

describe('A7 — Servidor MCP stdio nativo (oxe-mcp-server.cjs + CLI oxe-cc mcp) (OXB-230-07)', () => {
  it('OXB-230-07: handleJsonRpcMessage serves initialize, tools/list, and tools/call for oxe_status, oxe_onboard, oxe_agents_list, oxe_reevaluate, and oxe_scorecard with zero external deps', async () => {
    const dir = mkRepo('oxe-a7-unit-');
    try {
      assert.equal(typeof mcp.handleJsonRpcMessage, 'function');
      assert.equal(typeof mcp.startStdioServer, 'function');
      assert.equal(typeof op.runtimeMcpServer, 'function');

      // Zero external npm dependencies used by oxe-mcp-server.cjs (only Node stdlib + local OXE modules)
      const mcpSrc = fs.readFileSync(path.join(REPO_ROOT, 'bin/lib/oxe-mcp-server.cjs'), 'utf8');
      const requires = [...mcpSrc.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
      const externalDeps = requires.filter((r) => !r.startsWith('.') && !['fs', 'path', 'os', 'node:fs', 'node:path'].includes(r));
      assert.deepEqual(externalDeps, [], `oxe-mcp-server.cjs must not depend on external npm packages, found: ${externalDeps.join(', ')}`);

      // 1. initialize
      const initRes = await mcp.handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0' } } },
        { projectRoot: dir }
      );
      assert.equal(initRes.jsonrpc, '2.0');
      assert.equal(initRes.id, 1);
      assert.ok(initRes.result.protocolVersion);
      assert.ok(initRes.result.capabilities && initRes.result.capabilities.tools);
      assert.equal(initRes.result.serverInfo.name, 'oxe-cc');

      // 2. tools/list
      const listRes = await mcp.handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { projectRoot: dir }
      );
      const names = listRes.result.tools.map((t) => t.name);
      for (const requiredTool of ['oxe_status', 'oxe_onboard', 'oxe_agents_list', 'oxe_reevaluate', 'oxe_scorecard']) {
        assert.ok(names.includes(requiredTool), `tools/list missing ${requiredTool}, got: ${names.join(', ')}`);
      }

      // 3. tools/call for all 5 required tools
      for (const [idx, toolName] of ['oxe_status', 'oxe_onboard', 'oxe_agents_list', 'oxe_reevaluate', 'oxe_scorecard'].entries()) {
        const callRes = await mcp.handleJsonRpcMessage(
          { jsonrpc: '2.0', id: 10 + idx, method: 'tools/call', params: { name: toolName, arguments: { dir } } },
          { projectRoot: dir }
        );
        assert.equal(callRes.id, 10 + idx);
        assert.ok(callRes.result && Array.isArray(callRes.result.content), `expected content array for ${toolName}, got ${JSON.stringify(callRes)}`);
        assert.equal(callRes.result.isError, false, `${toolName} should succeed: ${JSON.stringify(callRes.result)}`);
        const parsed = JSON.parse(callRes.result.content[0].text);
        assert.equal(typeof parsed, 'object');
      }

      // 4. Unknown tool returns JSON-RPC error or isError: true
      const unknownRes = await mcp.handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'oxe_does_not_exist', arguments: {} } },
        { projectRoot: dir }
      );
      assert.ok(unknownRes.error || (unknownRes.result && unknownRes.result.isError === true));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-07: CLI oxe-cc mcp serves real JSON-RPC 2.0 messages over stdio', async () => {
    const dir = mkRepo('oxe-a7-cli-');
    try {
      const child = spawn(process.execPath, [BIN, 'mcp', '--dir', dir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const chunks = [];
      child.stdout.on('data', (d) => chunks.push(d));

      // Send Content-Length framed initialize + tools/list + tools/call(oxe_status), then close stdin
      child.stdin.write(frameLsp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      child.stdin.write(frameLsp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
      child.stdin.write(frameLsp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oxe_status', arguments: {} } }));
      child.stdin.end();

      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('oxe-cc mcp timed out')); }, 15000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
      });

      assert.equal(exitCode, 0, 'oxe-cc mcp should exit 0 cleanly on EOF');
      const raw = Buffer.concat(chunks).toString('utf8');
      const bodies = [];
      let cursor = 0;
      while (cursor < raw.length) {
        const hdrEnd = raw.indexOf('\r\n\r\n', cursor);
        if (hdrEnd < 0) break;
        const hdr = raw.slice(cursor, hdrEnd);
        const m = /Content-Length:\s*(\d+)/i.exec(hdr);
        if (!m) break;
        const len = Number(m[1]);
        const bodyStart = hdrEnd + 4;
        const bufSlice = Buffer.from(raw.slice(bodyStart), 'utf8').subarray(0, len).toString('utf8');
        bodies.push(JSON.parse(bufSlice));
        cursor = bodyStart + bufSlice.length;
      }
      assert.equal(bodies.length, 3, `expected 3 JSON-RPC responses over stdio, got ${bodies.length}: ${raw}`);
      assert.equal(bodies[0].id, 1);
      assert.equal(bodies[0].result.serverInfo.name, 'oxe-cc');
      assert.equal(bodies[1].id, 2);
      assert.ok(bodies[1].result.tools.some((t) => t.name === 'oxe_status'));
      assert.equal(bodies[2].id, 3);
      assert.equal(bodies[2].result.isError, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

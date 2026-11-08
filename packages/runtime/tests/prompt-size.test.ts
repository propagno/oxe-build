import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { BUILT_IN_TOOLS } from '../src/executor/built-in-tools';
import { capToolResult, TOOL_RESULT_MAX_CHARS } from '../src/executor/llm-task-executor';
import { ClaudeCliAdapter, fitTranscript } from '../src/executor/adapters/claude-cli';

// 1.21.2 - OXB-148 defect 2: F2-T1's prompt reached 2.29M chars (~1.37M tokens, window 1M) although the task's scope
// was 231 KB: a grep over the repo matched minified bundles in out/ (multi-MB lines) and whole results stayed in the
// conversation re-sent every turn.

describe('OXB-148: tool results and the conversation stay inside the window', () => {
  let ws: string;
  before(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-prompt-size-'));
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'out', 'renderer'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'a.ts'), `export const memory = 1;\n${'x'.repeat(5000)} memory\n`);
    fs.writeFileSync(path.join(ws, 'out', 'renderer', 'monaco.js'), `var a=1;${'y'.repeat(3_000_000)}memory;`);
    fs.writeFileSync(path.join(ws, 'big.txt'), Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'));
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  test('grep skips generated trees (out/) and cuts long lines around the match', async () => {
    const res = await BUILT_IN_TOOLS.grep.execute({ pattern: 'memory' }, ws);
    assert.doesNotMatch(res, /out\/renderer/);
    assert.ok(res.length < 2000, `${res.length} chars`);
    assert.match(res, /src\/a\.ts:2: …x+ memory… \[linha com 5007 chars\]/);
  });

  test('read_file returns a window by default, with how to read the rest', async () => {
    const res = await BUILT_IN_TOOLS.read_file.execute({ path: 'big.txt' }, ws);
    assert.equal(res.split('\n').filter((l) => l.startsWith('line ')).length, 800);
    assert.match(res, /4200 linha\(s\) a mais: use offset\/limit/);
  });

  test('any single tool result is capped; old results are elided before the hard limit', () => {
    const capped = capToolResult('z'.repeat(100_000));
    assert.ok(capped.length < TOOL_RESULT_MAX_CHARS + 200);
    assert.match(capped, /resultado cortado: 100000 chars/);
    const msgs: any[] = [{ role: 'user', content: 'task' }];
    for (let i = 0; i < 20; i += 1) msgs.push({ role: 'tool', tool_call_id: String(i), name: 'read_file', content: 'r'.repeat(40_000) });
    const fitted = fitTranscript(msgs);
    const total = fitted.reduce((n, m) => n + String(m.content).length, 0);
    assert.ok(total <= 600_000, `${total}`);
    assert.equal(String(fitted[fitted.length - 1].content).length, 40_000, "the latest results are kept");
    assert.match(String(fitted[1].content), /resultado antigo omitido/);
  });

  test('a prompt over the hard limit fails fast as `context`, without spawning claude', async () => {
    const marker = path.join(ws, 'spawned.flag');
    const shim = path.join(ws, 'shim.js');
    fs.writeFileSync(shim, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.stdout.write('{}');`);
    const a = new ClaudeCliAdapter({ command: process.execPath, prefixArgs: [shim], parseRetries: 0, maxPromptChars: 50_000 });
    await assert.rejects(a.createCompletion()({ baseUrl: '', apiKey: '', model: '', messages: [{ role: 'user', content: 'q'.repeat(80_000) }], tools: [] } as any), (e: any) => e.kind === 'context' && /prompt_over_limit/.test(e.message));
    assert.ok(!fs.existsSync(marker), 'claude was never called');
  });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const scheduler_1 = require("../src/scheduler/scheduler");
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const inplace_1 = require("../src/workspace/strategies/inplace");
// 1.21.2 · OXB-066 (oxespace 1.5.0, run oxe-run-mw28b0n9-3s0gda, T13): the verify `npx vitest … && npx tsc --noEmit`
// ran as one command; vitest passed 39/39, tsc failed, and the retry only carried vitest's output — 4 attempts,
// US$ 4.54, 0 completed. Each segment now runs alone and the retry carries the failing segment's own output.
const SPEC = { objective: 'segments', criteria: [] };
function graphFor(verifyCommand, retries = 1) {
    const plan = {
        tasks: [{ id: 'T13', title: 'T13', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
        waves: { 1: ['T13'] },
        totalTasks: 1,
    };
    const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
    for (const node of graph.nodes.values())
        node.policy.max_retries = retries;
    return graph;
}
(0, node_test_1.describe)('verify por segmento (OXB-066)', () => {
    (0, node_test_1.test)('splitVerifySegments separa && de topo, respeitando aspas', () => {
        strict_1.default.deepEqual((0, scheduler_1.splitVerifySegments)('npx vitest run a && npx tsc --noEmit'), ['npx vitest run a', 'npx tsc --noEmit']);
        strict_1.default.deepEqual((0, scheduler_1.splitVerifySegments)('node -e "a && b" && echo ok'), ['node -e "a && b"', 'echo ok']);
        strict_1.default.deepEqual((0, scheduler_1.splitVerifySegments)('npm test'), ['npm test']);
    });
    (0, node_test_1.test)('o retry leva o erro do segmento 2 e nada da saída longa do segmento 1; o evento nomeia o segmento', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-seg-'));
        try {
            // Segment 1: passes with 80 lines of output (vitest-like). Segment 2: fails with a short type error (tsc-like).
            const seg1 = `node -e "for (let i = 0; i < 80; i++) console.log('PASS test ' + i)"`;
            const seg2 = `node -e "console.error('src/ThreadView.tsx(12,3): error TS2322: Type string is not assignable to number'); process.exit(2)"`;
            const seen = [];
            const executor = {
                async execute(_n, _l, _r, _a, options) {
                    seen.push(options?.previousError ?? null);
                    return { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' };
                },
            };
            const events = [];
            const ctx = {
                projectRoot: tmp, sessionId: null, runId: `r-seg-${Date.now()}`, executor,
                workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
            };
            await new scheduler_1.Scheduler().run(graphFor(`${seg1} && ${seg2}`), ctx);
            const retryPrompt = String(seen[1]);
            strict_1.default.match(retryPrompt, /Failing segment \[2\/2\]: node -e "console\.error/);
            strict_1.default.match(retryPrompt, /error TS2322/);
            strict_1.default.doesNotMatch(retryPrompt, /PASS test \d/, 'nada da cauda do segmento 1 que passou');
            const completed = events.filter((e) => e.type === 'VerificationCompleted');
            const failed = completed[0].payload.failed_segment;
            strict_1.default.deepEqual([failed.index, failed.total, failed.exit_code], [2, 2, 2]);
            const retry = events.find((e) => e.type === 'RetryScheduled');
            const p = retry?.payload;
            strict_1.default.match(p.output_tail, /TS2322/);
            strict_1.default.doesNotMatch(p.output_tail, /PASS test \d/);
            strict_1.default.match(p.verify_log, /=== \[1\/2\] .* — passed/);
            strict_1.default.match(p.verify_log, /PASS test 79/);
            strict_1.default.match(p.verify_log, /=== \[2\/2\] .* — failed \(exit 2\) ===\n.*TS2322/);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('para no primeiro segmento que falha (o seguinte não roda)', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-seg-'));
        try {
            const marker = path_1.default.join(tmp, 'ran-2');
            const executor = { async execute() { return { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' }; } };
            const ctx = { projectRoot: tmp, sessionId: null, runId: `r-seg2-${Date.now()}`, executor, workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp) };
            await new scheduler_1.Scheduler().run(graphFor(`node -e "process.exit(1)" && node -e "require('fs').writeFileSync('ran-2','x')"`, 0), ctx);
            strict_1.default.equal(fs_1.default.existsSync(marker), false);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('buildVerifyLog: um cabeçalho por segmento', () => {
        const log = (0, scheduler_1.buildVerifyLog)([
            { index: 1, total: 2, command: 'a', status: 'passed', check: { check_id: 'x', acceptance_ref: null, status: 'pass', stdout: 'ok', stderr: '', exit_code: 0, duration_ms: 1, error: null } },
            { index: 2, total: 2, command: 'b', status: 'failed', check: { check_id: 'y', acceptance_ref: null, status: 'fail', stdout: '', stderr: 'boom', exit_code: 1, duration_ms: 1, error: null } },
        ]);
        strict_1.default.equal(log, '=== [1/2] a — passed (exit 0) ===\nok\n\n=== [2/2] b — failed (exit 1) ===\nboom');
    });
});

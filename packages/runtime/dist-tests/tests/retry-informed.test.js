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
// OxeVoice F1: o verify da T1 falhou 3x e cada retry recebeu só "Verification failed: checks did not pass" —
// o executor nunca viu o erro do esbuild. 1.20c: retry informado + régua suspeita.
const SPEC = { objective: 'retry', criteria: [] };
function graphFor(verifyCommand) {
    const plan = {
        tasks: [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
        waves: { 1: ['T1'] },
        totalTasks: 1,
    };
    return (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
}
function setup(verifyCommand) {
    const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-retry-'));
    const seen = [];
    const executor = {
        async execute(_node, _lease, _runId, _attempt, options) {
            seen.push(options?.previousError ?? null);
            return { success: true, failure_class: null, evidence: [], output: 'ok' };
        },
    };
    const events = [];
    const ctx = {
        projectRoot: tmp, sessionId: null, runId: `r-retry-${Date.now()}`, executor,
        workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
    };
    return { tmp, seen, events, ctx };
}
(0, node_test_1.describe)('retry informado e régua suspeita (1.20c)', () => {
    (0, node_test_1.test)('o retry recebe comando, motivo e saída; falha idêntica para na 2ª tentativa', async () => {
        const { tmp, seen, events, ctx } = setup('node -e "console.error(\'X [ERROR] Must use outdir\'); process.exit(1)"');
        try {
            const graph = graphFor('node -e "console.error(\'X [ERROR] Must use outdir\'); process.exit(1)"');
            for (const node of graph.nodes.values())
                node.policy.max_retries = 3;
            const result = await new scheduler_1.Scheduler().run(graph, ctx);
            strict_1.default.equal(result.status, 'failed');
            strict_1.default.equal(seen.length, 2, 'parou na 2ª tentativa idêntica, sem pagar a 3ª e a 4ª');
            strict_1.default.equal(seen[0], null);
            strict_1.default.match(String(seen[1]), /Command: node -e/);
            strict_1.default.match(String(seen[1]), /Must use outdir/);
            strict_1.default.match(String(seen[1]), /If you are certain the command itself is wrong/);
            const suspect = events.find((e) => e.type === 'VerifyCommandSuspect');
            strict_1.default.ok(suspect, 'VerifyCommandSuspect emitido');
            const blocked = events.find((e) => e.type === 'WorkItemBlocked');
            strict_1.default.equal((blocked?.payload).failure_class, 'verify_suspect');
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('falhas diferentes continuam tentando até o limite', async () => {
        const cmd = 'node -e "const f=require(\'fs\');const n=f.existsSync(\'c\')?+f.readFileSync(\'c\',\'utf8\'):0;f.writeFileSync(\'c\',String(n+1));console.error(\'falha \'+n);process.exit(1)"';
        const { tmp, seen, events, ctx } = setup(cmd);
        try {
            const graph = graphFor(cmd);
            for (const node of graph.nodes.values())
                node.policy.max_retries = 2;
            await new scheduler_1.Scheduler().run(graph, ctx);
            strict_1.default.equal(seen.length, 3);
            strict_1.default.ok(!events.some((e) => e.type === 'VerifyCommandSuspect'));
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('assinatura ignora tempos, timestamps, hashes e caminhos temporários', () => {
        const a = (0, scheduler_1.verifyFailureSignature)({ check_id: 'x', acceptance_ref: null, status: 'fail', stdout: 'done in 12ms at 2026-11-01T02:00:00Z abcdef1234', stderr: 'C:\\Temp\\x1\\f.js failed', exit_code: 1, duration_ms: 1, error: null });
        const b = (0, scheduler_1.verifyFailureSignature)({ check_id: 'x', acceptance_ref: null, status: 'fail', stdout: 'done in 340ms at 2026-11-01T05:10:00Z 99887766aa', stderr: 'C:\\Temp\\y9\\f.js failed', exit_code: 1, duration_ms: 1, error: null });
        strict_1.default.equal(a, b);
        strict_1.default.match((0, scheduler_1.describeVerifyFailure)('npm test', undefined, ['x']), /Reason: x/);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OXE_CI_CHECKS = exports.runtimeEvidenceIntegrityCheck = exports.securityBaselineCheck = exports.policyCheck = exports.verifyAcceptanceCheck = exports.planConsistencyCheck = void 0;
exports.runCIChecks = runCIChecks;
exports.summarizeCIResults = summarizeCIResults;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Check: plan-consistency ─────────────────────────────────────────────────
exports.planConsistencyCheck = {
    name: 'oxe-plan-consistency',
    description: 'Verifies ACTIVE-RUN.json exists and has a compiled ExecutionGraph',
    async run(ctx) {
        const activeRunPath = ctx.sessionId
            ? path_1.default.join(ctx.projectRoot, '.oxe', ctx.sessionId, 'execution', 'ACTIVE-RUN.json')
            : path_1.default.join(ctx.projectRoot, '.oxe', 'ACTIVE-RUN.json');
        if (!fs_1.default.existsSync(activeRunPath)) {
            return { check: this.name, status: 'skip', message: 'No ACTIVE-RUN.json found' };
        }
        try {
            const raw = JSON.parse(fs_1.default.readFileSync(activeRunPath, 'utf8'));
            const hasGraph = raw.compiled_graph && typeof raw.compiled_graph === 'object';
            const hasRunId = typeof raw.run_id === 'string';
            if (!hasRunId) {
                return { check: this.name, status: 'fail', message: 'ACTIVE-RUN.json missing run_id', details: raw };
            }
            if (!hasGraph) {
                return { check: this.name, status: 'fail', message: 'No compiled ExecutionGraph found in ACTIVE-RUN.json', details: { run_id: raw.run_id } };
            }
            return { check: this.name, status: 'pass', message: `Run ${String(raw.run_id)} has compiled graph` };
        }
        catch (err) {
            return { check: this.name, status: 'error', message: `Failed to parse ACTIVE-RUN.json: ${String(err)}` };
        }
    },
};
// ─── Check: verify-acceptance ────────────────────────────────────────────────
exports.verifyAcceptanceCheck = {
    name: 'oxe-verify-acceptance',
    description: 'Checks that VERIFY.md exists and contains no failed criteria',
    async run(ctx) {
        const verifyPath = ctx.sessionId
            ? path_1.default.join(ctx.projectRoot, '.oxe', ctx.sessionId, 'verification', 'VERIFY.md')
            : path_1.default.join(ctx.projectRoot, '.oxe', 'VERIFY.md');
        if (!fs_1.default.existsSync(verifyPath)) {
            return { check: this.name, status: 'skip', message: 'No VERIFY.md found — run /oxe-verify first' };
        }
        const content = fs_1.default.readFileSync(verifyPath, 'utf8');
        const failLines = content.split('\n').filter((l) => l.includes('✗ FAIL'));
        const passLines = content.split('\n').filter((l) => l.includes('✓ PASS'));
        if (failLines.length > 0) {
            return {
                check: this.name,
                status: 'fail',
                message: `${failLines.length} acceptance criteria failed`,
                details: { failed: failLines, passed: passLines.length },
            };
        }
        if (passLines.length === 0) {
            return { check: this.name, status: 'skip', message: 'VERIFY.md has no pass/fail markers' };
        }
        return { check: this.name, status: 'pass', message: `${passLines.length} acceptance criteria passed` };
    },
};
// ─── Check: policy ───────────────────────────────────────────────────────────
exports.policyCheck = {
    name: 'oxe-policy',
    description: 'Checks that no gates are pending (unresolved human approval)',
    async run(ctx) {
        const gatesPath = ctx.sessionId
            ? path_1.default.join(ctx.projectRoot, '.oxe', ctx.sessionId, 'execution', 'GATES.json')
            : path_1.default.join(ctx.projectRoot, '.oxe', 'execution', 'GATES.json');
        if (!fs_1.default.existsSync(gatesPath)) {
            return { check: this.name, status: 'pass', message: 'No pending gates' };
        }
        try {
            const gates = JSON.parse(fs_1.default.readFileSync(gatesPath, 'utf8'));
            const pending = gates.filter((g) => g.status === 'pending');
            if (pending.length > 0) {
                return {
                    check: this.name,
                    status: 'fail',
                    message: `${pending.length} unresolved gate(s)`,
                    details: pending.map((g) => ({ gate_id: g.gate_id, scope: g.scope })),
                };
            }
            return { check: this.name, status: 'pass', message: 'All gates resolved' };
        }
        catch (err) {
            return { check: this.name, status: 'error', message: `Failed to read GATES.json: ${String(err)}` };
        }
    },
};
// ─── Check: security-baseline ────────────────────────────────────────────────
const SECRET_PATTERNS = [
    /(?:password|passwd|secret|api[_-]?key|auth[_-]?token)\s*[:=]\s*['"]?\S{8,}/i,
    /(?:AKIA|ASIA)[A-Z0-9]{16}/,
    /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/,
];
exports.securityBaselineCheck = {
    name: 'oxe-security-baseline',
    description: 'Scans evidence artifacts for common secret patterns',
    async run(ctx) {
        if (!ctx.evidenceStore || !ctx.runId) {
            return { check: this.name, status: 'skip', message: 'No evidence store or run ID provided' };
        }
        const evidenceDir = path_1.default.join(ctx.projectRoot, '.oxe', 'evidence', 'runs', ctx.runId);
        if (!fs_1.default.existsSync(evidenceDir)) {
            return { check: this.name, status: 'skip', message: 'No evidence found for this run' };
        }
        const findings = [];
        walkDir(evidenceDir, (filePath) => {
            if (filePath.endsWith('.json') || filePath.endsWith('.patch') || filePath.endsWith('.txt')) {
                try {
                    const content = fs_1.default.readFileSync(filePath, 'utf8');
                    for (const pattern of SECRET_PATTERNS) {
                        if (pattern.test(content)) {
                            findings.push(`${path_1.default.basename(filePath)}: matches pattern ${pattern.source.slice(0, 40)}`);
                            break;
                        }
                    }
                }
                catch { /* skip unreadable */ }
            }
        });
        if (findings.length > 0) {
            return { check: this.name, status: 'fail', message: `Secret patterns detected in ${findings.length} evidence file(s)`, details: findings };
        }
        return { check: this.name, status: 'pass', message: 'No secret patterns detected in evidence' };
    },
};
// ─── Check: runtime-evidence-integrity ───────────────────────────────────────
exports.runtimeEvidenceIntegrityCheck = {
    name: 'oxe-runtime-evidence-integrity',
    description: 'Validates that all evidence index files are valid JSON and files exist on disk',
    async run(ctx) {
        if (!ctx.runId) {
            return { check: this.name, status: 'skip', message: 'No run ID provided' };
        }
        const runEvidenceDir = path_1.default.join(ctx.projectRoot, '.oxe', 'evidence', 'runs', ctx.runId);
        if (!fs_1.default.existsSync(runEvidenceDir)) {
            return { check: this.name, status: 'skip', message: 'No evidence directory for this run' };
        }
        const errors = [];
        let indexCount = 0;
        let evidenceCount = 0;
        walkDir(runEvidenceDir, (filePath) => {
            if (path_1.default.basename(filePath) !== 'index.json')
                return;
            indexCount++;
            try {
                const items = JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
                for (const item of items) {
                    evidenceCount++;
                    const absPath = path_1.default.join(ctx.projectRoot, item.path);
                    if (!fs_1.default.existsSync(absPath)) {
                        errors.push(`Missing file for ${item.evidence_id}: ${item.path}`);
                    }
                }
            }
            catch (err) {
                errors.push(`Corrupt index at ${filePath}: ${String(err)}`);
            }
        });
        if (errors.length > 0) {
            return { check: this.name, status: 'fail', message: `${errors.length} integrity error(s)`, details: errors };
        }
        return {
            check: this.name,
            status: indexCount === 0 ? 'skip' : 'pass',
            message: `${evidenceCount} evidence artifact(s) across ${indexCount} index(es) — all valid`,
        };
    },
};
// ─── Suite ───────────────────────────────────────────────────────────────────
exports.OXE_CI_CHECKS = [
    exports.planConsistencyCheck,
    exports.verifyAcceptanceCheck,
    exports.policyCheck,
    exports.securityBaselineCheck,
    exports.runtimeEvidenceIntegrityCheck,
];
async function runCIChecks(ctx, checks = exports.OXE_CI_CHECKS) {
    const results = [];
    for (const check of checks) {
        results.push(await check.run(ctx));
    }
    return results;
}
function summarizeCIResults(results) {
    const counts = { total: results.length, pass: 0, fail: 0, skip: 0, error: 0 };
    for (const r of results)
        counts[r.status]++;
    return { ...counts, allPassed: counts.fail === 0 && counts.error === 0 };
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function walkDir(dir, visitor) {
    if (!fs_1.default.existsSync(dir))
        return;
    for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const full = path_1.default.join(dir, entry.name);
        if (entry.isDirectory())
            walkDir(full, visitor);
        else
            visitor(full);
    }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionEngine = void 0;
exports.appendDecision = appendDecision;
exports.loadDecisionLog = loadDecisionLog;
exports.queryDecisions = queryDecisions;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function computeSeniority(confidence) {
    if (confidence >= 0.9)
        return 'expert';
    if (confidence >= 0.75)
        return 'senior';
    if (confidence >= 0.5)
        return 'standard';
    return 'junior';
}
class DecisionEngine {
    evaluate(input) {
        const signals = [];
        let type = 'proceed';
        let confidence = 0.8;
        let rationale = '';
        if (!input.policy_allowed) {
            signals.push('policy_denied');
            type = 'abort';
            confidence = 1.0;
            rationale = 'Policy denied execution — aborting without retry.';
        }
        else {
            signals.push('policy_allowed');
            if (input.gate_pending && !input.gate_approved) {
                signals.push('gate_pending');
                type = 'escalate_gate';
                confidence = 0.95;
                rationale = 'Human gate pending — escalating for approval before proceeding.';
            }
            else {
                if (input.gate_approved)
                    signals.push('gate_approved');
                if (input.risk_level === 'high' || input.risk_level === 'critical') {
                    signals.push('risk_high');
                    confidence = Math.max(0.4, confidence - 0.3);
                    rationale += 'High residual risk detected. ';
                }
                if (input.retry_count >= input.max_retries) {
                    signals.push('retry_budget_exhausted');
                    type = 'abort';
                    confidence = 0.9;
                    rationale += `Retry budget exhausted (${input.retry_count}/${input.max_retries}).`;
                }
                else if (input.retry_count > 0) {
                    signals.push('retry_budget_available');
                    type = 'retry';
                    confidence = 0.7;
                    rationale += `Retrying (attempt ${input.retry_count + 1}/${input.max_retries + 1}).`;
                }
                else {
                    if (input.evidence_count > 0) {
                        signals.push('evidence_sufficient');
                        confidence = Math.min(1.0, confidence + 0.1);
                    }
                    else {
                        signals.push('evidence_missing');
                        confidence = Math.max(0.3, confidence - 0.2);
                    }
                    if (input.lesson_match) {
                        signals.push('lesson_match');
                        type = 'promote_lesson';
                        confidence = Math.min(1.0, confidence + 0.05);
                    }
                    if (!rationale)
                        rationale = 'All signals green — proceeding with execution.';
                }
            }
        }
        return {
            decision_id: `dec-${crypto_1.default.randomBytes(4).toString('hex')}`,
            work_item_id: input.work_item_id ?? null,
            run_id: input.run_id,
            type,
            seniority: computeSeniority(confidence),
            confidence: Math.round(confidence * 100) / 100,
            signals,
            rationale: rationale.trim(),
            timestamp: new Date().toISOString(),
            ...(input.memo !== undefined ? { memo: input.memo } : {}),
        };
    }
}
exports.DecisionEngine = DecisionEngine;
function appendDecision(projectRoot, runId, record) {
    const p = logPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    const log = loadDecisionLog(projectRoot, runId) ?? { run_id: runId, decisions: [] };
    log.decisions.push(record);
    fs_1.default.writeFileSync(p, JSON.stringify(log, null, 2), 'utf8');
}
function loadDecisionLog(projectRoot, runId) {
    const p = logPath(projectRoot, runId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function queryDecisions(log, filter) {
    return log.decisions.filter((d) => {
        if (filter.type && d.type !== filter.type)
            return false;
        if (filter.workItemId && d.work_item_id !== filter.workItemId)
            return false;
        if (filter.minConfidence !== undefined && d.confidence < filter.minConfidence)
            return false;
        return true;
    });
}
function logPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'decisions.json');
}

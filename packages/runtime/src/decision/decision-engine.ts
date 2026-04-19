import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { DecisionMemo } from './decision-memo';

export type DecisionType =
  | 'proceed'
  | 'retry'
  | 'escalate_gate'
  | 'skip'
  | 'abort'
  | 'promote_lesson';

export type DecisionSignal =
  | 'policy_allowed'
  | 'policy_denied'
  | 'gate_pending'
  | 'gate_approved'
  | 'evidence_sufficient'
  | 'evidence_missing'
  | 'retry_budget_available'
  | 'retry_budget_exhausted'
  | 'lesson_match'
  | 'risk_high';

export type SeniorityLevel = 'junior' | 'standard' | 'senior' | 'expert';

export interface DecisionRecord {
  decision_id: string;
  work_item_id: string | null;
  run_id: string;
  type: DecisionType;
  seniority: SeniorityLevel;
  confidence: number;
  signals: DecisionSignal[];
  rationale: string;
  timestamp: string;
  memo?: DecisionMemo;
}

export interface DecisionLog {
  run_id: string;
  decisions: DecisionRecord[];
}

export interface DecisionInput {
  work_item_id?: string;
  run_id: string;
  policy_allowed: boolean;
  gate_pending: boolean;
  gate_approved: boolean;
  retry_count: number;
  max_retries: number;
  evidence_count: number;
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
  lesson_match: boolean;
  memo?: DecisionMemo;
}

function computeSeniority(confidence: number): SeniorityLevel {
  if (confidence >= 0.9) return 'expert';
  if (confidence >= 0.75) return 'senior';
  if (confidence >= 0.5) return 'standard';
  return 'junior';
}

export class DecisionEngine {
  evaluate(input: DecisionInput): DecisionRecord {
    const signals: DecisionSignal[] = [];
    let type: DecisionType = 'proceed';
    let confidence = 0.8;
    let rationale = '';

    if (!input.policy_allowed) {
      signals.push('policy_denied');
      type = 'abort';
      confidence = 1.0;
      rationale = 'Policy denied execution — aborting without retry.';
    } else {
      signals.push('policy_allowed');

      if (input.gate_pending && !input.gate_approved) {
        signals.push('gate_pending');
        type = 'escalate_gate';
        confidence = 0.95;
        rationale = 'Human gate pending — escalating for approval before proceeding.';
      } else {
        if (input.gate_approved) signals.push('gate_approved');

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
        } else if (input.retry_count > 0) {
          signals.push('retry_budget_available');
          type = 'retry';
          confidence = 0.7;
          rationale += `Retrying (attempt ${input.retry_count + 1}/${input.max_retries + 1}).`;
        } else {
          if (input.evidence_count > 0) {
            signals.push('evidence_sufficient');
            confidence = Math.min(1.0, confidence + 0.1);
          } else {
            signals.push('evidence_missing');
            confidence = Math.max(0.3, confidence - 0.2);
          }

          if (input.lesson_match) {
            signals.push('lesson_match');
            type = 'promote_lesson';
            confidence = Math.min(1.0, confidence + 0.05);
          }

          if (!rationale) rationale = 'All signals green — proceeding with execution.';
        }
      }
    }

    return {
      decision_id: `dec-${crypto.randomBytes(4).toString('hex')}`,
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

export function appendDecision(projectRoot: string, runId: string, record: DecisionRecord): void {
  const p = logPath(projectRoot, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const log = loadDecisionLog(projectRoot, runId) ?? { run_id: runId, decisions: [] };
  log.decisions.push(record);
  fs.writeFileSync(p, JSON.stringify(log, null, 2), 'utf8');
}

export function loadDecisionLog(projectRoot: string, runId: string): DecisionLog | null {
  const p = logPath(projectRoot, runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as DecisionLog;
  } catch {
    return null;
  }
}

export function queryDecisions(
  log: DecisionLog,
  filter: { type?: DecisionType; workItemId?: string; minConfidence?: number }
): DecisionRecord[] {
  return log.decisions.filter((d) => {
    if (filter.type && d.type !== filter.type) return false;
    if (filter.workItemId && d.work_item_id !== filter.workItemId) return false;
    if (filter.minConfidence !== undefined && d.confidence < filter.minConfidence) return false;
    return true;
  });
}

function logPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'decisions.json');
}

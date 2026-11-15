"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const claude_cli_1 = require("../src/executor/adapters/claude-cli");
// OxeSpace 15/11 (OxeChat F3 T7): a refusal by the model's usage policy was read as env and retried with the same
// prompt. It is `policy`: no automatic retry.
(0, node_test_1.describe)('cliFailure: refusal by the usage policy', () => {
    (0, node_test_1.test)('safeguards flagged / [reasoning_extraction] is policy, not env', () => {
        const e = (0, claude_cli_1.cliFailure)({ code: 1, stdout: '', stderr: '', envelope: { subtype: 'success', is_error: true, result: "API Error: Opus 5.5's safeguards flagged this message … Details: [reasoning_extraction]", total_cost_usd: 5.02 } });
        strict_1.default.equal(e.kind, 'policy');
        strict_1.default.equal(e.costUsd, 5.02);
        strict_1.default.match(e.message, /kind=policy/);
    });
    (0, node_test_1.test)('quota, context and a plain error keep their kinds', () => {
        strict_1.default.equal((0, claude_cli_1.cliFailure)({ code: 1, stdout: '', stderr: '', envelope: { result: 'prompt is too long: 250000 tokens' } }).kind, 'context');
        strict_1.default.equal((0, claude_cli_1.cliFailure)({ code: 1, stdout: '', stderr: 'spawn ENOENT', envelope: null }).kind, 'env');
    });
});

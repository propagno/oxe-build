"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitWorktreeManager = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
class GitWorktreeManager {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.isolation_level = 'isolated';
        this.leases = new Map();
    }
    async allocate(req) {
        const wsId = `ws-${req.work_item_id}-a${req.attempt_number}`;
        const branch = `oxe/${req.work_item_id}-attempt${req.attempt_number}`;
        const worktreePath = path_1.default.join(this.projectRoot, '.oxe', 'workspaces', wsId);
        const baseCommit = this.git(['rev-parse', 'HEAD']).trim();
        fs_1.default.mkdirSync(path_1.default.dirname(worktreePath), { recursive: true });
        // Create worktree on a new branch starting from HEAD
        this.git(['worktree', 'add', worktreePath, '-b', branch]);
        const lease = {
            workspace_id: wsId,
            strategy: 'git_worktree',
            isolation_level: this.isolation_level,
            branch,
            base_commit: baseCommit,
            root_path: worktreePath,
            ttl_minutes: 45,
        };
        this.leases.set(wsId, lease);
        return lease;
    }
    async snapshot(id) {
        const lease = this.leases.get(id);
        if (!lease || !lease.root_path)
            throw new Error(`Workspace ${id} not found`);
        const commit = this.git(['rev-parse', 'HEAD'], lease.root_path).trim();
        return {
            snapshot_id: `snap-${crypto_1.default.randomBytes(4).toString('hex')}`,
            workspace_id: id,
            commit,
            created_at: new Date().toISOString(),
        };
    }
    async reset(id, snapRef) {
        const lease = this.leases.get(id);
        if (!lease)
            return;
        this.git(['reset', '--hard', snapRef.commit], lease.root_path);
    }
    async dispose(id) {
        const lease = this.leases.get(id);
        if (!lease)
            return;
        try {
            this.git(['worktree', 'remove', lease.root_path, '--force']);
        }
        catch {
            // worktree may already be gone
        }
        try {
            if (lease.branch)
                this.git(['branch', '-D', lease.branch]);
        }
        catch {
            // branch may already be deleted
        }
        this.leases.delete(id);
    }
    git(args, cwd) {
        return (0, child_process_1.execFileSync)('git', args, {
            cwd: cwd ?? this.projectRoot,
            encoding: 'utf8',
        });
    }
}
exports.GitWorktreeManager = GitWorktreeManager;

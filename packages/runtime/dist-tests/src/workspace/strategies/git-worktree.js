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
        const suffix = crypto_1.default.randomBytes(4).toString('hex');
        const safeWorkItem = String(req.work_item_id).replace(/[^A-Za-z0-9._-]/g, '-');
        const wsId = `ws-${safeWorkItem}-a${req.attempt_number}-${suffix}`;
        const branch = `oxe/${safeWorkItem}-attempt${req.attempt_number}-${suffix}`;
        const worktreePath = path_1.default.join(this.projectRoot, '.oxe', 'workspaces', wsId);
        const baseCommit = this.git(['rev-parse', 'HEAD'], undefined, 'git_worktree requires a git repository with at least one base commit').trim();
        fs_1.default.mkdirSync(path_1.default.dirname(worktreePath), { recursive: true });
        // Create worktree on a new branch starting from HEAD
        this.git(['worktree', 'add', worktreePath, '-b', branch], undefined, 'failed to create git_worktree workspace');
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
    git(args, cwd, message) {
        try {
            return (0, child_process_1.execFileSync)('git', args, {
                cwd: cwd ?? this.projectRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`${message || 'git command failed'}: git ${args.join(' ')} (${detail})`);
        }
    }
}
exports.GitWorktreeManager = GitWorktreeManager;

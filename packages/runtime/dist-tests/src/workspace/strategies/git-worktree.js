"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitWorktreeManager = void 0;
exports.unlinkExternalLinks = unlinkExternalLinks;
exports.sweepStaleWorkspaces = sweepStaleWorkspaces;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
function isInside(root, target) {
    const rel = path_1.default.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path_1.default.isAbsolute(rel));
}
/**
 * Removes (without following) every symlink/junction under `root` whose target is outside `root`. Walks real
 * directories only (lstat), skips `.git`, and is bounded so a large installed node_modules cannot stall dispose.
 * @returns the links removed (absolute paths)
 */
function unlinkExternalLinks(root, limits = {}) {
    const maxDepth = limits.maxDepth ?? 5;
    const maxEntries = limits.maxEntries ?? 50000;
    const removed = [];
    const realRoot = (() => { try {
        return fs_1.default.realpathSync(root);
    }
    catch {
        return path_1.default.resolve(root);
    } })();
    let seen = 0;
    const walk = (dir, depth) => {
        if (depth > maxDepth || seen > maxEntries)
            return;
        let entries = [];
        try {
            entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            seen += 1;
            if (seen > maxEntries)
                return;
            if (entry.name === '.git')
                continue;
            const full = path_1.default.join(dir, entry.name);
            let stat;
            try {
                stat = fs_1.default.lstatSync(full);
            }
            catch {
                continue;
            }
            if (stat.isSymbolicLink()) {
                let target = '';
                try {
                    target = path_1.default.resolve(path_1.default.dirname(full), fs_1.default.readlinkSync(full));
                }
                catch {
                    target = '';
                }
                if (!target || !(isInside(realRoot, target) || isInside(path_1.default.resolve(root), target))) {
                    try {
                        fs_1.default.unlinkSync(full);
                    }
                    catch {
                        try {
                            fs_1.default.rmdirSync(full);
                        }
                        catch {
                            continue;
                        } // a Windows directory junction
                    }
                    removed.push(full);
                }
                continue;
            }
            if (stat.isDirectory())
                walk(full, depth + 1);
        }
    };
    walk(root, 0);
    return removed;
}
/**
 * OXB-050: leftover worktrees of a crashed or aborted run (`.oxe/workspaces/ws-*`). Each one has its external links
 * (node_modules junction, workspace links) removed FIRST, then `git worktree remove --force`, then `worktree prune`.
 * A forced remove with the junction still in place deletes the real node_modules — never in this order.
 * @returns the workspace directories removed
 */
function sweepStaleWorkspaces(projectRoot, options = {}) {
    const root = path_1.default.join(projectRoot, '.oxe', 'workspaces');
    const removed = [];
    let entries = [];
    try {
        entries = fs_1.default.readdirSync(root);
    }
    catch {
        return removed;
    }
    for (const name of entries) {
        if (!name.startsWith('ws-') || options.keep?.has(name))
            continue;
        const dir = path_1.default.join(root, name);
        unlinkExternalLinks(dir);
        try {
            (0, child_process_1.execFileSync)('git', ['worktree', 'remove', dir, '--force'], { cwd: projectRoot, stdio: 'ignore', windowsHide: true });
        }
        catch {
            // not a registered worktree (half-created): its links are already gone, remove the plain directory
            try {
                fs_1.default.rmSync(dir, { recursive: true, force: true });
            }
            catch {
                continue;
            }
        }
        removed.push(dir);
    }
    try {
        (0, child_process_1.execFileSync)('git', ['worktree', 'prune'], { cwd: projectRoot, stdio: 'ignore', windowsHide: true });
    }
    catch { /* best effort */ }
    return removed;
}
class GitWorktreeManager {
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot;
        this.options = options;
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
        if (this.options.prepare) {
            try {
                await this.options.prepare(worktreePath, lease);
            }
            catch (err) {
                await this.dispose(wsId);
                throw err;
            }
        }
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
        // A forced worktree remove follows links: a node_modules junction or a workspace link (@scope/pkg → the main
        // repo's packages/) took the REAL directory with it. Links that leave the worktree are unlinked first, never
        // followed, so only the worktree's own files are removed.
        if (lease.root_path)
            unlinkExternalLinks(lease.root_path);
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

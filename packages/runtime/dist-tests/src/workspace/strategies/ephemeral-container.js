"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EphemeralContainerManager = void 0;
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const git_worktree_1 = require("./git-worktree");
function isDockerAvailable() {
    const result = (0, child_process_1.spawnSync)('docker', ['version', '--format', '{{.Server.Version}}'], {
        encoding: 'utf8',
        timeout: 5000,
    });
    return result.status === 0;
}
class EphemeralContainerManager {
    constructor(projectRoot, opts = { image: 'node:20-alpine', mountPath: '/workspace', fallback: true }) {
        this.projectRoot = projectRoot;
        this.opts = opts;
        this.containerIds = new Map();
        this.useFallback = false;
        this.fallbackManager = new git_worktree_1.GitWorktreeManager(projectRoot);
        if (!isDockerAvailable()) {
            if (opts.fallback !== false) {
                this.useFallback = true;
            }
            else {
                throw new Error('Docker is not available and fallback is disabled');
            }
        }
    }
    get isolation_level() {
        return this.useFallback ? this.fallbackManager.isolation_level : 'isolated';
    }
    get usingFallback() { return this.useFallback; }
    async allocate(req) {
        if (this.useFallback)
            return this.fallbackManager.allocate(req);
        const wsId = `ws-container-${req.work_item_id}-a${req.attempt_number}`;
        const envArgs = Object.entries(this.opts.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const result = (0, child_process_1.spawnSync)('docker', [
            'run', '-d',
            '-v', `${this.projectRoot}:${this.opts.mountPath}`,
            '-w', this.opts.mountPath,
            ...envArgs,
            this.opts.image,
            'sleep', '3600',
        ], { encoding: 'utf8' });
        if (result.status !== 0) {
            if (this.opts.fallback !== false) {
                this.useFallback = true;
                return this.fallbackManager.allocate(req);
            }
            throw new Error(`docker run failed: ${result.stderr}`);
        }
        const containerId = result.stdout.trim().slice(0, 12);
        this.containerIds.set(wsId, containerId);
        return {
            workspace_id: wsId,
            strategy: 'ephemeral_container',
            isolation_level: this.isolation_level,
            branch: null,
            base_commit: null,
            root_path: `docker:${containerId}:${this.opts.mountPath}`,
            ttl_minutes: 60,
        };
    }
    async snapshot(id) {
        if (this.useFallback)
            return this.fallbackManager.snapshot(id);
        const containerId = this.containerIds.get(id);
        if (!containerId)
            throw new Error(`Container for workspace ${id} not found`);
        const tag = `oxe-snap-${crypto_1.default.randomBytes(4).toString('hex')}`;
        (0, child_process_1.execFileSync)('docker', ['commit', containerId, tag]);
        return {
            snapshot_id: tag,
            workspace_id: id,
            commit: tag,
            created_at: new Date().toISOString(),
        };
    }
    async reset(id, snapRef) {
        if (this.useFallback)
            return this.fallbackManager.reset(id, snapRef);
        const containerId = this.containerIds.get(id);
        if (!containerId)
            return;
        // Stop current container and start from snapshot
        (0, child_process_1.spawnSync)('docker', ['stop', containerId]);
        (0, child_process_1.spawnSync)('docker', ['rm', containerId]);
        const result = (0, child_process_1.spawnSync)('docker', [
            'run', '-d',
            '-v', `${this.projectRoot}:${this.opts.mountPath}`,
            snapRef.commit,
            'sleep', '3600',
        ], { encoding: 'utf8' });
        const newId = result.stdout.trim().slice(0, 12);
        this.containerIds.set(id, newId);
    }
    async dispose(id) {
        if (this.useFallback)
            return this.fallbackManager.dispose(id);
        const containerId = this.containerIds.get(id);
        if (!containerId)
            return;
        (0, child_process_1.spawnSync)('docker', ['stop', containerId], { encoding: 'utf8' });
        (0, child_process_1.spawnSync)('docker', ['rm', containerId], { encoding: 'utf8' });
        this.containerIds.delete(id);
    }
}
exports.EphemeralContainerManager = EphemeralContainerManager;

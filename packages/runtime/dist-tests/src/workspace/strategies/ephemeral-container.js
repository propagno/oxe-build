"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EphemeralContainerManager = void 0;
exports.buildDockerRunArgs = buildDockerRunArgs;
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const git_worktree_1 = require("./git-worktree");
/** Build hardened `docker run` arguments with network isolation, control-plane read-only mounts, and resource caps. */
function buildDockerRunArgs(projectRoot, opts) {
    const envArgs = Object.entries(opts.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const networkArgs = ['--network', opts.networkMode || 'none'];
    const resourceArgs = [
        ...(opts.memoryLimit ? ['--memory', opts.memoryLimit] : []),
        ...(opts.cpus ? ['--cpus', opts.cpus] : []),
    ];
    const roMounts = [];
    if (opts.readOnlyControlPlane !== false) {
        for (const rel of ['.oxe', '.github/workflows']) {
            const abs = path_1.default.join(projectRoot, rel);
            if (fs_1.default.existsSync(abs)) {
                roMounts.push('-v', `${abs}:${opts.mountPath.replace(/\/+$/, '')}/${rel}:ro`);
            }
        }
    }
    return [
        'run', '-d', '--rm',
        ...networkArgs,
        ...resourceArgs,
        '-v', `${projectRoot}:${opts.mountPath}`,
        ...roMounts,
        '-w', opts.mountPath,
        ...envArgs,
        opts.image,
        'sleep', '3600',
    ];
}
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
        const safeWorkItem = String(req.work_item_id).replace(/[^A-Za-z0-9._-]/g, '-');
        const suffix = crypto_1.default.randomBytes(3).toString('hex');
        const wsId = `ws-container-${safeWorkItem}-a${req.attempt_number}-${suffix}`;
        const dockerArgs = buildDockerRunArgs(this.projectRoot, this.opts);
        const result = (0, child_process_1.spawnSync)('docker', dockerArgs, { encoding: 'utf8', windowsHide: true });
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

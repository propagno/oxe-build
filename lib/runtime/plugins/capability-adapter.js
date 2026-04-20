"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCapabilityPlugin = createCapabilityPlugin;
exports.loadCapabilityPlugins = loadCapabilityPlugins;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const plugin_manifest_1 = require("./plugin-manifest");
function parseFrontmatter(text) {
    const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    const out = {};
    for (const line of match[1].split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const idx = trimmed.indexOf(':');
        if (idx === -1)
            continue;
        out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return out;
}
function parseArrayField(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '[]')
        return [];
    if (/^\[.*\]$/.test(raw)) {
        return raw
            .slice(1, -1)
            .split(',')
            .map((item) => item.trim().replace(/^['"`]|['"`]$/g, ''))
            .filter(Boolean);
    }
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
}
function loadCapabilityManifests(projectRoot) {
    const capabilitiesDir = path_1.default.join(projectRoot, '.oxe', 'capabilities');
    if (!fs_1.default.existsSync(capabilitiesDir))
        return [];
    return fs_1.default
        .readdirSync(capabilitiesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
        const dir = path_1.default.join(capabilitiesDir, entry.name);
        const manifestPath = path_1.default.join(dir, 'CAPABILITY.md');
        if (!fs_1.default.existsSync(manifestPath))
            return null;
        const raw = fs_1.default.readFileSync(manifestPath, 'utf8');
        const fm = parseFrontmatter(raw);
        const id = String(fm.id || '').trim();
        if (!id)
            return null;
        return {
            id,
            entrypoint: String(fm.entrypoint || '').trim() || null,
            sideEffects: parseArrayField(fm.side_effects),
            evidenceOutputs: parseArrayField(fm.evidence_outputs),
            checkTypes: parseArrayField(fm.check_types || fm.supports_checks),
            dir,
        };
    })
        .filter((item) => Boolean(item));
}
function resolveEntrypoint(projectRoot, manifest) {
    if (!manifest.entrypoint)
        return null;
    if (path_1.default.isAbsolute(manifest.entrypoint))
        return manifest.entrypoint;
    const capabilityRelative = path_1.default.join(manifest.dir, manifest.entrypoint);
    if (fs_1.default.existsSync(capabilityRelative))
        return capabilityRelative;
    const projectRelative = path_1.default.join(projectRoot, manifest.entrypoint);
    if (fs_1.default.existsSync(projectRelative))
        return projectRelative;
    return capabilityRelative;
}
function resolveEvidencePaths(projectRoot, manifest) {
    return manifest.evidenceOutputs
        .map((entry) => {
        const capabilityRelative = path_1.default.join(manifest.dir, entry);
        if (fs_1.default.existsSync(capabilityRelative))
            return path_1.default.relative(projectRoot, capabilityRelative);
        const projectRelative = path_1.default.join(projectRoot, entry);
        if (fs_1.default.existsSync(projectRelative))
            return path_1.default.relative(projectRoot, projectRelative);
        return path_1.default.relative(projectRoot, projectRelative);
    })
        .map((entry) => entry.replace(/\\/g, '/'));
}
function inferToolKind(sideEffects) {
    if (sideEffects.some((effect) => /db|infra|network|external/i.test(effect)))
        return 'external_operation';
    if (sideEffects.some((effect) => /write|mutat|git/i.test(effect)))
        return 'mutation';
    if (sideEffects.some((effect) => /verify|test|evidence/i.test(effect)))
        return 'verification';
    if (sideEffects.some((effect) => /analysis|scan|read/i.test(effect)))
        return 'analysis';
    return 'read';
}
function buildToolProvider(projectRoot, manifest) {
    return {
        name: manifest.id,
        kind: inferToolKind(manifest.sideEffects),
        idempotent: !manifest.sideEffects.some((effect) => /write|mutat|git|db|infra/i.test(effect)),
        supports(actionType) {
            return actionType === manifest.id || actionType === `capability:${manifest.id}`;
        },
        async invoke(input) {
            const entrypoint = resolveEntrypoint(projectRoot, manifest);
            if (!entrypoint) {
                return {
                    success: false,
                    output: '',
                    evidence_paths: [],
                    side_effects_applied: [],
                    error: `Capability ${manifest.id} does not declare an entrypoint`,
                };
            }
            const ext = path_1.default.extname(entrypoint).toLowerCase();
            const env = {
                ...process.env,
                OXE_CAPABILITY_INPUT: JSON.stringify(input.params || {}),
                OXE_CAPABILITY_RUN_ID: input.run_id,
                OXE_CAPABILITY_WORK_ITEM_ID: input.work_item_id,
                OXE_CAPABILITY_ATTEMPT_ID: input.attempt_id,
                OXE_CAPABILITY_WORKSPACE_ROOT: input.workspace_root,
            };
            let program = entrypoint;
            let args = [];
            if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
                program = process.execPath;
                args = [entrypoint];
            }
            else if (ext === '.ps1') {
                program = 'powershell';
                args = ['-File', entrypoint];
            }
            const result = (0, child_process_1.spawnSync)(program, args, {
                cwd: projectRoot,
                encoding: 'utf8',
                env,
            });
            return {
                success: result.status === 0 && !result.error,
                output: [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n').trim(),
                evidence_paths: resolveEvidencePaths(projectRoot, manifest),
                side_effects_applied: manifest.sideEffects,
                error: result.error ? String(result.error) : result.status === 0 ? undefined : (result.stderr || result.stdout || `Capability exited with status ${result.status}`),
            };
        },
    };
}
function buildVerifierProvider(projectRoot, manifest) {
    if (!manifest.checkTypes.length)
        return null;
    return {
        name: `${manifest.id}-verifier`,
        supports(checkType) {
            return manifest.checkTypes.includes(checkType);
        },
        async execute(input) {
            const tool = await buildToolProvider(projectRoot, manifest).invoke({
                action_type: `verify:${input.check_type}`,
                work_item_id: input.work_item_id,
                run_id: input.work_item_id,
                attempt_id: `${input.work_item_id}-verify`,
                params: {
                    check_id: input.check_id,
                    check_type: input.check_type,
                    command: input.command,
                    evidence_dir: input.evidence_dir,
                },
                workspace_root: input.workspace_root,
            });
            return {
                verification_id: `vr-${manifest.id}-${input.check_id}`,
                work_item_id: input.work_item_id,
                check_id: input.check_id,
                status: tool.success ? 'pass' : 'fail',
                evidence_refs: tool.evidence_paths,
                summary: tool.error || tool.output || null,
            };
        },
    };
}
function createCapabilityPlugin(projectRoot, manifest) {
    const verifierProvider = buildVerifierProvider(projectRoot, manifest);
    return {
        name: `capability:${manifest.id}`,
        version: '0.0.0',
        abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
        toolProviders: [buildToolProvider(projectRoot, manifest)],
        verifierProviders: verifierProvider ? [verifierProvider] : [],
    };
}
function loadCapabilityPlugins(projectRoot) {
    return loadCapabilityManifests(projectRoot).map((manifest) => createCapabilityPlugin(projectRoot, manifest));
}

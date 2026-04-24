import type { OxePlugin } from './plugin-abi';
interface CapabilityManifest {
    id: string;
    entrypoint: string | null;
    sideEffects: string[];
    evidenceOutputs: string[];
    checkTypes: string[];
    dir: string;
    timeoutMs: number;
    preInvokeHook: string | null;
    postInvokeHook: string | null;
}
export declare function runCapabilityAsync(program: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number, onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}>;
export declare function createCapabilityPlugin(projectRoot: string, manifest: CapabilityManifest): OxePlugin;
export declare function loadCapabilityPlugins(projectRoot: string): OxePlugin[];
export {};

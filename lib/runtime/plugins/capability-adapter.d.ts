import type { OxePlugin } from './plugin-abi';
interface CapabilityManifest {
    id: string;
    entrypoint: string | null;
    sideEffects: string[];
    evidenceOutputs: string[];
    checkTypes: string[];
    dir: string;
}
export declare function createCapabilityPlugin(projectRoot: string, manifest: CapabilityManifest): OxePlugin;
export declare function loadCapabilityPlugins(projectRoot: string): OxePlugin[];
export {};

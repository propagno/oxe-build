import type { OxePlugin } from './plugin-abi';
export declare const CURRENT_ABI_VERSION = "1.0.0";
export interface PluginManifest {
    name: string;
    version: string;
    abi_version: string;
    capabilities: Array<'tool' | 'workspace' | 'verifier' | 'context' | 'hooks'>;
    tool_action_types?: string[];
    workspace_strategies?: string[];
    verifier_check_types?: string[];
    context_provider_names?: string[];
    hook_names?: string[];
}
export interface PluginValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export declare function extractManifest(plugin: OxePlugin): PluginManifest;
export declare function validatePlugin(plugin: OxePlugin): PluginValidationResult;
export declare function isAbiCompatible(pluginAbiVersion: string): boolean;
export declare function sandboxInvoke<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T>;

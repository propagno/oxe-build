import type { OxePlugin, ToolProvider, WorkspaceProvider, VerifierProvider, ContextProvider } from './plugin-abi';
import { type CapabilityMatrix } from './capability-matrix';
export declare class PluginRegistry {
    private plugins;
    private loadErrors;
    register(plugin: OxePlugin): void;
    unregister(name: string): void;
    loadFromDirectory(dir: string): string[];
    toolProviderFor(actionType: string): ToolProvider | null;
    workspaceProviderFor(strategy: string): WorkspaceProvider | null;
    verifierProviderFor(checkType: string): VerifierProvider | null;
    contextProviderFor(name: string): ContextProvider | null;
    allContextProviders(): ContextProvider[];
    allToolProviders(): ToolProvider[];
    runHook(hookName: string, ctx: Record<string, unknown>): Promise<void>;
    list(): Array<{
        name: string;
        version?: string;
        providers: string[];
    }>;
    registerProjectCapabilities(projectRoot: string): string[];
    loadErrorsSnapshot(): string[];
    clearLoadErrors(): void;
    snapshot(): Array<{
        name: string;
        version?: string;
        abi_version?: string;
        toolProviders: Array<{
            name: string;
            kind: string;
            idempotent: boolean;
        }>;
        workspaceProviders: Array<{
            name: string;
        }>;
        verifierProviders: Array<{
            name: string;
        }>;
        contextProviders: Array<{
            name: string;
        }>;
    }>;
    summary(): {
        total_plugins: number;
        tool_providers: number;
        workspace_providers: number;
        verifier_providers: number;
        context_providers: number;
        load_errors: number;
        pluginsCount: number;
        toolProviders: number;
        workspaceProviders: number;
        verifierProviders: number;
        contextProviders: number;
        loadErrors: number;
        plugins: Array<{
            name: string;
            version?: string;
            providers: string[];
        }>;
    };
    capabilityMatrix(): CapabilityMatrix;
}
export declare function globalRegistry(): PluginRegistry;
export declare function resetGlobalRegistry(): void;
export declare function registrySummary(registry: PluginRegistry): ReturnType<PluginRegistry['summary']>;
export declare function resolveCapabilityMatrix(registry: PluginRegistry): CapabilityMatrix;

import type { OxePlugin, ToolProvider, WorkspaceProvider, VerifierProvider, ContextProvider } from './plugin-abi';
export declare class PluginRegistry {
    private plugins;
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
}
export declare function globalRegistry(): PluginRegistry;
export declare function resetGlobalRegistry(): void;

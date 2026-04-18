export interface PRDraftOptions {
    title: string;
    body: string;
    base?: string;
    head?: string;
    draft?: boolean;
}
export interface PRInfo {
    number: number;
    title: string;
    url: string;
    state: string;
    draft: boolean;
    head: string;
    base: string;
}
export interface PRResult {
    success: boolean;
    url?: string;
    error?: string;
    pr?: PRInfo;
}
export declare class PRManager {
    private readonly projectRoot;
    constructor(projectRoot: string);
    isAvailable(): boolean;
    createDraft(opts: PRDraftOptions): PRResult;
    view(prNumberOrUrl: string | number): PRResult;
    mergePR(prNumber: number, method?: 'merge' | 'squash' | 'rebase'): PRResult;
}

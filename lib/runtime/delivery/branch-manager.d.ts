export interface BranchInfo {
    name: string;
    current: boolean;
    commit: string;
}
export declare class BranchManager {
    private readonly projectRoot;
    constructor(projectRoot: string);
    currentBranch(): string;
    currentCommit(): string;
    createSessionBranch(sessionId: string): string;
    createOxeBranch(name: string, base?: string): string;
    switchTo(branchName: string): void;
    deleteBranch(name: string, force?: boolean): void;
    listOxeBranches(): BranchInfo[];
    mergeWorktreeBranch(worktreeBranch: string, targetBranch: string): void;
    branchExists(name: string): boolean;
    push(remote: string, branchName: string, setUpstream?: boolean): void;
    private git;
}

export * from './workspace-manager';
export { InplaceWorkspaceManager } from './strategies/inplace';
export { GitWorktreeManager, sweepStaleWorkspaces, unlinkExternalLinks } from './strategies/git-worktree';
export type { GitWorktreeOptions } from './strategies/git-worktree';
export { EphemeralContainerManager } from './strategies/ephemeral-container';
export type { ContainerOptions } from './strategies/ephemeral-container';

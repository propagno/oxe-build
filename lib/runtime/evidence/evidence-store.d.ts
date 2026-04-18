import type { Evidence, EvidenceType } from '../models/evidence';
export interface EvidenceCollectOptions {
    work_item_id: string;
    run_id: string;
    attempt_number: number;
}
export interface EvidenceContent {
    evidence: Evidence;
    content: Buffer;
}
export declare class EvidenceStore {
    private readonly projectRoot;
    constructor(projectRoot: string);
    private evidenceDir;
    private indexPath;
    private readIndex;
    private writeIndex;
    collect(type: EvidenceType, content: Buffer | string, opts: EvidenceCollectOptions): Promise<Evidence>;
    list(opts: EvidenceCollectOptions): Promise<Evidence[]>;
    get(evidenceId: string, opts: EvidenceCollectOptions): Promise<EvidenceContent | null>;
    listByRun(runId: string): Promise<Evidence[]>;
}

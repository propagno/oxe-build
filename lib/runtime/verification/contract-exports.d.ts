/**
 * Static export surface of JS/TS modules (1.19). A contracted symbol from the IMPLEMENTATION-PACK
 * must be exported by its file, otherwise the next phase consumes an interface that does not exist.
 * Regex/brace scanning only — no parser dependency — so it errs towards finding exports, and files
 * in other languages are reported as unsupported rather than failed.
 */
export interface ExportedSymbol {
    name: string;
    /** `(a, b)` for functions, `class` for classes, null when unknown. */
    signature: string | null;
}
export interface ExpectedExport {
    file: string;
    name: string;
}
export interface ExportCheckOutcome {
    missing: ExpectedExport[];
    /** Files whose language is not scanned (warning, never a failure). */
    unsupported: string[];
}
export declare function isScannableModule(file: string): boolean;
export declare function extractExports(source: string): ExportedSymbol[];
export declare function readModuleExports(absPath: string): ExportedSymbol[] | null;
export declare function checkExpectedExports(cwd: string, expected: ExpectedExport[]): ExportCheckOutcome;

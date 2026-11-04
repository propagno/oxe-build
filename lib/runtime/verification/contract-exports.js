"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScannableModule = isScannableModule;
exports.extractExports = extractExports;
exports.readModuleExports = readModuleExports;
exports.checkExpectedExports = checkExpectedExports;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const JS_TS_RE = /\.(c|m)?[jt]sx?$/i;
function isScannableModule(file) {
    return JS_TS_RE.test(file);
}
/** Strip comments and string contents so braces/commas inside them do not confuse the scanner. */
function stripNoise(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
        .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}
function balancedBlock(text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{' || ch === '(' || ch === '[')
            depth++;
        else if (ch === '}' || ch === ')' || ch === ']') {
            depth--;
            if (depth === 0)
                return text.slice(openIndex + 1, i);
        }
    }
    return null;
}
function splitTopLevel(body) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
        if (ch === '{' || ch === '(' || ch === '[')
            depth++;
        else if (ch === '}' || ch === ')' || ch === ']')
            depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current.trim())
        parts.push(current);
    return parts.map((p) => p.trim()).filter(Boolean);
}
function compactParams(params) {
    return `(${params.replace(/\s+/g, ' ').trim()})`;
}
/** Signature of a locally declared function/class/arrow named `name`, if declared in `text`. */
function localSignature(text, name) {
    const esc = name.replace(/[$]/g, '\\$');
    const fn = new RegExp(`(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*${esc}\\s*\\(`).exec(text);
    if (fn) {
        const params = balancedBlock(text, fn.index + fn[0].length - 1);
        return params === null ? null : compactParams(params);
    }
    if (new RegExp(`(?:^|[^\\w$.])class\\s+${esc}\\b`).test(text))
        return 'class';
    const arrow = new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${esc}\\s*=\\s*(?:async\\s*)?\\(`).exec(text);
    if (arrow) {
        const params = balancedBlock(text, arrow.index + arrow[0].length - 1);
        return params === null ? null : compactParams(params);
    }
    return null;
}
function extractExports(source) {
    const text = stripNoise(source);
    const found = new Map();
    const add = (name, signature) => {
        if (!name || !/^[A-Za-z_$][\w$]*$/.test(name))
            return;
        if (!found.has(name) || (found.get(name) === null && signature !== null))
            found.set(name, signature);
    };
    // CommonJS: module.exports = { a, b: x, c() {} } | = function name() | = name
    for (const m of text.matchAll(/module\.exports\s*=\s*/g)) {
        const rest = text.slice(m.index + m[0].length);
        if (rest.startsWith('{')) {
            const body = balancedBlock(rest, 0);
            if (body === null)
                continue;
            for (const part of splitTopLevel(body)) {
                if (part.startsWith('...'))
                    continue;
                const method = /^(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(part);
                if (method && !part.includes(':')) {
                    const params = balancedBlock(part, part.indexOf('('));
                    add(method[1], params === null ? null : compactParams(params));
                    continue;
                }
                const keyed = /^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]*))?$/.exec(part);
                if (!keyed)
                    continue;
                const valueIdent = keyed[2] ? /^([A-Za-z_$][\w$]*)\s*$/.exec(keyed[2].trim()) : null;
                const inline = keyed[2] ? /^(?:async\s+)?(?:function\b[^(]*)?\(/.exec(keyed[2].trim()) : null;
                let signature = null;
                if (inline) {
                    const value = keyed[2].trim();
                    const params = balancedBlock(value, value.indexOf('('));
                    signature = params === null ? null : compactParams(params);
                }
                else {
                    signature = localSignature(text, valueIdent ? valueIdent[1] : keyed[1]);
                }
                add(keyed[1], signature);
            }
        }
        else {
            const named = /^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*;?)/.exec(rest);
            const name = named ? named[1] || named[2] || named[3] : null;
            add('default', name ? localSignature(text, name) : null);
            if (name)
                add(name, localSignature(text, name));
        }
    }
    for (const m of text.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
        const value = m[2].trim();
        const ident = /^([A-Za-z_$][\w$]*)$/.exec(value);
        let signature = ident ? localSignature(text, ident[1]) : null;
        if (!signature && /^(?:async\s+)?(?:function\b[^(]*)?\(/.test(value)) {
            const params = balancedBlock(value, value.indexOf('('));
            signature = params === null ? null : compactParams(params);
        }
        add(m[1], signature);
    }
    // ESM / TS
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g)) {
        const params = balancedBlock(text, m.index + m[0].length - 1);
        add(m[1], params === null ? null : compactParams(params));
    }
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g))
        add(m[1], 'class');
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g))
        add(m[1], localSignature(text, m[1]));
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g))
        add(m[1], null);
    for (const m of text.matchAll(/export\s+default\s+(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)?|class\s+([A-Za-z_$][\w$]*)?)?/g)) {
        add('default', null);
        if (m[1])
            add(m[1], localSignature(text, m[1]));
        if (m[2])
            add(m[2], 'class');
    }
    for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
        for (const part of m[1].split(',')) {
            const spec = part.trim().replace(/^type\s+/, '');
            if (!spec)
                continue;
            const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(spec);
            if (alias)
                add(alias[2] || alias[1], localSignature(text, alias[1]));
        }
    }
    return [...found.entries()].map(([name, signature]) => ({ name, signature }));
}
function readModuleExports(absPath) {
    if (!isScannableModule(absPath))
        return null;
    try {
        const stat = fs_1.default.statSync(absPath);
        if (!stat.isFile() || stat.size > 1024 * 1024)
            return null;
        return extractExports(fs_1.default.readFileSync(absPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function checkExpectedExports(cwd, expected) {
    const missing = [];
    const unsupported = new Set();
    const cache = new Map();
    for (const entry of expected) {
        if (!isScannableModule(entry.file)) {
            unsupported.add(entry.file);
            continue;
        }
        if (!cache.has(entry.file)) {
            const exports = readModuleExports(path_1.default.resolve(cwd, entry.file));
            cache.set(entry.file, exports ? new Set(exports.map((e) => e.name)) : null);
        }
        const names = cache.get(entry.file);
        if (!names || !names.has(entry.name))
            missing.push(entry);
    }
    return { missing, unsupported: [...unsupported] };
}

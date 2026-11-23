/**
 * Reader for Dark Reader's community site-fix file (vendor/darkreader/dynamic-theme-fixes.config).
 * Format: blocks separated by "=====" lines. Each block starts with URL patterns, followed by
 * commands (INVERT, CSS, IGNORE INLINE STYLE, IGNORE IMAGE ANALYSIS, IGNORE CSS URL) and their values.
 */
import {matchScore, parsePattern} from './match';

export interface DynamicFix {
    url: string[];
    invert: string[];
    css: string;
    ignoreInlineStyle: string[];
    ignoreImageAnalysis: string[];
    ignoreCSSUrl: string[];
    disableStyleSheetsProxy: boolean;
    disableCustomElementRegistryProxy: boolean;
}

const COMMANDS: Record<string, keyof DynamicFix> = {
    'INVERT': 'invert',
    'CSS': 'css',
    'IGNORE INLINE STYLE': 'ignoreInlineStyle',
    'IGNORE IMAGE ANALYSIS': 'ignoreImageAnalysis',
    'IGNORE CSS URL': 'ignoreCSSUrl',
};

export function emptyFix(url: string[] = ['*']): DynamicFix {
    return {
        url, invert: [], css: '', ignoreInlineStyle: [], ignoreImageAnalysis: [], ignoreCSSUrl: [],
        disableStyleSheetsProxy: false, disableCustomElementRegistryProxy: false,
    };
}

function lines(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

interface Block {
    url: string[];
    commands: Map<string, string>;
}

function parseBlocks(text: string): Block[] {
    const out: Block[] = [];
    for (const block of text.replace(/\r/g, '').split(/^\s*={2,}\s*$/m)) {
        const ls = block.split('\n');
        const cmdIdx: number[] = [];
        ls.forEach((l, i) => {
            if (/^[A-Z]+(\s[A-Z]+){0,2}$/.test(l)) {
                cmdIdx.push(i);
            }
        });
        if (cmdIdx.length === 0) {
            continue;
        }
        const commands = new Map<string, string>();
        cmdIdx.forEach((ci, k) => {
            commands.set(ls[ci].trim(), ls.slice(ci + 1, k === cmdIdx.length - 1 ? ls.length : cmdIdx[k + 1]).join('\n'));
        });
        out.push({url: lines(ls.slice(0, cmdIdx[0]).join('\n')), commands});
    }
    return out;
}

export function parseFixes(text: string): DynamicFix[] {
    return parseBlocks(text).map(({url, commands}) => {
        const fix = emptyFix(url);
        for (const [cmd, value] of commands) {
            const prop = COMMANDS[cmd];
            if (prop === 'css') {
                fix.css = value.trim();
            } else if (prop) {
                (fix as any)[prop] = lines(value);
            }
        }
        return fix;
    });
}

/** Filter-mode fixes (vendor/darkreader/inversion-fixes.config). Shaped like DynamicFix so the same index works. */
export interface InversionFix extends DynamicFix {
    noinvert: string[];
    removebg: string[];
}

export function parseInversionFixes(text: string): InversionFix[] {
    return parseBlocks(text).map(({url, commands}) => ({
        ...emptyFix(url),
        invert: lines(commands.get('INVERT') ?? ''),
        noinvert: lines(commands.get('NO INVERT') ?? ''),
        removebg: lines(commands.get('REMOVE BG') ?? ''),
        css: (commands.get('CSS') ?? '').trim(),
    }));
}

export interface FixIndex {
    generic: DynamicFix | null;
    byHost: Map<string, Array<{fix: DynamicFix; pattern: string}>>;
}

export function indexFixes(fixes: DynamicFix[]): FixIndex {
    const index: FixIndex = {generic: null, byHost: new Map()};
    for (const fix of fixes) {
        for (const pattern of fix.url) {
            if (pattern === '*') {
                index.generic = fix;
                continue;
            }
            const {host} = parsePattern(pattern);
            if (!host) {
                continue;
            }
            const list = index.byHost.get(host) ?? [];
            list.push({fix, pattern});
            index.byHost.set(host, list);
        }
    }
    return index;
}

/** The most specific site fix for a URL (no generic fix), or null. */
export function siteFixFor(index: FixIndex, url: string): DynamicFix | null {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
    let best: DynamicFix | null = null;
    let bestScore = -1;
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
        const candidates = index.byHost.get(labels.slice(i).join('.'));
        for (const {fix, pattern} of candidates ?? []) {
            const score = matchScore(url, pattern);
            if (score > bestScore) {
                bestScore = score;
                best = fix;
            }
        }
    }
    return best;
}

export function combineFixes(fixes: Array<DynamicFix | null | undefined>): DynamicFix {
    const list = fixes.filter(Boolean) as DynamicFix[];
    const out = emptyFix(list.flatMap((f) => f.url));
    for (const f of list) {
        out.invert.push(...f.invert);
        out.ignoreInlineStyle.push(...f.ignoreInlineStyle);
        out.ignoreImageAnalysis.push(...f.ignoreImageAnalysis);
        out.ignoreCSSUrl.push(...f.ignoreCSSUrl);
        if (f.css) {
            out.css = out.css ? `${out.css}\n${f.css}` : f.css;
        }
        out.disableStyleSheetsProxy ||= f.disableStyleSheetsProxy;
        out.disableCustomElementRegistryProxy ||= f.disableCustomElementRegistryProxy;
    }
    return out;
}

/** Dark Reader's list of sites that are already dark. One pattern per line. */
export function parseDarkSites(text: string): string[] {
    return lines(text).filter((l) => !l.startsWith('#'));
}

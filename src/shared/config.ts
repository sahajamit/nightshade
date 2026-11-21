import {matchScore, normalisePattern} from './match';
import {
    CONTRAST_FLOORS, FIX_ACTIONS, MODES, PALETTE_KEYS, UNLISTED,
    type Config, type Fix, type GlobalSettings, type Look, type Palette, type Resolved, type SiteRule,
} from './types';

export const DEFAULT_PALETTES: Record<string, Palette> = {
    default: {
        bg: '#181a1b', surface: '#202324', text: '#e8e6e3', muted: '#a8a095',
        link: '#7fb5ff', border: '#3b4043', icon: '#c9c4ba', selection: '#004daa',
    },
    lamplight: {
        bg: '#1b1d21', surface: '#24272c', text: '#ece6dc', muted: '#a59f94',
        link: '#8fb5d9', border: '#393e45', icon: '#cfc9bf', selection: '#4a3b22',
    },
    midnight: {
        bg: '#0f1115', surface: '#171a20', text: '#dfe3ea', muted: '#8f98a6',
        link: '#7aa7ff', border: '#2a2f38', icon: '#c3cad5', selection: '#27406b',
    },
};

export const DEFAULT_GLOBAL: GlobalSettings = {
    enabled: true,
    mode: 'dynamic',
    unlisted: 'skip-already-dark',
    palette: 'default',
    useBuiltInFixes: true,
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0,
    contrastFloor: 3,
    iconRescue: true,
    imageDim: 100,
    fontFamily: '',
    textStroke: 0,
};

/**
 * Sites where a full-page invert works better than recolouring (same list Dark Reader
 * ships as its filter-mode defaults).
 */
export const DEFAULT_SITES: SiteRule[] = [
    {match: ['docs.google.com'], mode: 'filter', note: 'Canvas-rendered editor; recolouring cannot reach it.'},
    {match: ['*.officeapps.live.com', '*.sharepoint.com', 'onedrive.live.com'], mode: 'filter', note: 'Office web apps.'},
];

export function defaultConfig(): Config {
    return {
        version: 1,
        updatedAt: new Date(0).toISOString(),
        global: {...DEFAULT_GLOBAL},
        palettes: structuredClone(DEFAULT_PALETTES),
        sites: structuredClone(DEFAULT_SITES),
    };
}

// ---------------------------------------------------------------------------
// Validation. Used by the extension (UI and bridge input) and by the CLI, so a
// hand-edited or agent-edited file can never put the extension in a bad state.
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
    constructor(public problems: string[]) {
        super(problems.join('\n'));
    }
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isColour(v: unknown): v is string {
    return typeof v === 'string' && HEX.test(v.trim());
}

function num(v: unknown, min: number, max: number, path: string, problems: string[]): number | undefined {
    if (v === undefined) {
        return undefined;
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
        problems.push(`${path} must be a number from ${min} to ${max} (got ${JSON.stringify(v)})`);
        return undefined;
    }
    return v;
}

function validateLook(src: any, path: string, problems: string[], palettes: Record<string, Palette>): Look {
    const out: Look = {};
    const set = <K extends keyof Look>(k: K, v: Look[K] | undefined) => {
        if (v !== undefined) {
            out[k] = v;
        }
    };
    set('brightness', num(src.brightness, 50, 150, `${path}.brightness`, problems));
    set('contrast', num(src.contrast, 50, 150, `${path}.contrast`, problems));
    set('sepia', num(src.sepia, 0, 100, `${path}.sepia`, problems));
    set('grayscale', num(src.grayscale, 0, 100, `${path}.grayscale`, problems));
    set('imageDim', num(src.imageDim, 50, 100, `${path}.imageDim`, problems));
    set('textStroke', num(src.textStroke, 0, 1, `${path}.textStroke`, problems));
    if (src.contrastFloor !== undefined) {
        if (CONTRAST_FLOORS.includes(src.contrastFloor)) {
            out.contrastFloor = src.contrastFloor;
        } else {
            problems.push(`${path}.contrastFloor must be one of ${CONTRAST_FLOORS.join(', ')}`);
        }
    }
    if (src.iconRescue !== undefined) {
        if (typeof src.iconRescue === 'boolean') {
            out.iconRescue = src.iconRescue;
        } else {
            problems.push(`${path}.iconRescue must be true or false`);
        }
    }
    if (src.palette !== undefined) {
        if (typeof src.palette === 'string' && palettes[src.palette]) {
            out.palette = src.palette;
        } else {
            problems.push(`${path}.palette "${src.palette}" is not defined in palettes`);
        }
    }
    if (src.fontFamily !== undefined) {
        if (typeof src.fontFamily === 'string' && !/[{};<>]/.test(src.fontFamily)) {
            out.fontFamily = src.fontFamily;
        } else {
            problems.push(`${path}.fontFamily must be a plain font name`);
        }
    }
    if (src.css !== undefined) {
        if (typeof src.css === 'string' && !/<\/style/i.test(src.css)) {
            out.css = src.css;
        } else {
            problems.push(`${path}.css must be CSS text`);
        }
    }
    return out;
}

function validateFix(src: any, path: string, problems: string[]): Fix | null {
    if (!src || typeof src !== 'object') {
        problems.push(`${path} must be an object`);
        return null;
    }
    if (typeof src.selector !== 'string' || !src.selector.trim() || /[{}]/.test(src.selector)) {
        problems.push(`${path}.selector must be a CSS selector without braces`);
        return null;
    }
    if (!FIX_ACTIONS.includes(src.action)) {
        problems.push(`${path}.action must be one of ${FIX_ACTIONS.join(', ')}`);
        return null;
    }
    const fix: Fix = {selector: src.selector.trim(), action: src.action};
    if (src.colour !== undefined) {
        if (!isColour(src.colour)) {
            problems.push(`${path}.colour must be a hex colour like #e9a08f`);
            return null;
        }
        fix.colour = src.colour;
    }
    if (fix.action === 'set-colour' && !fix.colour) {
        problems.push(`${path}: set-colour needs a colour`);
        return null;
    }
    if (typeof src.note === 'string') {
        fix.note = src.note;
    }
    return fix;
}

/** Validates and normalises any input. Throws ConfigError listing every problem. */
export function validateConfig(input: unknown): Config {
    const problems: string[] = [];
    const src: any = input && typeof input === 'object' ? input : {};
    if (!input || typeof input !== 'object') {
        problems.push('config must be a JSON object');
    }

    const palettes: Record<string, Palette> = {...structuredClone(DEFAULT_PALETTES)};
    if (src.palettes !== undefined) {
        if (typeof src.palettes !== 'object' || Array.isArray(src.palettes)) {
            problems.push('palettes must be an object of name → palette');
        } else {
            for (const [name, p] of Object.entries<any>(src.palettes)) {
                if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
                    problems.push(`palette name "${name}" must be lowercase letters, digits and dashes`);
                    continue;
                }
                const base = palettes[name] ?? DEFAULT_PALETTES.default;
                const pal = {...base};
                for (const k of PALETTE_KEYS) {
                    if (p?.[k] !== undefined) {
                        if (isColour(p[k])) {
                            pal[k] = p[k];
                        } else {
                            problems.push(`palettes.${name}.${k} must be a hex colour`);
                        }
                    }
                }
                palettes[name] = pal;
            }
        }
    }

    const g: any = src.global ?? {};
    const global: GlobalSettings = {...DEFAULT_GLOBAL, ...validateLook(g, 'global', problems, palettes)} as GlobalSettings;
    if (g.enabled !== undefined) {
        if (typeof g.enabled === 'boolean') {
            global.enabled = g.enabled;
        } else {
            problems.push('global.enabled must be true or false');
        }
    }
    if (g.mode !== undefined) {
        if (['dynamic', 'filter', 'bespoke'].includes(g.mode)) {
            global.mode = g.mode;
        } else {
            problems.push('global.mode must be dynamic, filter or bespoke');
        }
    }
    if (g.unlisted !== undefined) {
        if (UNLISTED.includes(g.unlisted)) {
            global.unlisted = g.unlisted;
        } else {
            problems.push(`global.unlisted must be one of ${UNLISTED.join(', ')}`);
        }
    }
    if (g.useBuiltInFixes !== undefined) {
        if (typeof g.useBuiltInFixes === 'boolean') {
            global.useBuiltInFixes = g.useBuiltInFixes;
        } else {
            problems.push('global.useBuiltInFixes must be true or false');
        }
    }
    delete (global as any).css;

    const sites: SiteRule[] = [];
    if (src.sites !== undefined && !Array.isArray(src.sites)) {
        problems.push('sites must be an array');
    }
    const seen = new Map<string, number>();
    (Array.isArray(src.sites) ? src.sites : []).forEach((s: any, i: number) => {
        const path = `sites[${i}]`;
        if (!s || typeof s !== 'object') {
            problems.push(`${path} must be an object`);
            return;
        }
        const match = (Array.isArray(s.match) ? s.match : typeof s.match === 'string' ? [s.match] : [])
            .filter((m: unknown) => typeof m === 'string' && m.trim())
            .map((m: string) => normalisePattern(m));
        if (match.length === 0) {
            problems.push(`${path}.match needs at least one URL pattern`);
            return;
        }
        for (const m of match) {
            if (seen.has(m)) {
                problems.push(`${path}.match "${m}" is already used by sites[${seen.get(m)}]`);
            }
            seen.set(m, i);
        }
        if (!MODES.includes(s.mode)) {
            problems.push(`${path}.mode must be one of ${MODES.join(', ')}`);
            return;
        }
        const rule: SiteRule = {match, mode: s.mode, ...validateLook(s, path, problems, palettes)};
        if (s.fixes !== undefined) {
            if (!Array.isArray(s.fixes)) {
                problems.push(`${path}.fixes must be an array`);
            } else {
                const fixes = s.fixes.map((f: any, j: number) => validateFix(f, `${path}.fixes[${j}]`, problems))
                    .filter(Boolean) as Fix[];
                if (fixes.length) {
                    rule.fixes = fixes;
                }
            }
        }
        if (typeof s.note === 'string' && s.note) {
            rule.note = s.note;
        }
        sites.push(rule);
    });

    if (problems.length) {
        throw new ConfigError(problems);
    }
    const updatedAt = typeof src.updatedAt === 'string' && !Number.isNaN(Date.parse(src.updatedAt))
        ? src.updatedAt
        : new Date().toISOString();
    return {version: 1, updatedAt, global, palettes, sites};
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function findRule(config: Config, url: string): {rule: SiteRule; pattern: string; index: number} | null {
    let best: {rule: SiteRule; pattern: string; index: number} | null = null;
    let bestScore = -1;
    config.sites.forEach((rule, index) => {
        for (const pattern of rule.match) {
            const score = matchScore(url, pattern);
            if (score > bestScore) {
                bestScore = score;
                best = {rule, pattern, index};
            }
        }
    });
    return best;
}

export function resolve(config: Config, url: string, paused = false): Resolved {
    const g = config.global;
    const found = findRule(config, url);
    const rule = found?.rule ?? null;

    let mode: Resolved['mode'];
    let reason: Resolved['reason'];
    let detectDark = false;
    if (!g.enabled) {
        mode = 'off';
        reason = 'disabled';
    } else if (paused) {
        mode = 'off';
        reason = 'paused';
    } else if (rule) {
        mode = rule.mode;
        reason = 'rule';
    } else if (g.unlisted === 'only-listed') {
        mode = 'off';
        reason = 'only-listed';
    } else {
        mode = g.mode;
        reason = 'unlisted';
        detectDark = g.unlisted === 'skip-already-dark';
    }

    const pick = <K extends keyof GlobalSettings & keyof Look>(k: K) =>
        (rule && rule[k] !== undefined ? rule[k] : g[k]) as GlobalSettings[K];
    const paletteName = pick('palette');
    const palette = config.palettes[paletteName] ?? config.palettes.default ?? DEFAULT_PALETTES.default;

    return {
        rule,
        matchedPattern: found?.pattern ?? null,
        mode,
        detectDark,
        look: {
            brightness: pick('brightness'),
            contrast: pick('contrast'),
            sepia: pick('sepia'),
            grayscale: pick('grayscale'),
            contrastFloor: pick('contrastFloor'),
            iconRescue: pick('iconRescue'),
            imageDim: pick('imageDim'),
            fontFamily: pick('fontFamily'),
            textStroke: pick('textStroke'),
            palette,
            paletteName,
            css: rule?.css ?? '',
        },
        fixes: rule?.fixes ?? [],
        paused,
        reason,
    };
}

// ---------------------------------------------------------------------------
// Editing helpers shared by the popup, the picker and the CLI.
// ---------------------------------------------------------------------------

/** Returns the rule whose match list contains exactly this pattern, creating it if needed. */
export function upsertSite(config: Config, pattern: string, patch: Partial<SiteRule>): Config {
    const p = normalisePattern(pattern);
    const next = structuredClone(config);
    let rule = next.sites.find((s) => s.match.includes(p));
    if (!rule) {
        rule = {match: [p], mode: patch.mode ?? (config.global.mode as SiteRule['mode'])};
        next.sites.push(rule);
    }
    for (const [k, v] of Object.entries(patch)) {
        if (k === 'match') {
            continue;
        }
        if (v === undefined || v === null) {
            delete (rule as any)[k];
        } else {
            (rule as any)[k] = v;
        }
    }
    next.updatedAt = new Date().toISOString();
    return validateConfig(next);
}

export function removeSite(config: Config, pattern: string): Config {
    const p = normalisePattern(pattern);
    const next = structuredClone(config);
    next.sites = next.sites.filter((s) => !s.match.includes(p));
    next.updatedAt = new Date().toISOString();
    return next;
}

export function touch(config: Config): Config {
    return {...config, updatedAt: new Date().toISOString()};
}

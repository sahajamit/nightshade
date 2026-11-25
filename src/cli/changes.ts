/**
 * Describes config changes in plain words: what a site pattern covers, and which settings a
 * change touches. Used by --dry-run, by the "Covers" line after a real change, and by undo.
 * Pure functions, so they can be unit tested.
 */
import {parsePattern} from '../shared/match';
import type {Config, Fix, SiteRule} from '../shared/types';

/** One sentence saying which pages a site pattern applies to. */
export function scopeOf(pattern: string): string {
    const {host, subdomainsOnly, path} = parsePattern(pattern);
    // An example only for a plain domain; "www.mail.google.com" would confuse more than help.
    const eg = host.split('.').length === 2 ? ` (such as www.${host})` : '';
    const hosts = subdomainsOnly
        ? `subdomains of ${host} only${eg}, not ${host} itself`
        : `${host} and every subdomain of it${eg}`;
    return path ? `pages under ${path} on ${hosts}` : hosts;
}

export interface FieldChange {
    field: string;
    from: string;
    to: string;
}

export interface Change {
    kind: 'site' | 'global' | 'palette';
    /** Site patterns joined with ", ", or the palette name, or "global". */
    target: string;
    action: 'added' | 'removed' | 'changed';
    /** Site changes only: what each pattern covers. */
    covers?: string[];
    fields: FieldChange[];
}

function show(v: unknown): string {
    if (v === undefined || v === null) {
        return '(not set)';
    }
    if (typeof v === 'string') {
        const one = v.replace(/\s+/g, ' ').trim();
        return one.length > 60 ? `${one.slice(0, 57)}...` : one;
    }
    return String(v);
}

function fixText(f: Fix): string {
    return `${f.action} ${f.selector}${f.colour ? ` ${f.colour}` : ''}`;
}

function compareObjects(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined, skip: string[]): FieldChange[] {
    const out: FieldChange[] = [];
    const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !skip.includes(k));
    for (const k of keys) {
        const x = a?.[k];
        const y = b?.[k];
        if (k === 'fixes') {
            const fx = ((x as Fix[] | undefined) ?? []).map(fixText);
            const fy = ((y as Fix[] | undefined) ?? []).map(fixText);
            for (const f of fx.filter((f) => !fy.includes(f))) {
                out.push({field: 'fix', from: f, to: '(removed)'});
            }
            for (const f of fy.filter((f) => !fx.includes(f))) {
                out.push({field: 'fix', from: '(none)', to: f});
            }
            continue;
        }
        if (JSON.stringify(x) !== JSON.stringify(y)) {
            out.push({field: k, from: show(x), to: show(y)});
        }
    }
    return out;
}

function siteKey(r: SiteRule): string {
    return r.match.join(', ');
}

/** Every difference between two configs that a person would care about (updatedAt is ignored). */
export function diffConfigs(before: Config, after: Config): Change[] {
    const changes: Change[] = [];
    const g = compareObjects(before.global as any, after.global as any, []);
    if (g.length) {
        changes.push({kind: 'global', target: 'global', action: 'changed', fields: g});
    }
    const beforeSites = new Map(before.sites.map((s) => [siteKey(s), s]));
    const afterSites = new Map(after.sites.map((s) => [siteKey(s), s]));
    for (const [key, rule] of afterSites) {
        const old = beforeSites.get(key);
        const fields = compareObjects(old as any, rule as any, ['match']);
        if (!old || fields.length) {
            changes.push({kind: 'site', target: key, action: old ? 'changed' : 'added', covers: rule.match.map(scopeOf), fields});
        }
    }
    for (const [key, rule] of beforeSites) {
        if (!afterSites.has(key)) {
            changes.push({kind: 'site', target: key, action: 'removed', covers: rule.match.map(scopeOf), fields: []});
        }
    }
    const names = [...new Set([...Object.keys(before.palettes), ...Object.keys(after.palettes)])];
    for (const name of names) {
        const a = before.palettes[name];
        const b = after.palettes[name];
        if (!b) {
            changes.push({kind: 'palette', target: name, action: 'removed', fields: []});
        } else {
            const fields = compareObjects(a as any, b as any, []);
            if (!a || fields.length) {
                changes.push({kind: 'palette', target: name, action: a ? 'changed' : 'added', fields});
            }
        }
    }
    return changes;
}

/** Human-readable lines for a list of changes. */
export function describeChanges(changes: Change[]): string[] {
    if (!changes.length) {
        return ['No changes.'];
    }
    const lines: string[] = [];
    for (const c of changes) {
        const label = c.kind === 'site' ? `Site ${c.target}` : c.kind === 'palette' ? `Palette ${c.target}` : 'Global settings';
        lines.push(`${label}: ${c.action}`);
        for (const cover of c.covers ?? []) {
            lines.push(`  covers ${cover}`);
        }
        for (const f of c.fields) {
            lines.push(`  ${f.field}: ${f.from} -> ${f.to}`);
        }
    }
    return lines;
}

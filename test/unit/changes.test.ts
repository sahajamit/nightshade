import {describe, expect, it} from 'vitest';
import {defaultConfig, upsertSite, removeSite} from '../../src/shared/config';
import {describeChanges, diffConfigs, scopeOf} from '../../src/cli/changes';

describe('scopeOf', () => {
    it('says a bare domain covers its subdomains, with an example', () => {
        expect(scopeOf('github.com')).toBe('github.com and every subdomain of it (such as www.github.com)');
    });
    it('gives no www example for a host that is already a subdomain', () => {
        expect(scopeOf('mail.google.com')).toBe('mail.google.com and every subdomain of it');
    });
    it('says a wildcard excludes the domain itself', () => {
        expect(scopeOf('*.example.com')).toBe('subdomains of example.com only (such as www.example.com), not example.com itself');
    });
    it('names the path for a path pattern', () => {
        expect(scopeOf('example.com/inbox')).toBe('pages under /inbox on example.com and every subdomain of it (such as www.example.com)');
    });
    it('normalises protocol and case', () => {
        expect(scopeOf('HTTPS://GitHub.com/')).toBe(scopeOf('github.com'));
    });
});

describe('diffConfigs', () => {
    const base = upsertSite(defaultConfig(), 'github.com', {mode: 'dynamic', brightness: 90});

    it('finds nothing when only updatedAt differs', () => {
        expect(diffConfigs(base, {...base, updatedAt: new Date(5).toISOString()})).toEqual([]);
    });

    it('reports an added site with what it covers', () => {
        const after = upsertSite(base, 'x.com', {mode: 'native'});
        const [c] = diffConfigs(base, after);
        expect(c).toMatchObject({kind: 'site', target: 'x.com', action: 'added'});
        expect(c.covers).toEqual([scopeOf('x.com')]);
        expect(c.fields).toContainEqual({field: 'mode', from: '(not set)', to: 'native'});
    });

    it('reports changed fields with old and new values', () => {
        const after = upsertSite(base, 'github.com', {mode: 'bespoke', palette: 'default', brightness: undefined});
        const [c] = diffConfigs(base, after);
        expect(c.action).toBe('changed');
        expect(c.fields).toEqual(expect.arrayContaining([
            {field: 'mode', from: 'dynamic', to: 'bespoke'},
            {field: 'palette', from: '(not set)', to: 'default'},
            {field: 'brightness', from: '90', to: '(not set)'},
        ]));
    });

    it('reports fixes one by one', () => {
        const a = upsertSite(base, 'github.com', {fixes: [{selector: 'body', action: 'darken'}]});
        const b = upsertSite(base, 'github.com', {fixes: [{selector: '[role=checkbox]', action: 'strengthen-border'}]});
        const fields = diffConfigs(a, b)[0].fields;
        expect(fields).toContainEqual({field: 'fix', from: 'darken body', to: '(removed)'});
        expect(fields).toContainEqual({field: 'fix', from: '(none)', to: 'strengthen-border [role=checkbox]'});
    });

    it('reports removed sites, global and palette changes', () => {
        const after = structuredClone(removeSite(base, 'github.com'));
        after.global.sepia = 20;
        after.palettes.dracula = {...after.palettes.default, bg: '#282a36'};
        const changes = diffConfigs(base, after);
        expect(changes).toContainEqual(expect.objectContaining({kind: 'site', target: 'github.com', action: 'removed'}));
        expect(changes).toContainEqual({kind: 'global', target: 'global', action: 'changed', fields: [{field: 'sepia', from: '0', to: '20'}]});
        expect(changes).toContainEqual(expect.objectContaining({kind: 'palette', target: 'dracula', action: 'added'}));
    });

    it('describes changes as readable lines', () => {
        const after = upsertSite(base, 'github.com', {mode: 'off'});
        expect(describeChanges(diffConfigs(base, after))).toEqual([
            'Site github.com: changed',
            `  covers ${scopeOf('github.com')}`,
            '  mode: dynamic -> off',
        ]);
        expect(describeChanges([])).toEqual(['No changes.']);
    });
});

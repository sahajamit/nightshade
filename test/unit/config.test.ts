import {describe, expect, it} from 'vitest';
import {ConfigError, defaultConfig, removeSite, resolve, upsertSite, validateConfig} from '../../src/shared/config';

describe('validateConfig', () => {
    it('accepts the defaults', () => {
        expect(() => validateConfig(defaultConfig())).not.toThrow();
    });
    it('fills missing fields from defaults', () => {
        const c = validateConfig({sites: [{match: 'linkedin.com', mode: 'native'}]});
        expect(c.global.mode).toBe('dynamic');
        expect(c.sites[0].match).toEqual(['linkedin.com']);
        expect(c.palettes.default).toBeDefined();
    });
    it('lists every problem at once', () => {
        try {
            validateConfig({global: {brightness: 400, unlisted: 'nope'}, sites: [{match: ['a.com'], mode: 'wild'}, {match: [], mode: 'off'}]});
            throw new Error('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(ConfigError);
            const problems = (e as ConfigError).problems.join('\n');
            expect(problems).toMatch(/global.brightness/);
            expect(problems).toMatch(/global.unlisted/);
            expect(problems).toMatch(/sites\[0\].mode/);
            expect(problems).toMatch(/sites\[1\].match/);
        }
    });
    it('rejects duplicate patterns, bad colours and unknown palettes', () => {
        expect(() => validateConfig({sites: [{match: ['a.com'], mode: 'off'}, {match: ['A.com'], mode: 'native'}]})).toThrow(/already used/);
        expect(() => validateConfig({palettes: {mine: {bg: 'red'}}})).toThrow(/hex colour/);
        expect(() => validateConfig({sites: [{match: ['a.com'], mode: 'bespoke', palette: 'ghost'}]})).toThrow(/not defined/);
        expect(() => validateConfig({sites: [{match: ['a.com'], mode: 'native', fixes: [{selector: 'x', action: 'set-colour'}]}]})).toThrow(/needs a colour/);
    });
    it('refuses CSS that could escape a style element', () => {
        expect(() => validateConfig({sites: [{match: ['a.com'], mode: 'native', css: '</style><script>'}]})).toThrow();
    });
});

describe('resolve', () => {
    const base = validateConfig({
        sites: [
            {match: ['google.com'], mode: 'dynamic', brightness: 90},
            {match: ['mail.google.com'], mode: 'native', contrastFloor: 4.5},
            {match: ['x.com/i/flow'], mode: 'off'},
        ],
    });
    it('picks the most specific rule and inherits the rest', () => {
        const r = resolve(base, 'https://mail.google.com/mail/u/0/');
        expect(r.mode).toBe('native');
        expect(r.look.contrastFloor).toBe(4.5);
        expect(r.look.brightness).toBe(100);
        expect(r.reason).toBe('rule');
    });
    it('uses the global default with dark detection for unlisted sites', () => {
        const r = resolve(base, 'https://example.org/');
        expect(r.mode).toBe('dynamic');
        expect(r.detectDark).toBe(true);
        expect(r.reason).toBe('unlisted');
    });
    it('honours only-listed, the master switch and pauses', () => {
        expect(resolve({...base, global: {...base.global, unlisted: 'only-listed'}}, 'https://example.org/').mode).toBe('off');
        expect(resolve({...base, global: {...base.global, enabled: false}}, 'https://mail.google.com/').mode).toBe('off');
        expect(resolve(base, 'https://mail.google.com/', true).reason).toBe('paused');
    });
    it('path rules apply only under their path', () => {
        expect(resolve(base, 'https://x.com/i/flow/login').mode).toBe('off');
        expect(resolve(base, 'https://x.com/home').reason).toBe('unlisted');
    });
});

describe('editing', () => {
    it('upsertSite creates, patches and clears fields', () => {
        let c = upsertSite(defaultConfig(), 'LinkedIn.com', {mode: 'native', contrastFloor: 4.5});
        expect(c.sites.find((s) => s.match.includes('linkedin.com'))?.contrastFloor).toBe(4.5);
        c = upsertSite(c, 'linkedin.com', {contrastFloor: null as any, sepia: 20});
        const r = c.sites.find((s) => s.match.includes('linkedin.com'))!;
        expect(r.contrastFloor).toBeUndefined();
        expect(r.sepia).toBe(20);
        c = removeSite(c, 'linkedin.com');
        expect(c.sites.some((s) => s.match.includes('linkedin.com'))).toBe(false);
    });
});

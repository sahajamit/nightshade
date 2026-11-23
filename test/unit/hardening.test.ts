import {describe, expect, it} from 'vitest';
import {isExtensionId, shellQuote} from '../../src/cli/file';
import {ConfigError, cssFragmentProblem, validateConfig} from '../../src/shared/config';

describe('cssFragmentProblem', () => {
    it('accepts ordinary selectors', () => {
        for (const s of [
            '[aria-label="Delete"]', '[role=checkbox]', 'body', 'div.card > a:not(.x, [href^="#"])',
            '[style*="color: red;"]', '[data-x="{a}"]', "[title='it\\'s']", '#a\\:b', 'li:nth-of-type(2n + 1)',
        ]) {
            expect(cssFragmentProblem(s), s).toBeNull();
        }
    });
    it('rejects text that could escape its rule or swallow the next one', () => {
        for (const s of [
            'a { color: red } b', 'a; b', 'a[href="x', "a[title='x", 'a:not(.b', 'a[href', 'a)', 'a]',
            'a /* x', 'a */ b', '@import url(x)', 'a\nb', 'a\\', 'a:is(.b]',
        ]) {
            expect(cssFragmentProblem(s), s).not.toBeNull();
        }
    });
});

describe('validateConfig hardening', () => {
    const withFix = (selector: string) => ({sites: [{match: ['example.com'], mode: 'native', fixes: [{selector, action: 'hide'}]}]});
    it('rejects a fix whose selector is not self-contained', () => {
        expect(() => validateConfig(withFix('a[href="x'))).toThrow(ConfigError);
        expect(() => validateConfig(withFix('.promo, .ad:not(.keep'))).toThrow(/unbalanced/);
        expect(validateConfig(withFix('[aria-label="Close; dismiss"]')).sites.at(-1)!.fixes).toHaveLength(1);
    });
    it('rejects a font family that is not self-contained', () => {
        expect(() => validateConfig({global: {fontFamily: '"Inter'}})).toThrow(ConfigError);
        expect(() => validateConfig({global: {fontFamily: 'x; } body { display: none'}})).toThrow(ConfigError);
        expect(validateConfig({global: {fontFamily: '"Atkinson Hyperlegible", Inter'}}).global.fontFamily).toContain('Atkinson');
    });
});

describe('bridge install helpers', () => {
    it('quotes paths so the shell cannot expand them', () => {
        expect(shellQuote('/opt/node bin/node')).toBe("'/opt/node bin/node'");
        expect(shellQuote('/tmp/$(touch x)/`id`')).toBe("'/tmp/$(touch x)/`id`'");
        expect(shellQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'");
    });
    it('recognises extension IDs', () => {
        expect(isExtensionId('cilhiaedhodolblheagjkpjgfnananpf')).toBe(true);
        expect(isExtensionId('cilhiaedhodolblheagjkpjgfnananpz')).toBe(false);
        expect(isExtensionId('*')).toBe(false);
        expect(isExtensionId('abc')).toBe(false);
    });
});

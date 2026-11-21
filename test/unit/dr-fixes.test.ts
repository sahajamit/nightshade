import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {combineFixes, indexFixes, parseFixes, parseInversionFixes, siteFixFor} from '../../src/shared/dr-fixes';

const dynamicText = readFileSync('vendor/darkreader/dynamic-theme-fixes.config', 'utf8');
const inversionText = readFileSync('vendor/darkreader/inversion-fixes.config', 'utf8');

describe('Dark Reader fix files', () => {
    const fixes = parseFixes(dynamicText);
    const index = indexFixes(fixes);
    it('parses every block', () => {
        expect(fixes.length).toBeGreaterThan(2500);
        expect(index.generic?.url).toEqual(['*']);
    });
    it('finds the Gmail and LinkedIn fixes', () => {
        const gmail = siteFixFor(index, 'https://mail.google.com/mail/u/0/#inbox')!;
        expect(gmail.url).toContain('mail.google.com');
        expect(gmail.invert.length).toBeGreaterThan(10);
        expect(gmail.css).toMatch(/\.buk/);
        expect(siteFixFor(index, 'https://www.linkedin.com/feed/')?.url).toContain('linkedin.com');
    });
    it('prefers the most specific pattern', () => {
        expect(siteFixFor(index, 'https://docs.google.com/picker?x=1')?.url).toContain('docs.google.com/picker');
    });
    it('combines generic and site fixes', () => {
        const c = combineFixes([index.generic, siteFixFor(index, 'https://mail.google.com/')]);
        expect(c.invert.length).toBe(index.generic!.invert.length + siteFixFor(index, 'https://mail.google.com/')!.invert.length);
        expect(c.css).toContain('.buk');
    });
    it('parses inversion fixes with NO INVERT and REMOVE BG', () => {
        const inv = parseInversionFixes(inversionText);
        const generic = inv.find((f) => f.url[0] === '*')!;
        expect(generic.invert).toContain('img');
        expect(generic.noinvert).toContain('input');
        expect(generic.removebg.length).toBeGreaterThan(0);
    });
});

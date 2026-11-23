import {describe, expect, it} from 'vitest';
import {DEFAULT_PALETTES} from '../../src/shared/config';
import {fixesCSS} from '../../src/shared/css';

describe('fixesCSS', () => {
    const p = DEFAULT_PALETTES.default;
    it('turns each action into a scoped rule', () => {
        const css = fixesCSS([
            {selector: '[aria-label="Delete"]', action: 'set-colour', colour: '#e9a08f'},
            {selector: '[role=checkbox]', action: 'strengthen-border'},
            {selector: '.promo', action: 'hide'},
            {selector: '.icon', action: 'make-visible'},
        ], p);
        expect(css).toContain('[aria-label="Delete"] { color: #e9a08f !important; }');
        expect(css).toContain(`[role=checkbox] { border-color: ${p.muted} !important`);
        expect(css).toContain('.promo { display: none !important; }');
        expect(css).toMatch(/\.icon \{ filter: brightness\(0\) invert\(0\.85\)/);
    });
    it('make-visible goes dark on light pages', () => {
        expect(fixesCSS([{selector: 'i', action: 'make-visible'}], p, false)).toMatch(/invert\(0\.15\)/);
    });
});

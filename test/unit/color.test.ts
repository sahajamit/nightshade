import {describe, expect, it} from 'vitest';
import {contrastRatio, ensureContrast, parseColour} from '../../src/shared/color';

describe('colour', () => {
    it('parses computed-style colours', () => {
        expect(parseColour('rgb(1, 2, 3)')).toEqual({r: 1, g: 2, b: 3, a: 1});
        expect(parseColour('rgba(1, 2, 3, 0.5)')?.a).toBe(0.5);
        expect(parseColour('rgb(1 2 3 / 50%)')?.a).toBe(0.5);
        expect(parseColour('#fff')).toEqual({r: 255, g: 255, b: 255, a: 1});
        expect(parseColour('transparent')?.a).toBe(0);
    });
    it('computes WCAG contrast', () => {
        expect(contrastRatio(parseColour('#000')!, parseColour('#fff')!)).toBeCloseTo(21, 0);
    });
    it('lifts a dim icon on a dark background to the target ratio', () => {
        const bg = parseColour('#181a1b')!;
        const icon = parseColour('#33363a')!;
        expect(contrastRatio(icon, bg)).toBeLessThan(1.5);
        const fixed = ensureContrast(icon, bg, 4.5)!;
        expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(fixed, bg)).toBeLessThan(6); // lifted just enough, not blasted to white
    });
    it('darkens on light backgrounds and leaves passing colours alone', () => {
        const fixed = ensureContrast(parseColour('#cccccc')!, parseColour('#ffffff')!, 4.5)!;
        expect(contrastRatio(fixed, parseColour('#ffffff')!)).toBeGreaterThanOrEqual(4.5);
        expect(ensureContrast(parseColour('#e8e6e3')!, parseColour('#181a1b')!, 4.5)).toBeNull();
    });
});

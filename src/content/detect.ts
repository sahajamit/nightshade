/** Is this page already dark in its own theme? */
import {luminance, parseColour} from '../shared/color';
import {effectiveBackground} from './dom';

/**
 * Returns true (dark), false (light) or null (transparent iframe: no opinion).
 * Call with Nightshade's own styles disabled so they don't skew the reading.
 */
export function pageLooksDark(isTop: boolean): boolean | null {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content?.trim().toLowerCase();
    if (meta === 'dark' || meta === 'only dark') {
        return true;
    }
    const html = document.documentElement;
    const body = document.body;
    const opaque = (el: Element | null) => {
        if (!el) {
            return null;
        }
        const c = parseColour(getComputedStyle(el).backgroundColor);
        return c && c.a > 0.5 ? c : null;
    };
    let bg = opaque(body) ?? opaque(html);
    if (!bg) {
        // Many apps paint their background on a root <div>. Sample what is under the
        // middle of the viewport instead.
        const x = Math.round(innerWidth / 2);
        const y = Math.round(innerHeight / 2);
        const hit = document.elementFromPoint(x, y);
        bg = hit ? effectiveBackground(hit, new Map(), {r: 255, g: 255, b: 255, a: 0}) : null;
        if (!bg || bg.a === 0) {
            if (!isTop) {
                return null;
            }
            bg = {r: 255, g: 255, b: 255, a: 1};
        }
    }
    const lum = luminance(bg);
    if (lum < 0.08) {
        return true;
    }
    if (lum > 0.3) {
        return false;
    }
    // Middle grey: let the text colour decide.
    const fg = parseColour(getComputedStyle(body ?? html).color);
    return fg ? luminance(fg) > 0.4 : lum < 0.18;
}

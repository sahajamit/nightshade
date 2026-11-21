/** Small DOM helpers shared by the content-script modules. */
import {parseColour, over, type RGBA} from '../shared/color';

export const WHITE: RGBA = {r: 255, g: 255, b: 255, a: 1};

/** A <style> we own. The "darkreader" class keeps Dark Reader from recolouring it. */
export function ownStyle(id: string): HTMLStyleElement {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        el.className = 'darkreader nightshade';
        el.media = 'screen';
    }
    if (!el.isConnected || el.parentNode !== document.documentElement || el.nextElementSibling) {
        // Last child of <html> so it comes after page and Dark Reader styles in the cascade.
        document.documentElement.appendChild(el);
    }
    return el;
}

export function removeOwnStyle(id: string): void {
    document.getElementById(id)?.remove();
}

export function domReady(): Promise<void> {
    if (document.readyState !== 'loading') {
        return Promise.resolve();
    }
    return new Promise((r) => document.addEventListener('DOMContentLoaded', () => r(), {once: true}));
}

export function idle(timeout = 1000): Promise<void> {
    return new Promise((r) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => r(), {timeout});
        } else {
            setTimeout(r, 50);
        }
    });
}

/**
 * The colour actually behind an element: walks up until an (almost) opaque background.
 * Returns null when an ancestor paints an image or gradient, because then we can't know.
 */
export function effectiveBackground(el: Element | null, cache: Map<Element, RGBA | null>, fallback: RGBA = WHITE): RGBA | null {
    const chain: Element[] = [];
    let layers: RGBA[] = [];
    let node: Element | null = el;
    let result: RGBA | null = fallback;
    while (node) {
        if (cache.has(node)) {
            result = cache.get(node)!;
            break;
        }
        chain.push(node);
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
            result = null;
            break;
        }
        const bg = parseColour(cs.backgroundColor);
        if (bg && bg.a > 0) {
            if (bg.a >= 0.95) {
                result = bg;
                break;
            }
            layers.push(bg);
        }
        node = node.parentElement;
    }
    if (result && layers.length) {
        layers = layers.reverse();
        for (const l of layers) {
            result = over(l, result);
        }
    }
    // Only cache the element where the walk stopped and above; translucent layers make
    // lower elements differ, so cache them only when there were none.
    if (!layers.length) {
        for (const n of chain) {
            cache.set(n, result);
        }
    }
    return result;
}

export function isVisible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

export function cssUrl(value: string): string | null {
    const m = value.match(/url\((['"]?)(.*?)\1\)/);
    return m ? m[2] : null;
}

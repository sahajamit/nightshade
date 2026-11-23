export interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Parses the colour formats getComputedStyle returns (rgb/rgba, incl. space syntax) and hex. */
export function parseColour(input: string | null | undefined): RGBA | null {
    if (!input) {
        return null;
    }
    const s = input.trim().toLowerCase();
    if (s === 'transparent') {
        return {r: 0, g: 0, b: 0, a: 0};
    }
    if (s.startsWith('#')) {
        let h = s.slice(1);
        if (h.length === 3 || h.length === 4) {
            h = h.split('').map((c) => c + c).join('');
        }
        if (h.length !== 6 && h.length !== 8) {
            return null;
        }
        const n = parseInt(h, 16);
        if (Number.isNaN(n)) {
            return null;
        }
        if (h.length === 6) {
            return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1};
        }
        return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255};
    }
    const m = s.match(/^rgba?\(([^)]+)\)$/);
    if (!m) {
        return null;
    }
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) {
        return null;
    }
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const c = {r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a: alpha};
    if ([c.r, c.g, c.b, c.a].some((v) => Number.isNaN(v))) {
        return null;
    }
    return c;
}

export function toHex({r, g, b}: RGBA): string {
    const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** Composites a (possibly translucent) colour over an opaque background. */
export function over(top: RGBA, bottom: RGBA): RGBA {
    const a = top.a;
    return {
        r: top.r * a + bottom.r * (1 - a),
        g: top.g * a + bottom.g * (1 - a),
        b: top.b * a + bottom.b * (1 - a),
        a: 1,
    };
}

function channel(v: number): number {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0-1. */
export function luminance(c: RGBA): number {
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1-21. */
export function contrastRatio(a: RGBA, b: RGBA): number {
    const la = luminance(a);
    const lb = luminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

export function isDarkColour(c: RGBA): boolean {
    return luminance(c) < 0.18;
}

interface HSL {
    h: number;
    s: number;
    l: number;
}

export function rgbToHsl({r, g, b}: RGBA): HSL {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) {
        return {h: 0, s: 0, l};
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === rn) {
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
    } else if (max === gn) {
        h = (bn - rn) / d + 2;
    } else {
        h = (rn - gn) / d + 4;
    }
    return {h: h * 60, s, l};
}

export function hslToRgb({h, s, l}: HSL, a = 1): RGBA {
    if (s === 0) {
        const v = l * 255;
        return {r: v, g: v, b: v, a};
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
        let x = t;
        if (x < 0) {
            x += 1;
        }
        if (x > 1) {
            x -= 1;
        }
        if (x < 1 / 6) {
            return p + (q - p) * 6 * x;
        }
        if (x < 1 / 2) {
            return q;
        }
        if (x < 2 / 3) {
            return p + (q - p) * (2 / 3 - x) * 6;
        }
        return p;
    };
    const hn = h / 360;
    return {r: hue(hn + 1 / 3) * 255, g: hue(hn) * 255, b: hue(hn - 1 / 3) * 255, a};
}

/**
 * Moves a foreground colour's lightness away from the background until it reaches
 * the target contrast ratio, keeping its hue. Returns null if it already passes.
 */
export function ensureContrast(fg: RGBA, bg: RGBA, target: number): RGBA | null {
    const solidFg = fg.a < 1 ? over(fg, bg) : fg;
    if (contrastRatio(solidFg, bg) >= target) {
        return null;
    }
    // Aim a little above the target so rounding to 8-bit hex can't land just under it.
    target = target * 1.03;
    const hsl = rgbToHsl(solidFg);
    const lighten = luminance(bg) < 0.5;
    // Keep some saturation but avoid neon: reduce it a little as lightness rises.
    const s = Math.min(hsl.s, 0.6);
    let lo = hsl.l;
    let hi = lighten ? 1 : 0;
    let best = hslToRgb({h: hsl.h, s, l: hi});
    for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        const c = hslToRgb({h: hsl.h, s, l: mid});
        if (contrastRatio(c, bg) >= target) {
            best = c;
            hi = mid;
        } else {
            lo = mid;
        }
    }
    return best;
}

/** CSS generation for everything that is not Dark Reader's dynamic engine. */
import type {Fix, Palette, Resolved} from './types';
import type {InversionFix} from './dr-fixes';

const REVERSE = 'invert(100%) hue-rotate(180deg)';

export function paletteVars(p: Palette): string {
    return `:root {
  --ns-bg: ${p.bg};
  --ns-surface: ${p.surface};
  --ns-text: ${p.text};
  --ns-muted: ${p.muted};
  --ns-link: ${p.link};
  --ns-border: ${p.border};
  --ns-icon: ${p.icon};
  --ns-selection: ${p.selection};
}`;
}

/** brightness/contrast/sepia/grayscale as a CSS filter list, or '' when all neutral. */
export function adjustFilter(look: Resolved['look']): string {
    const f: string[] = [];
    if (look.brightness !== 100) {
        f.push(`brightness(${look.brightness}%)`);
    }
    if (look.contrast !== 100) {
        f.push(`contrast(${look.contrast}%)`);
    }
    if (look.sepia) {
        f.push(`sepia(${look.sepia}%)`);
    }
    if (look.grayscale) {
        f.push(`grayscale(${look.grayscale}%)`);
    }
    return f.join(' ');
}

const ICON_FONTS = 'pre, pre *, code, code *, kbd, samp, [class*="icon"], [class*="Icon"], [class*="fa-"], .fa, .fab, .fas, .far, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [class*="glyph"], i';

export function textCSS(look: Resolved['look']): string {
    const out: string[] = [];
    if (look.fontFamily) {
        const fam = look.fontFamily.includes(',') || /^["']/.test(look.fontFamily) ? look.fontFamily : `"${look.fontFamily}"`;
        out.push(`*:not(${ICON_FONTS}) { font-family: ${fam}, system-ui, sans-serif !important; }`);
    }
    if (look.textStroke > 0) {
        out.push(`* { -webkit-text-stroke: ${look.textStroke}px !important; }`);
    }
    return out.join('\n');
}

/**
 * User fixes as CSS. `pageIsDark` decides which way "make visible" pushes an element.
 * leave-untouched is handled by the engine (Dark Reader ignore lists), plus filter:none here.
 */
export function fixesCSS(fixes: Fix[], palette: Palette, pageIsDark = true): string {
    const out: string[] = [];
    for (const f of fixes) {
        const s = f.selector;
        switch (f.action) {
            case 'make-visible':
                out.push(`${s} { filter: brightness(0) invert(${pageIsDark ? 0.85 : 0.15}) !important; opacity: 1 !important; }`);
                break;
            case 'invert':
                out.push(`${s} { filter: ${REVERSE} !important; }`);
                break;
            case 'set-colour': {
                const c = f.colour ?? palette.icon;
                out.push(`${s} { color: ${c} !important; }`);
                out.push(`${s} :is(path, circle, rect, polygon, ellipse, line, polyline):not([fill="none"]), ${s}:is(path, circle, rect, polygon, ellipse) { fill: ${c} !important; }`);
                out.push(`${s} [stroke]:not([stroke="none"]) { stroke: ${c} !important; }`);
                break;
            }
            case 'strengthen-border': {
                const c = f.colour ?? palette.muted;
                out.push(`${s} { border-color: ${c} !important; outline-color: ${c} !important; }`);
                break;
            }
            case 'leave-untouched':
                out.push(`${s} { filter: none !important; }`);
                break;
            case 'hide':
                out.push(`${s} { display: none !important; }`);
                break;
        }
    }
    return out.join('\n');
}

/** Selectors the boosts layer tags; styled here so the tags work in every mode. */
export function boostCSS(look: Resolved['look']): string {
    const out = [
        '[data-ns-icon="light"] { filter: brightness(0) invert(0.86) !important; }',
        '[data-ns-icon="dark"] { filter: brightness(0) invert(0.14) !important; }',
    ];
    if (look.imageDim < 100) {
        out.push(`[data-ns-dim] { filter: brightness(${look.imageDim}%) !important; }`);
    }
    return out.join('\n');
}

/** Full-page invert ("Filter" mode), following Dark Reader's css-filter generator. */
export function filterModeCSS(look: Resolved['look'], fix: InversionFix | null, isTopFrame: boolean): string {
    const adjust = adjustFilter(look);
    const lead = [REVERSE, adjust].filter(Boolean).join(' ');
    const out: string[] = ['@media screen {'];
    if (isTopFrame) {
        out.push(`html { filter: ${lead} !important; }`);
        out.push('html { background: rgb(255, 255, 255) !important; }');
    }
    if (fix) {
        if (fix.invert.length) {
            out.push(`${fix.invert.join(',\n')} { filter: ${REVERSE} !important; }`);
        }
        if (fix.noinvert.length) {
            out.push(`${fix.noinvert.join(',\n')} { filter: none !important; }`);
        }
        if (fix.removebg.length) {
            out.push(`${fix.removebg.join(',\n')} { background: white !important; }`);
        }
    }
    out.push(':fullscreen, :fullscreen * { filter: none !important; }');
    if (fix?.css) {
        out.push(fix.css);
    }
    out.push('}');
    return out.join('\n');
}

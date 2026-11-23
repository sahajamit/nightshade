/**
 * Boosts: fixes that stack on top of any mode (except filter and off).
 *
 *  - Contrast floor: text, control borders and monochrome icons that fall under the target
 *    ratio against what is behind them get their colour lifted (or lowered on light pages).
 *  - Icon rescue: small dark glyph images (img, background-image) on dark pages get lightened.
 *  - Image dim: large images and video get a brightness filter.
 *
 * Every pass reads the page with Nightshade's boost stylesheet disabled, so it always works
 * from the page's own colours (after Dark Reader) and heals itself when the page changes.
 * Elements are tagged with data-ns-c tokens; one CSS rule per distinct token.
 */
import {ensureContrast, luminance, parseColour, toHex, type RGBA} from '../shared/color';
import {analyzeSvg} from '../background/images';
import type {ImageVerdict} from '../shared/messages';
import type {Resolved} from '../shared/types';
import {sendToBackground} from './native';
import {cssUrl, effectiveBackground, ownStyle, removeOwnStyle, WHITE} from './dom';

const STYLE_ID = 'nightshade-boosts';
const ATTR = 'data-ns-c';
const ICON_ATTR = 'data-ns-icon';
const DIM_ATTR = 'data-ns-dim';
const MAX_TEXT_ELEMENTS = 6000;
const ICON_MAX = 48;

const CONTROL_SELECTOR = [
    'input:not([type=hidden])', 'textarea', 'select', 'button',
    '[role=checkbox]', '[role=radio]', '[role=switch]', '[role=textbox]', '[role=combobox]', '[role=searchbox]',
    '[role=checkbox] > *', '[role=checkbox] > * > *',
].join(',');

const SHAPES = 'path, circle, rect, polygon, ellipse, line, polyline, use, text';

export interface BoostStats {
    contrastFixes: number;
    iconsRescued: number;
}

interface Options {
    look: Resolved['look'];
    pageIsDark: boolean;
    /** Selectors from "darken" fixes: light panels inside them get inverted. */
    darken?: string[];
}

const DARKEN_ATTR = 'data-ns-darken';
const KEEP_ATTR = 'data-ns-keep';
/** A panel smaller than this is a button or chip, not a reading area. */
const ISLAND_MIN_W = 160;
const ISLAND_MIN_H = 80;

let options: Options | null = null;
let observer: MutationObserver | null = null;
let timer: number | undefined;
let lastRun = 0;
let running = false;
let scrollHooked = false;
let stats: BoostStats = {contrastFixes: 0, iconsRescued: 0};
const verdicts = new Map<string, Promise<ImageVerdict | null>>();

export function boostStats(): BoostStats {
    return stats;
}

function verdictFor(url: string): Promise<ImageVerdict | null> {
    let p = verdicts.get(url);
    if (!p) {
        if (url.startsWith('data:image/svg+xml')) {
            try {
                const comma = url.indexOf(',');
                const meta = url.slice(0, comma);
                const body = url.slice(comma + 1);
                const text = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
                p = Promise.resolve(analyzeSvg(text));
            } catch {
                p = Promise.resolve(null);
            }
        } else if (/^https?:/.test(url)) {
            p = sendToBackground<ImageVerdict | null>({type: 'analyzeImage', url}).catch(() => null);
        } else {
            p = Promise.resolve(null);
        }
        verdicts.set(url, p);
    }
    return p;
}

function tokenRule(token: string): string | null {
    const [kind, hex] = token.split(':');
    const c = `#${hex}`;
    switch (kind) {
        case 'fg': return `[${ATTR}~="${token}"] { color: ${c} !important; -webkit-text-fill-color: ${c} !important; }`;
        case 'bd': return `[${ATTR}~="${token}"] { border-color: ${c} !important; }`;
        case 'fill': return `[${ATTR}~="${token}"] { fill: ${c} !important; }`;
        case 'stroke': return `[${ATTR}~="${token}"] { stroke: ${c} !important; }`;
        case 'bg': return `[${ATTR}~="${token}"] { background-color: ${c} !important; }`;
    }
    return null;
}

function staticRules(look: Resolved['look']): string {
    const rules = [
        `[${ICON_ATTR}="light"] { filter: brightness(0) invert(0.86) !important; }`,
        `[${ICON_ATTR}="dark"] { filter: brightness(0) invert(0.14) !important; }`,
    ];
    if (look.imageDim < 100) {
        rules.push(`[${DIM_ATTR}] { filter: brightness(${look.imageDim}%) !important; }`);
    }
    // Darkened panels: invert the panel, then flip photos and video back. contrast(.88) keeps
    // white from becoming pure black and text from becoming pure white.
    rules.push(`[${DARKEN_ATTR}] { filter: invert(1) hue-rotate(180deg) contrast(0.88) !important; }`);
    rules.push(`[${DARKEN_ATTR}] :is(img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"]):not([${KEEP_ATTR}]) { filter: invert(1) hue-rotate(180deg) !important; }`);
    rules.push(`[${DARKEN_ATTR}] [${KEEP_ATTR}] { filter: none !important; }`);
    return rules.join('\n');
}

function hasOwnText(el: Element): boolean {
    for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim()) {
            return true;
        }
    }
    return false;
}

function addToken(map: Map<Element, Set<string>>, el: Element, kind: string, c: RGBA) {
    const token = `${kind}:${toHex(c).slice(1)}`;
    let set = map.get(el);
    if (!set) {
        set = new Set();
        map.set(el, set);
    }
    set.add(token);
}

function textElements(): Element[] {
    const out = new Set<Element>();
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
    });
    while (walker.nextNode() && out.size < MAX_TEXT_ELEMENTS) {
        const p = walker.currentNode.parentElement;
        if (p && !p.closest('script, style, noscript, svg, template')) {
            out.add(p);
        }
    }
    return [...out];
}

function inViewportBand(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
        return false;
    }
    const band = innerHeight * 2;
    return r.bottom > -band && r.top < innerHeight + band;
}

function isLight(c: RGBA | null): boolean {
    return Boolean(c) && luminance(c!) > 0.5;
}

/**
 * Tags the light "islands" inside each darken selector: elements with their own light background
 * whose surroundings are dark (or that are the region itself and light). Returns the tagged set.
 */
function findIslands(selectors: string[], bgCache: Map<Element, RGBA | null>, pageBg: RGBA): Set<Element> {
    const islands = new Set<Element>();
    for (const sel of selectors) {
        let roots: Element[];
        try {
            roots = [...document.querySelectorAll(sel)];
        } catch {
            continue;
        }
        for (const root of roots) {
            const r = root.getBoundingClientRect();
            if (r.width < ISLAND_MIN_W || r.height < ISLAND_MIN_H) {
                continue;
            }
            if (isLight(effectiveBackground(root, bgCache, pageBg))) {
                // The whole region is light: but only darken it if what surrounds it is dark.
                const outside = effectiveBackground(root.parentElement, bgCache, pageBg);
                if (!isLight(outside)) {
                    islands.add(root);
                    continue;
                }
            }
            // Otherwise look for the outermost light panels inside it.
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let el = walker.nextNode() as Element | null;
            while (el) {
                const rect = el.getBoundingClientRect();
                let skipChildren = false;
                if (rect.width >= ISLAND_MIN_W && rect.height >= ISLAND_MIN_H) {
                    const own = parseColour(getComputedStyle(el).backgroundColor);
                    if (own && own.a >= 0.9 && isLight(own) && !isLight(effectiveBackground(el.parentElement, bgCache, pageBg))) {
                        islands.add(el);
                        skipChildren = true;
                    }
                } else if (rect.width < ISLAND_MIN_W && rect.height < ISLAND_MIN_H) {
                    skipChildren = true; // too small to contain a reading panel
                }
                let next: Node | null = skipChildren ? null : walker.firstChild();
                if (!next) {
                    next = walker.nextSibling();
                    while (!next && walker.parentNode() && walker.currentNode !== root) {
                        next = walker.nextSibling();
                    }
                }
                el = next as Element | null;
            }
        }
    }
    return islands;
}

function pass(): void {
    if (!options || running) {
        return;
    }
    running = true;
    const {look, pageIsDark} = options;
    const floor = look.contrastFloor;
    const sheet = ownStyle(STYLE_ID);
    // Read the page without our own fixes applied.
    sheet.disabled = true;
    const bgCache = new Map<Element, RGBA | null>();
    const pageBg = (() => {
        const c = parseColour(getComputedStyle(document.documentElement).backgroundColor);
        return c && c.a > 0.5 ? c : pageIsDark ? {r: 24, g: 26, b: 27, a: 1} : WHITE;
    })();
    const tokens = new Map<Element, Set<string>>();
    const iconChecks: Array<{el: Element; url: string; inIsland: boolean}> = [];
    const dims: Element[] = [];
    const islands = options.darken?.length ? findIslands(options.darken, bgCache, pageBg) : new Set<Element>();
    const inIsland = (el: Element) => {
        for (const i of islands) {
            if (i.contains(el)) {
                return true;
            }
        }
        return false;
    };

    try {
        if (floor > 0) {
            // 1. Text
            for (const el of textElements()) {
                if (!inViewportBand(el) || (islands.size && inIsland(el))) {
                    continue;
                }
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.3) {
                    continue;
                }
                const fg = parseColour(cs.color);
                const bg = effectiveBackground(el, bgCache, pageBg);
                if (!fg || !bg || fg.a === 0) {
                    continue;
                }
                const fixed = ensureContrast(fg, bg, floor);
                if (fixed) {
                    addToken(tokens, el, 'fg', fixed);
                }
            }
            // 2. Control borders (WCAG asks 3:1 for UI components; use the floor if lower).
            const borderTarget = Math.min(floor, 3);
            for (const el of document.querySelectorAll(CONTROL_SELECTOR)) {
                if (!inViewportBand(el) || (islands.size && inIsland(el))) {
                    continue;
                }
                const cs = getComputedStyle(el);
                if (cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) {
                    continue;
                }
                const bd = parseColour(cs.borderTopColor);
                const bg = effectiveBackground(el.parentElement, bgCache, pageBg);
                if (!bd || !bg || bd.a === 0) {
                    continue;
                }
                const fixed = ensureContrast(bd, bg, borderTarget);
                if (fixed) {
                    addToken(tokens, el, 'bd', fixed);
                }
            }
            // 3. Small monochrome SVG icons and mask-image icons.
            for (const svg of document.querySelectorAll('svg')) {
                const r = svg.getBoundingClientRect();
                if (r.width === 0 || r.width > ICON_MAX || r.height > ICON_MAX || !inViewportBand(svg) || (islands.size && inIsland(svg))) {
                    continue;
                }
                const bg = effectiveBackground(svg.parentElement, bgCache, pageBg);
                if (!bg) {
                    continue;
                }
                const shapes = [...svg.querySelectorAll(SHAPES)].slice(0, 24);
                const paints: Array<{el: Element; kind: 'fill' | 'stroke'; c: RGBA}> = [];
                for (const s of shapes) {
                    const cs = getComputedStyle(s);
                    for (const kind of ['fill', 'stroke'] as const) {
                        const c = parseColour(cs[kind]);
                        if (c && c.a > 0) {
                            paints.push({el: s, kind, c});
                        }
                    }
                }
                if (!paints.length) {
                    continue;
                }
                // Only monochrome icons: multi-colour SVGs are logos and illustrations.
                const hexes = new Set(paints.map((p) => toHex(p.c)));
                if (hexes.size > 1) {
                    continue;
                }
                const fixed = ensureContrast(paints[0].c, bg, floor);
                if (fixed) {
                    for (const p of paints) {
                        addToken(tokens, p.el, p.kind, fixed);
                    }
                }
            }
            // Icon fonts and mask icons are usually empty elements.
            for (const el of document.querySelectorAll('span:empty, i:empty, div:empty, a:empty, button:empty')) {
                const cs = getComputedStyle(el);
                const mask = cs.maskImage || (cs as any).webkitMaskImage;
                if (!mask || mask === 'none') {
                    continue;
                }
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.width > ICON_MAX || r.height > ICON_MAX) {
                    continue;
                }
                const paint = parseColour(cs.backgroundColor);
                const bg = effectiveBackground(el.parentElement, bgCache, pageBg);
                if (!paint || !bg || paint.a === 0) {
                    continue;
                }
                const fixed = ensureContrast(paint, bg, floor);
                if (fixed) {
                    addToken(tokens, el, 'bg', fixed);
                }
            }
        }

        // 4. Icon rescue: small raster/SVG images and background-image glyphs.
        if (look.iconRescue) {
            for (const img of document.images) {
                const r = img.getBoundingClientRect();
                if (r.width < 8 || r.width > ICON_MAX || r.height > ICON_MAX || !inViewportBand(img)) {
                    continue;
                }
                const f = getComputedStyle(img).filter;
                if (f && f !== 'none' && img.getAttribute(ICON_ATTR) === null && img.getAttribute(KEEP_ATTR) === null && !(islands.size && inIsland(img))) {
                    continue; // something (a site fix) already handles it
                }
                const src = img.currentSrc || img.src;
                if (src) {
                    iconChecks.push({el: img, url: src, inIsland: islands.size > 0 && inIsland(img)});
                }
            }
            for (const el of document.querySelectorAll('[role=button], [role=checkbox], [role=menuitem], [role=tab], [role=link], button, a, [aria-label], [data-tooltip]')) {
                for (const target of [el, ...el.children]) {
                    const r = target.getBoundingClientRect();
                    if (r.width < 8 || r.width > ICON_MAX || r.height > ICON_MAX) {
                        continue;
                    }
                    const cs = getComputedStyle(target);
                    const url = cs.backgroundImage && cs.backgroundImage !== 'none' ? cssUrl(cs.backgroundImage) : null;
                    if (!url || url.startsWith('blob:')) {
                        continue;
                    }
                    if (cs.filter && cs.filter !== 'none' && target.getAttribute(ICON_ATTR) === null) {
                        continue;
                    }
                    iconChecks.push({el: target, url, inIsland: islands.size > 0 && inIsland(target)});
                }
            }
        }

        // 5. Image dim.
        if (look.imageDim < 100) {
            for (const el of document.querySelectorAll('img, video, picture > img')) {
                const r = el.getBoundingClientRect();
                if (r.width >= 120 && r.height >= 80) {
                    dims.push(el);
                }
            }
        }
    } finally {
        sheet.disabled = false;
        running = false;
    }

    // Write phase.
    const rules = new Set<string>();
    for (const el of document.querySelectorAll(`[${ATTR}]`)) {
        if (!tokens.has(el)) {
            el.removeAttribute(ATTR);
        }
    }
    for (const [el, set] of tokens) {
        const value = [...set].join(' ');
        if (el.getAttribute(ATTR) !== value) {
            el.setAttribute(ATTR, value);
        }
        set.forEach((t) => {
            const rule = tokenRule(t);
            if (rule) {
                rules.add(rule);
            }
        });
    }
    for (const el of document.querySelectorAll(`[${DARKEN_ATTR}]`)) {
        if (!islands.has(el)) {
            el.removeAttribute(DARKEN_ATTR);
        }
    }
    islands.forEach((el) => el.getAttribute(DARKEN_ATTR) === null && el.setAttribute(DARKEN_ATTR, ''));
    const dimSet = new Set(dims);
    for (const el of document.querySelectorAll(`[${DIM_ATTR}]`)) {
        if (!dimSet.has(el)) {
            el.removeAttribute(DIM_ATTR);
        }
    }
    dims.forEach((el) => el.setAttribute(DIM_ATTR, ''));
    sheet.textContent = `${staticRules(look)}\n${[...rules].join('\n')}`;
    stats = {contrastFixes: tokens.size, iconsRescued: document.querySelectorAll(`[${ICON_ATTR}]`).length};

    // Icon verdicts arrive asynchronously.
    const want = pageIsDark ? 'light' : 'dark';
    for (const {el, url, inIsland: island} of iconChecks) {
        void verdictFor(url).then((v) => {
            if (!options || !v || !v.mono) {
                return;
            }
            if (island) {
                // A glyph inside a darkened panel: let the panel's invert flip it to light.
                if (v.dark && el.getAttribute(KEEP_ATTR) === null) {
                    el.setAttribute(KEEP_ATTR, '');
                    stats.iconsRescued++;
                }
                return;
            }
            const needs = pageIsDark ? v.dark : v.light;
            if (needs && (v.transparent || el.tagName !== 'IMG')) {
                if (el.getAttribute(ICON_ATTR) !== want) {
                    el.setAttribute(ICON_ATTR, want);
                    stats.iconsRescued++;
                }
            }
        });
    }
    lastRun = Date.now();
}

function schedule(delay = 800) {
    if (timer !== undefined) {
        return;
    }
    const wait = Math.max(delay, 1000 - (Date.now() - lastRun));
    timer = window.setTimeout(() => {
        timer = undefined;
        const run = () => pass();
        if ('requestIdleCallback' in window) {
            requestIdleCallback(run, {timeout: 1500});
        } else {
            run();
        }
    }, wait);
}

function onMutations(records: MutationRecord[]) {
    for (const r of records) {
        if (r.type === 'childList' && r.addedNodes.length) {
            const own = [...r.addedNodes].every((n) => n instanceof Element && n.classList.contains('nightshade'));
            if (!own) {
                schedule();
                return;
            }
        }
        if (r.type === 'attributes' && ![ATTR, ICON_ATTR, DIM_ATTR, DARKEN_ATTR, KEEP_ATTR].includes(r.attributeName ?? '')) {
            schedule();
            return;
        }
    }
}

export function startBoosts(opts: Options): void {
    options = opts;
    const active = opts.look.contrastFloor > 0 || opts.look.iconRescue || opts.look.imageDim < 100 || Boolean(opts.darken?.length);
    if (!active) {
        stopBoosts();
        return;
    }
    if (!observer) {
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'aria-checked'],
        });
        if (!scrollHooked) {
            scrollHooked = true;
            addEventListener('scroll', () => options && schedule(400), {passive: true, capture: true});
        }
    }
    // Give Dark Reader a moment to finish its first render before reading colours.
    schedule(700);
}

export function stopBoosts(): void {
    options = null;
    observer?.disconnect();
    observer = null;
    if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
    }
    removeOwnStyle(STYLE_ID);
    for (const attr of [ATTR, ICON_ATTR, DIM_ATTR, DARKEN_ATTR, KEEP_ATTR]) {
        document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }
    stats = {contrastFixes: 0, iconsRescued: 0};
}


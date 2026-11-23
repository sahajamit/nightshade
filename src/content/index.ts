/**
 * Content script: runs at document_start in every frame. Asks the background worker which
 * rule applies, then renders one of five modes and starts the boosts layer.
 */
import {onBackgroundMessage, sendToBackground} from './native';
import * as DarkReader from 'darkreader';
import {adjustFilter, filterModeCSS, fixesCSS, paletteVars, textCSS} from '../shared/css';
import type {FetchResponse, PageState, ResolveResponse} from '../shared/messages';
import type {Fix, Mode} from '../shared/types';
import {boostStats, startBoosts, stopBoosts} from './boosts';
import {pageLooksDark} from './detect';
import {domReady, ownStyle, removeOwnStyle} from './dom';
import {startPicker} from './picker';

const isTop = (() => {
    try {
        return window.self === window.top;
    } catch {
        return false;
    }
})();

const FALLBACK = 'nightshade-fallback';
const MAIN = 'nightshade-main';

let drOn = false;
let state: PageState = {url: location.href, mode: 'off', reason: 'unlisted', matchedPattern: null, boosts: {contrastFixes: 0, iconsRescued: 0}};
let lastResponse: ResolveResponse | null = null;
let generation = 0;
/** Result of the one-time "is this page already dark?" check. undefined = not measured yet. */
let detected: boolean | null | undefined;

// --- Fallback: paint dark immediately so light pages don't flash while we resolve. ---
function addFallback(bg = '#181a1b') {
    const s = ownStyle(FALLBACK);
    s.textContent = `html, body { background-color: ${bg} !important; } html { color-scheme: dark !important; }`;
}
addFallback();

// --- Dark Reader needs a way to fetch cross-origin CSS and images. ---
DarkReader.setFetchMethod(async (url: string) => {
    // The background decides text or bytes from the response's content type.
    const res = (await sendToBackground<FetchResponse>({type: 'fetch', url}));
    if (!res || !res.ok) {
        throw new Error(`Nightshade could not fetch ${url}: ${res && !res.ok ? res.error : 'no response'}`);
    }
    if (res.text !== undefined) {
        return new Response(res.text, {headers: {'content-type': res.contentType}});
    }
    const bin = atob(res.base64 ?? '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return new Response(new Blob([bytes], {type: res.contentType}), {headers: {'content-type': res.contentType}});
});

function disableDR() {
    if (drOn) {
        DarkReader.disable();
        drOn = false;
    }
}

function report() {
    state = {...state, boosts: boostStats()};
    if (isTop) {
        void sendToBackground({type: 'pageState', state}).catch(() => undefined);
    }
}

function ownCSS(res: ResolveResponse, mode: Mode, pageIsDark: boolean): string {
    const {look, fixes} = res.resolved;
    const parts: string[] = [paletteVars(look.palette)];
    if (mode === 'native') {
        const f = adjustFilter(look);
        if (f && isTop) {
            parts.push(`html { filter: ${f} !important; }`);
        }
    }
    if (mode === 'filter') {
        parts.push(filterModeCSS(look, res.inversionFix, isTop));
    }
    if (mode === 'bespoke') {
        parts.push(`::selection { background: var(--ns-selection) !important; color: var(--ns-text) !important; }`);
    }
    parts.push(textCSS(look));
    parts.push(fixesCSS(fixes as Fix[], look.palette, pageIsDark));
    if (look.css) {
        parts.push(look.css);
    }
    return parts.filter(Boolean).join('\n');
}

async function apply(): Promise<void> {
    const gen = ++generation;
    let res: ResolveResponse;
    try {
        res = await sendToBackground({type: 'resolve', frameUrl: location.href, isTop});
    } catch (e) {
        console.warn('[nightshade] background unavailable:', e);
        removeOwnStyle(FALLBACK);
        return;
    }
    if (gen !== generation) {
        return;
    }
    if (!res?.resolved) {
        console.warn('[nightshade] could not resolve this page:', (res as any)?.error ?? res);
        removeOwnStyle(FALLBACK);
        return;
    }
    lastResponse = res;
    const r = res.resolved;
    let mode: Mode = r.mode;
    let reason: PageState['reason'] = r.reason;

    if (mode === 'off') {
        disableDR();
        stopBoosts();
        removeOwnStyle(MAIN);
        removeOwnStyle(FALLBACK);
        state = {url: location.href, mode, reason, matchedPattern: r.matchedPattern, boosts: {contrastFixes: 0, iconsRescued: 0}};
        report();
        return;
    }

    let pageIsDark = mode !== 'native';
    if (r.detectDark || mode === 'native') {
        // Native and unlisted sites need the page's own colours: read them with our styles off.
        await domReady();
        if (gen !== generation) {
            return;
        }
        // Measure once per page load: later re-applies would have to switch our styling off
        // to look, which would flash.
        if (detected === undefined) {
            disableDR();
            const fb = document.getElementById(FALLBACK) as HTMLStyleElement | null;
            const main = document.getElementById(MAIN) as HTMLStyleElement | null;
            if (fb) {
                fb.disabled = true;
            }
            if (main) {
                main.disabled = true;
            }
            detected = pageLooksDark(isTop);
            if (fb) {
                fb.disabled = false;
            }
            if (main) {
                main.disabled = false;
            }
        }
        const dark = detected;
        if (r.detectDark && dark === true) {
            mode = 'native';
            reason = 'detected-dark';
        }
        if (mode === 'native') {
            pageIsDark = dark !== false;
        }
    }

    if (mode === 'dynamic' || mode === 'bespoke') {
        const {look} = r;
        const palette = mode === 'bespoke' ? look.palette : null;
        DarkReader.enable({
            mode: 1,
            brightness: look.brightness,
            contrast: look.contrast,
            sepia: look.sepia,
            grayscale: look.grayscale,
            ...(palette ? {
                darkSchemeBackgroundColor: palette.bg,
                darkSchemeTextColor: palette.text,
                selectionColor: palette.selection,
            } : {}),
        }, res.dynamicFix ?? undefined);
        drOn = true;
    } else {
        disableDR();
    }

    ownStyle(MAIN).textContent = ownCSS(res, mode, pageIsDark);
    // Dark Reader paints its own background now; ours is no longer needed.
    removeOwnStyle(FALLBACK);

    if (mode === 'filter') {
        stopBoosts();
    } else {
        startBoosts({look: r.look, pageIsDark, darken: r.fixes.filter((f) => f.action === 'darken').map((f) => f.selector)});
    }
    state = {url: location.href, mode, reason, matchedPattern: r.matchedPattern, boosts: boostStats()};
    report();
}

// Re-apply when the config or a pause changes (popup, options page, CLI via the bridge).
// The service worker tells us; content scripts have no access to the extension's storage.
let pending: number | undefined;

// SPA navigations can change which path rule applies.
let lastHref = location.href;
setInterval(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        void apply();
    }
}, 1000);

onBackgroundMessage((msg, _sender, sendResponse) => {
    if (msg?.type === 'configChanged') {
        clearTimeout(pending);
        pending = window.setTimeout(() => void apply(), 30);
        return false;
    }
    if (msg?.type === 'getPageState') {
        if (!isTop) {
            return false;
        }
        sendResponse({...state, boosts: boostStats()});
        return false;
    }
    if (msg?.type === 'startPicker') {
        startPicker((_pattern, fix) => {
            // null pattern: the background picks the top page's site.
            const pattern = lastResponse?.resolved.matchedPattern ?? null;
            void sendToBackground({type: 'addFix', pattern, fix});
        }, Boolean(msg.fromContextMenu));
        sendResponse(true);
        return false;
    }
    return false;
});

void apply();
// Boost counts change after the first passes; refresh the popup's numbers.
setTimeout(report, 3000);

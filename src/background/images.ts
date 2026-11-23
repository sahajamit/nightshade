/** Fetching (for Dark Reader's cross-origin requests) and small-image analysis for Icon rescue. */
import type {FetchResponse, ImageVerdict} from '../shared/messages';
import {parseColour, rgbToHsl, luminance} from '../shared/color';
import {fetchKind, isHttpUrl} from '../shared/trust';

const MAX_BYTES = 8 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(s);
}

/**
 * Dark Reader asks for cross-origin stylesheets and images. The request comes from a content
 * script, so it is kept narrow: web URLs only, no cookies, and only CSS or image responses are
 * handed back. Anything else (HTML, JSON, a local service's API) is refused.
 */
export async function fetchForPage(url: string): Promise<FetchResponse> {
    if (!isHttpUrl(url)) {
        return {ok: false, error: 'unsupported URL'};
    }
    try {
        const res = await fetch(url, {credentials: 'omit', cache: 'force-cache'});
        if (!res.ok) {
            return {ok: false, error: `HTTP ${res.status}`};
        }
        const contentType = res.headers.get('content-type') ?? '';
        const as = fetchKind(contentType);
        if (!as) {
            return {ok: false, error: 'not a stylesheet or an image'};
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) {
            return {ok: false, error: 'too large'};
        }
        if (as === 'text') {
            return {ok: true, text: new TextDecoder().decode(buf), contentType};
        }
        return {ok: true, base64: toBase64(buf), contentType};
    } catch (e) {
        return {ok: false, error: String(e)};
    }
}

const verdicts = new Map<string, ImageVerdict | null>();
const MAX_CACHE = 800;

function remember(url: string, v: ImageVerdict | null) {
    if (verdicts.size >= MAX_CACHE) {
        verdicts.delete(verdicts.keys().next().value as string);
    }
    verdicts.set(url, v);
    return v;
}

/** SVG text heuristic: collect fill/stroke colours; icon if they are all dark or all light. */
function analyzeSvg(text: string): ImageVerdict | null {
    const colours = [...text.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|black|white)/gi)]
        .map((m) => m[1].toLowerCase())
        .map((c) => (c === 'black' ? '#000000' : c === 'white' ? '#ffffff' : c))
        .map((c) => parseColour(c))
        .filter(Boolean) as NonNullable<ReturnType<typeof parseColour>>[];
    // An SVG with no explicit fill paints black by default.
    if (colours.length === 0) {
        return {dark: true, light: false, transparent: true, mono: true};
    }
    const lums = colours.map(luminance);
    const sats = colours.map((c) => rgbToHsl(c).s);
    return {
        dark: lums.every((l) => l < 0.2),
        light: lums.every((l) => l > 0.6),
        transparent: true,
        mono: sats.every((s) => s < 0.25),
    };
}

async function analyzeBitmap(blob: Blob): Promise<ImageVerdict | null> {
    const bmp = await createImageBitmap(blob);
    const size = 32;
    const w = Math.min(size, bmp.width);
    const h = Math.min(size, bmp.height);
    if (w < 2 || h < 2) {
        return null;
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) {
        return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let transparent = 0;
    let dark = 0;
    let light = 0;
    let opaque = 0;
    let satSum = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        if (a < 0.05) {
            transparent++;
            continue;
        }
        opaque++;
        const c = {r: data[i], g: data[i + 1], b: data[i + 2], a: 1};
        const l = luminance(c);
        if (l < 0.18) {
            dark++;
        } else if (l > 0.55) {
            light++;
        }
        satSum += rgbToHsl(c).s;
    }
    const total = w * h;
    if (opaque === 0) {
        return {dark: false, light: false, transparent: true, mono: true};
    }
    return {
        dark: dark / opaque >= 0.7,
        light: light / opaque >= 0.7,
        transparent: transparent / total >= 0.1,
        mono: satSum / opaque < 0.25,
    };
}

export async function analyzeImage(url: string): Promise<ImageVerdict | null> {
    if (verdicts.has(url)) {
        return verdicts.get(url) ?? null;
    }
    if (!isHttpUrl(url)) {
        return null;
    }
    try {
        const res = await fetch(url, {credentials: 'omit', cache: 'force-cache'});
        if (!res.ok) {
            return remember(url, null);
        }
        const type = res.headers.get('content-type') ?? '';
        if (type.includes('svg') || /\.svg(\?|#|$)/i.test(url)) {
            return remember(url, analyzeSvg(await res.text()));
        }
        return remember(url, await analyzeBitmap(await res.blob()));
    } catch {
        return remember(url, null);
    }
}

export {analyzeSvg};

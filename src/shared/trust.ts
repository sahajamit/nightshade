/**
 * Who is allowed to send which message to the service worker.
 *
 * Web pages cannot reach chrome.runtime.onMessage (the manifest has no externally_connectable),
 * so every sender is either one of our extension pages (popup, options) or one of our content
 * scripts. Content scripts run inside web pages, so a compromised page process could forge their
 * messages. They are therefore limited to what rendering a page needs, and can never read or
 * rewrite the whole config.
 */
import {matchScore} from './match';

export type SenderKind = 'extension-page' | 'content-script' | 'unknown';

/** Messages a content script may send. Everything else needs an extension page. */
export const CONTENT_SCRIPT_MESSAGES: ReadonlySet<string> = new Set([
    'resolve', 'fetch', 'analyzeImage', 'pageState', 'addFix',
]);

export interface SenderLike {
    id?: string;
    url?: string;
    origin?: string;
    tab?: {url?: string};
}

/** `extensionOrigin` is "chrome-extension://<id>" (no trailing slash). */
export function senderKind(sender: SenderLike, extensionId: string, extensionOrigin: string): SenderKind {
    if (sender.id !== extensionId) {
        return 'unknown';
    }
    const url = sender.url ?? '';
    if (url === extensionOrigin || url.startsWith(`${extensionOrigin}/`)) {
        return 'extension-page';
    }
    return sender.tab ? 'content-script' : 'unknown';
}

export function mayHandle(type: unknown, kind: SenderKind): boolean {
    if (typeof type !== 'string') {
        return false;
    }
    if (kind === 'extension-page') {
        return true;
    }
    return kind === 'content-script' && CONTENT_SCRIPT_MESSAGES.has(type);
}

/** A content script may only add fixes to a rule that covers the page it runs in. */
export function patternCoversUrl(pattern: string, url: string | undefined): boolean {
    return Boolean(url) && matchScore(url!, pattern) >= 0;
}

/** Only web URLs are ever fetched on a page's behalf (never file:, chrome-extension:, data: and so on). */
export function isHttpUrl(url: unknown): url is string {
    if (typeof url !== 'string') {
        return false;
    }
    try {
        const p = new URL(url).protocol;
        return p === 'http:' || p === 'https:';
    } catch {
        return false;
    }
}

/** How a fetched response may be handed to a page: stylesheets as text, images as bytes, nothing else. */
export function fetchKind(contentType: string): 'text' | 'bytes' | null {
    const type = contentType.split(';')[0].trim().toLowerCase();
    if (type === 'text/css') {
        return 'text';
    }
    return type.startsWith('image/') ? 'bytes' : null;
}

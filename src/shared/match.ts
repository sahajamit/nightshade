/**
 * URL pattern matching for site rules.
 *
 *   example.com            the domain and every subdomain, any path
 *   www.example.com        that host and its subdomains
 *   *.example.com          subdomains only, not example.com itself
 *   example.com/inbox      path prefix on the domain (and subdomains)
 *
 * Patterns never include a protocol. A leading "http(s)://" is tolerated and stripped.
 */

export interface ParsedPattern {
    host: string;
    subdomainsOnly: boolean;
    path: string;
}

export function normalisePattern(pattern: string): string {
    let p = pattern.trim().toLowerCase();
    p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    p = p.replace(/\/+$/, '');
    return p;
}

export function parsePattern(pattern: string): ParsedPattern {
    const p = normalisePattern(pattern);
    const slash = p.indexOf('/');
    let host = slash === -1 ? p : p.slice(0, slash);
    const path = slash === -1 ? '' : p.slice(slash);
    let subdomainsOnly = false;
    if (host.startsWith('*.')) {
        subdomainsOnly = true;
        host = host.slice(2);
    }
    host = host.replace(/:\d+$/, '');
    return {host, subdomainsOnly, path};
}

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/** Returns a specificity score if the pattern matches the URL, otherwise -1. Higher is more specific. */
export function matchScore(url: string, pattern: string): number {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return -1;
    }
    const host = u.hostname.toLowerCase();
    const {host: ph, subdomainsOnly, path} = parsePattern(pattern);
    if (!ph) {
        return -1;
    }
    const exact = host === ph;
    const sub = host.endsWith('.' + ph);
    if (subdomainsOnly ? !sub : !(exact || sub)) {
        return -1;
    }
    if (path) {
        const p = u.pathname.toLowerCase();
        if (!(p === path || p.startsWith(path + '/'))) {
            return -1;
        }
    }
    const labels = ph.split('.').length;
    // Path specificity beats host specificity; an exact host beats a parent domain.
    return path.length * 1000 + labels * 10 + (exact ? 1 : 0);
}

/**
 * Default scope for a new rule created from the popup: the host without "www.".
 * Subdomains are kept on purpose (mail.google.com and docs.google.com need different rules).
 */
export function siteKeyForHost(host: string): string {
    return host.toLowerCase().replace(/^www\./, '');
}

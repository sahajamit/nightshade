import {describe, expect, it} from 'vitest';
import {fetchKind, isHttpUrl, mayHandle, patternCoversUrl, senderKind} from '../../src/shared/trust';

const ID = 'cilhiaedhodolblheagjkpjgfnananpf';
const ORIGIN = `chrome-extension://${ID}`;

describe('senderKind', () => {
    it('recognises the popup and the options page', () => {
        expect(senderKind({id: ID, url: `${ORIGIN}/popup.html`}, ID, ORIGIN)).toBe('extension-page');
        expect(senderKind({id: ID, url: `${ORIGIN}/options.html#agent`, tab: {url: `${ORIGIN}/options.html`}}, ID, ORIGIN)).toBe('extension-page');
    });
    it('treats a sender inside a web page as a content script', () => {
        expect(senderKind({id: ID, url: 'https://example.com/', tab: {url: 'https://example.com/'}}, ID, ORIGIN)).toBe('content-script');
    });
    it('is not fooled by a look-alike origin or another extension', () => {
        expect(senderKind({id: ID, url: `${ORIGIN}.evil.example/popup.html`, tab: {}}, ID, ORIGIN)).toBe('content-script');
        expect(senderKind({id: 'a'.repeat(32), url: `${ORIGIN}/popup.html`}, ID, ORIGIN)).toBe('unknown');
        expect(senderKind({id: ID, url: 'https://example.com/'}, ID, ORIGIN)).toBe('unknown');
    });
});

describe('mayHandle', () => {
    it('lets content scripts send only page-rendering messages', () => {
        for (const type of ['resolve', 'fetch', 'analyzeImage', 'pageState', 'addFix']) {
            expect(mayHandle(type, 'content-script')).toBe(true);
        }
        for (const type of ['getConfig', 'setConfig', 'updateSite', 'removeSite', 'pause', 'bridgeStatus', 'reconnectBridge']) {
            expect(mayHandle(type, 'content-script')).toBe(false);
            expect(mayHandle(type, 'extension-page')).toBe(true);
        }
    });
    it('refuses unknown senders and malformed messages', () => {
        expect(mayHandle('resolve', 'unknown')).toBe(false);
        expect(mayHandle(undefined, 'extension-page')).toBe(false);
    });
});

describe('patternCoversUrl', () => {
    it('accepts only patterns that match the page', () => {
        expect(patternCoversUrl('mail.example.com', 'https://mail.example.com/inbox')).toBe(true);
        expect(patternCoversUrl('example.com', 'https://mail.example.com/inbox')).toBe(true);
        expect(patternCoversUrl('bank.example', 'https://mail.example.com/inbox')).toBe(false);
        expect(patternCoversUrl('example.com', undefined)).toBe(false);
    });
});

describe('fetch limits', () => {
    it('allows web URLs only', () => {
        expect(isHttpUrl('https://cdn.example.com/a.css')).toBe(true);
        expect(isHttpUrl('http://127.0.0.1:8080/a.png')).toBe(true);
        for (const url of ['file:///etc/passwd', `${ORIGIN}/options.html`, 'data:text/css,a{}', 'javascript:alert(1)', 'not a url', 42]) {
            expect(isHttpUrl(url)).toBe(false);
        }
    });
    it('hands back stylesheets and images, nothing else', () => {
        expect(fetchKind('text/css; charset=utf-8')).toBe('text');
        expect(fetchKind('image/svg+xml')).toBe('bytes');
        expect(fetchKind('IMAGE/PNG')).toBe('bytes');
        expect(fetchKind('text/html')).toBeNull();
        expect(fetchKind('application/json')).toBeNull();
        expect(fetchKind('')).toBeNull();
    });
});

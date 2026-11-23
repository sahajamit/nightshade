import {describe, expect, it} from 'vitest';
import {matchScore, normalisePattern, siteKeyForHost} from '../../src/shared/match';

describe('matchScore', () => {
    it('matches a domain and its subdomains', () => {
        expect(matchScore('https://linkedin.com/feed', 'linkedin.com')).toBeGreaterThan(-1);
        expect(matchScore('https://www.linkedin.com/feed', 'linkedin.com')).toBeGreaterThan(-1);
        expect(matchScore('https://notlinkedin.com/', 'linkedin.com')).toBe(-1);
    });
    it('*.domain matches subdomains only', () => {
        expect(matchScore('https://a.sharepoint.com/', '*.sharepoint.com')).toBeGreaterThan(-1);
        expect(matchScore('https://sharepoint.com/', '*.sharepoint.com')).toBe(-1);
    });
    it('path patterns match on segment boundaries', () => {
        expect(matchScore('https://x.com/messages/1', 'x.com/messages')).toBeGreaterThan(-1);
        expect(matchScore('https://x.com/messagesfoo', 'x.com/messages')).toBe(-1);
    });
    it('more specific patterns score higher', () => {
        const url = 'https://mail.google.com/mail/u/0/';
        expect(matchScore(url, 'mail.google.com')).toBeGreaterThan(matchScore(url, 'google.com'));
        expect(matchScore(url, 'mail.google.com/mail')).toBeGreaterThan(matchScore(url, 'mail.google.com'));
    });
    it('normalises protocol, case and trailing slashes', () => {
        expect(normalisePattern('HTTPS://Example.com/')).toBe('example.com');
        expect(siteKeyForHost('www.linkedin.com')).toBe('linkedin.com');
        expect(siteKeyForHost('mail.google.com')).toBe('mail.google.com');
    });
});

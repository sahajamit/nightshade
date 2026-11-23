import type {Config, Fix, Resolved, SiteRule} from './types';
import type {DynamicFix, InversionFix} from './dr-fixes';

export const BRIDGE_HOST = 'dev.nightshade.bridge';

export interface ResolveResponse {
    resolved: Resolved;
    /** Dark Reader fix for dynamic/bespoke: community fix (if enabled) merged with the user's leave-untouched fixes. */
    dynamicFix: DynamicFix | null;
    inversionFix: InversionFix | null;
}

export interface ImageVerdict {
    /** Mostly dark opaque pixels. */
    dark: boolean;
    /** Mostly light opaque pixels. */
    light: boolean;
    /** At least 10% transparent pixels (icon-like). */
    transparent: boolean;
    /** Low colour saturation (a monochrome glyph, not a photo or logo). */
    mono: boolean;
}

export interface PageState {
    url: string;
    mode: Resolved['mode'];
    reason: Resolved['reason'] | 'detected-dark';
    matchedPattern: string | null;
    boosts: {contrastFixes: number; iconsRescued: number};
}

export interface BridgeStatus {
    state: 'connected' | 'not-installed' | 'disconnected' | 'connecting';
    path?: string;
    error?: string;
    lastSync?: string;
}

export type Request =
    | {type: 'resolve'; frameUrl: string; isTop: boolean}
    | {type: 'fetch'; url: string}
    | {type: 'analyzeImage'; url: string}
    | {type: 'pageState'; state: PageState}
    | {type: 'getConfig'}
    | {type: 'setConfig'; config: Config}
    | {type: 'updateSite'; pattern: string; patch: Partial<SiteRule>}
    | {type: 'removeSite'; pattern: string}
    | {type: 'addFix'; pattern: string | null; fix: Fix}
    | {type: 'pause'; host: string; minutes: number | null}
    | {type: 'bridgeStatus'}
    | {type: 'reconnectBridge'};

export type FetchResponse =
    | {ok: true; text?: string; base64?: string; contentType: string}
    | {ok: false; error: string};

export function send<T = unknown>(msg: Request): Promise<T> {
    return chrome.runtime.sendMessage(msg) as Promise<T>;
}

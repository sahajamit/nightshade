/** Config persistence in chrome.storage.local, with change fan-out to the agent bridge. */
import {defaultConfig, validateConfig} from '../shared/config';
import type {Config} from '../shared/types';

const KEY = 'config';
// Pauses live next to the config but are not part of it (they are per browser and temporary).
const PAUSE_KEY = 'paused';
let cache: Config | null = null;
const listeners = new Set<(c: Config, origin: Origin) => void>();

/** Where a change came from. Changes from the file must not be written back to it. */
export type Origin = 'ui' | 'bridge' | 'init';

export async function getConfig(): Promise<Config> {
    if (cache) {
        return cache;
    }
    const got = await chrome.storage.local.get(KEY);
    try {
        cache = got[KEY] ? validateConfig(got[KEY]) : defaultConfig();
    } catch (e) {
        console.warn('[nightshade] stored config invalid, using defaults', e);
        cache = defaultConfig();
    }
    return cache;
}

export async function saveConfig(config: Config, origin: Origin): Promise<Config> {
    const valid = validateConfig(config);
    cache = valid;
    await chrome.storage.local.set({[KEY]: valid});
    listeners.forEach((fn) => fn(valid, origin));
    return valid;
}

export function onConfigSaved(fn: (c: Config, origin: Origin) => void): void {
    listeners.add(fn);
}

// Content scripts run inside web pages, so they get no direct access to storage: they ask the
// service worker for the rule that applies to their page and are told when to ask again.
void chrome.storage.local.setAccessLevel?.({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => undefined);

async function notifyTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id !== undefined) {
            // No frameId: reaches every frame. Tabs without our content script reject; ignore.
            void chrome.tabs.sendMessage(tab.id, {type: 'configChanged'}).catch(() => undefined);
        }
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
        return;
    }
    if (changes[KEY]) {
        cache = null;
    }
    if (changes[KEY] || changes[PAUSE_KEY]) {
        void notifyTabs();
    }
});


export async function getPauses(): Promise<Record<string, number>> {
    const got = await chrome.storage.local.get(PAUSE_KEY);
    const all = (got[PAUSE_KEY] ?? {}) as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
}

export async function setPause(host: string, minutes: number | null): Promise<void> {
    const pauses = await getPauses();
    if (minutes === null) {
        delete pauses[host];
    } else {
        pauses[host] = Date.now() + minutes * 60_000;
        chrome.alarms.create(`unpause:${host}`, {when: pauses[host] + 500});
    }
    await chrome.storage.local.set({[PAUSE_KEY]: pauses});
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('unpause:')) {
        const pauses = await getPauses();
        await chrome.storage.local.set({[PAUSE_KEY]: pauses});
    }
});

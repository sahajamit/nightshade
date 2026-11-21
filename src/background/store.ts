/** Config persistence in chrome.storage.local, with change fan-out to the agent bridge. */
import {defaultConfig, validateConfig} from '../shared/config';
import type {Config} from '../shared/types';

const KEY = 'config';
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

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
        cache = null;
    }
});

// Pauses live next to the config but are not part of it (they are per browser and temporary).
const PAUSE_KEY = 'paused';

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

/**
 * Agent bridge: keeps chrome.storage in sync with ~/.nightshade/config.json through a
 * native messaging host (see src/bridge/host.ts). Optional. Without the host installed
 * the extension works on its own and the CLI's file can be imported from the options page.
 *
 * Reconcile rule: the newer `updatedAt` wins. File changes are pushed in by the host;
 * UI changes are written out to the file.
 */
import {BRIDGE_HOST, type BridgeStatus} from '../shared/messages';
import {validateConfig} from '../shared/config';
import type {Config} from '../shared/types';
import {getConfig, onConfigSaved, saveConfig} from './store';

let port: chrome.runtime.Port | null = null;
let status: BridgeStatus = {state: 'connecting'};
const RETRY_ALARM = 'bridge-retry';

type HostMessage =
    | {type: 'hello'; path: string; version: string}
    | {type: 'config'; config: unknown | null}
    | {type: 'error'; message: string}
    | {type: 'written'; updatedAt: string};

export function bridgeStatus(): BridgeStatus {
    return status;
}

function write(config: Config) {
    port?.postMessage({type: 'write', config});
}

async function onHostConfig(raw: unknown | null) {
    const mine = await getConfig();
    if (raw === null) {
        // No file yet: seed it from the extension.
        write(mine);
        return;
    }
    let incoming: Config;
    try {
        incoming = validateConfig(raw);
    } catch (e) {
        status = {...status, error: `Config file rejected: ${(e as Error).message}`};
        return;
    }
    status = {...status, error: undefined, lastSync: new Date().toISOString()};
    const a = Date.parse(incoming.updatedAt);
    const b = Date.parse(mine.updatedAt);
    if (a > b) {
        await saveConfig(incoming, 'bridge');
    } else if (b > a) {
        write(mine);
    }
}

export function connectBridge(): void {
    if (port) {
        return;
    }
    status = {state: 'connecting'};
    try {
        port = chrome.runtime.connectNative(BRIDGE_HOST);
    } catch (e) {
        status = {state: 'not-installed', error: String(e)};
        return;
    }
    port.onMessage.addListener((msg: HostMessage) => {
        if (msg.type === 'hello') {
            status = {state: 'connected', path: msg.path, lastSync: status.lastSync};
        } else if (msg.type === 'config') {
            void onHostConfig(msg.config);
        } else if (msg.type === 'error') {
            status = {...status, error: msg.message};
        } else if (msg.type === 'written') {
            status = {...status, lastSync: new Date().toISOString(), error: undefined};
        }
    });
    port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message ?? '';
        port = null;
        status = /not found|forbidden/i.test(err)
            ? {state: 'not-installed', error: err}
            : {state: 'disconnected', error: err || 'Bridge closed'};
        // Retry later: the user may install the bridge with `nightshade bridge install`.
        chrome.alarms.create(RETRY_ALARM, {delayInMinutes: status.state === 'not-installed' ? 5 : 1});
    });
    port.postMessage({type: 'hello'});
}

export function reconnectBridge(): void {
    port?.disconnect();
    port = null;
    connectBridge();
}

chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === RETRY_ALARM) {
        connectBridge();
    }
});

onConfigSaved((config, origin) => {
    if (origin === 'ui') {
        write(config);
    }
});

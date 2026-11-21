import dynamicFixesText from '../../vendor/darkreader/dynamic-theme-fixes.config';
import inversionFixesText from '../../vendor/darkreader/inversion-fixes.config';
import darkSitesText from '../../vendor/darkreader/dark-sites.config';
import {findRule, removeSite, resolve, upsertSite} from '../shared/config';
import {
    combineFixes, emptyFix, indexFixes, parseDarkSites, parseFixes, parseInversionFixes, siteFixFor,
    type FixIndex, type InversionFix,
} from '../shared/dr-fixes';
import {hostOf, matchScore, siteKeyForHost} from '../shared/match';
import type {PageState, Request, ResolveResponse} from '../shared/messages';
import {bridgeStatus, connectBridge, reconnectBridge} from './bridge';
import {analyzeImage, fetchForPage} from './images';
import {getConfig, getPauses, saveConfig, setPause} from './store';

// ---------------------------------------------------------------------------
// Dark Reader community data, parsed lazily once per service-worker lifetime.
// ---------------------------------------------------------------------------
let dynamicIndex: FixIndex | null = null;
let inversionIndex: FixIndex | null = null;
let darkSites: string[] | null = null;

function dyn(): FixIndex {
    return (dynamicIndex ??= indexFixes(parseFixes(dynamicFixesText)));
}
function inv(): FixIndex {
    return (inversionIndex ??= indexFixes(parseInversionFixes(inversionFixesText)));
}
function isKnownDark(url: string): boolean {
    darkSites ??= parseDarkSites(darkSitesText);
    return darkSites.some((p) => matchScore(url, p) >= 0);
}

async function handleResolve(frameUrl: string, isTop: boolean, tabUrl: string | undefined): Promise<ResolveResponse> {
    const config = await getConfig();
    // Rules follow the page in the address bar, so iframes inherit the top page's rule.
    const pageUrl = tabUrl || frameUrl;
    const pauses = await getPauses();
    const resolved = resolve(config, pageUrl, Boolean(pauses[siteKeyForHost(hostOf(pageUrl))]));

    if (resolved.reason === 'unlisted' && config.global.unlisted === 'skip-already-dark' && isKnownDark(pageUrl)) {
        resolved.mode = 'native';
        resolved.reason = 'known-dark';
        resolved.detectDark = false;
    }

    let dynamicFix = null;
    let inversionFix: InversionFix | null = null;
    if (resolved.mode === 'dynamic' || resolved.mode === 'bespoke' || resolved.detectDark) {
        const useBuiltIn = config.global.useBuiltInFixes;
        const untouched = resolved.fixes.filter((f) => f.action === 'leave-untouched').map((f) => f.selector);
        const userFix = untouched.length
            ? {...emptyFix(['user']), ignoreInlineStyle: untouched, ignoreImageAnalysis: untouched}
            : null;
        dynamicFix = combineFixes([
            useBuiltIn ? dyn().generic : null,
            useBuiltIn ? siteFixFor(dyn(), frameUrl) : null,
            userFix,
        ]);
        // The library injects an inline page-world script to watch CSSOM changes; from a content
        // script that is blocked by CSP. Turn it off and rely on its polling fallback instead.
        dynamicFix.disableStyleSheetsProxy = true;
        dynamicFix.disableCustomElementRegistryProxy = true;
    }
    if (resolved.mode === 'filter') {
        const generic = inv().generic as InversionFix | null;
        const site = siteFixFor(inv(), frameUrl) as InversionFix | null;
        inversionFix = generic || site ? {
            ...combineFixes([generic, site]),
            noinvert: [...(generic?.noinvert ?? []), ...(site?.noinvert ?? [])],
            removebg: [...(generic?.removebg ?? []), ...(site?.removebg ?? [])],
        } : null;
    }
    void isTop;
    return {resolved, dynamicFix, inversionFix};
}

// ---------------------------------------------------------------------------
// Toolbar icon reflects the top frame's state.
// ---------------------------------------------------------------------------
const pageStates = new Map<number, PageState>();

function iconFor(mode: PageState['mode']) {
    const v = mode === 'off' ? 'off' : mode === 'native' ? 'native' : 'on';
    return {16: `icons/${v}-16.png`, 32: `icons/${v}-32.png`, 48: `icons/${v}-48.png`};
}

function setTabIcon(tabId: number, state: PageState) {
    void chrome.action.setIcon({tabId, path: iconFor(state.mode)}).catch(() => undefined);
    const label = state.mode === 'off' ? 'off' : state.mode;
    void chrome.action.setTitle({tabId, title: `Nightshade: ${label} on ${hostOf(state.url)}`}).catch(() => undefined);
}

chrome.tabs.onRemoved.addListener((id) => pageStates.delete(id));

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
        case 'resolve':
            return handleResolve(msg.frameUrl, msg.isTop, sender.tab?.url);
        case 'fetch':
            return fetchForPage(msg.url, msg.as);
        case 'analyzeImage':
            return analyzeImage(msg.url);
        case 'pageState':
            if (sender.tab?.id !== undefined && sender.frameId === 0) {
                pageStates.set(sender.tab.id, msg.state);
                setTabIcon(sender.tab.id, msg.state);
            }
            return true;
        case 'getConfig':
            return getConfig();
        case 'setConfig':
            return saveConfig({...msg.config, updatedAt: new Date().toISOString()}, 'ui');
        case 'updateSite':
            return saveConfig(upsertSite(await getConfig(), msg.pattern, msg.patch), 'ui');
        case 'removeSite':
            return saveConfig(removeSite(await getConfig(), msg.pattern), 'ui');
        case 'addFix': {
            const config = await getConfig();
            const pattern = msg.pattern ?? siteKeyForHost(hostOf(sender.tab?.url ?? sender.url ?? ''));
            if (!pattern) {
                return null;
            }
            const existing = config.sites.find((s) => s.match.includes(pattern));
            const fixes = [...(existing?.fixes ?? []).filter((f) => f.selector !== msg.fix.selector), msg.fix];
            // A new rule keeps whatever the page shows now (an already-dark page stays native).
            const current = sender.tab?.id !== undefined ? pageStates.get(sender.tab.id)?.mode : undefined;
            const mode = existing?.mode ?? (current && current !== 'off' ? current : config.global.mode);
            return saveConfig(upsertSite(config, pattern, {fixes, mode}), 'ui');
        }
        case 'pause':
            await setPause(msg.host, msg.minutes);
            return true;
        case 'bridgeStatus':
            return bridgeStatus();
        case 'reconnectBridge':
            reconnectBridge();
            return bridgeStatus();
    }
    return null;
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
    handle(msg, sender).then(sendResponse, (e) => sendResponse({error: String(e?.message ?? e)}));
    return true;
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts and the context menu
// ---------------------------------------------------------------------------
async function toggleSite(tab: chrome.tabs.Tab) {
    if (!tab.url) {
        return;
    }
    const config = await getConfig();
    const found = findRule(config, tab.url);
    const state = tab.id !== undefined ? pageStates.get(tab.id) : undefined;
    const isOn = (state?.mode ?? found?.rule.mode ?? config.global.mode) !== 'off';
    const pattern = found?.pattern ?? siteKeyForHost(hostOf(tab.url));
    if (isOn) {
        await saveConfig(upsertSite(config, pattern, {mode: 'off'}), 'ui');
    } else if (found && found.rule.mode === 'off' && !found.rule.fixes?.length && !found.rule.css) {
        // The rule only existed to switch the site off: remove it and fall back to the default.
        await saveConfig(removeSite(config, pattern), 'ui');
    } else {
        await saveConfig(upsertSite(config, pattern, {mode: config.global.mode}), 'ui');
    }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
    const t = tab ?? (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    if (!t?.id) {
        return;
    }
    if (command === 'toggle-site') {
        await toggleSite(t);
    } else if (command === 'pick-element') {
        void chrome.tabs.sendMessage(t.id, {type: 'startPicker'}, {frameId: 0}).catch(() => undefined);
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({id: 'ns-fix', title: 'Nightshade: fix this element', contexts: ['all']});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'ns-fix' && tab?.id !== undefined) {
        void chrome.tabs.sendMessage(tab.id, {type: 'startPicker', fromContextMenu: true}, {frameId: info.frameId ?? 0})
            .catch(() => undefined);
    }
});

connectBridge();

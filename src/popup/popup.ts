import {findRule, resolve} from '../shared/config';
import {hostOf, siteKeyForHost} from '../shared/match';
import type {BridgeStatus, PageState} from '../shared/messages';
import type {Config, ContrastFloor, Mode, SiteRule} from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const HELP: Record<Mode, string> = {
    off: 'Nightshade does nothing here. The page looks exactly as the site made it.',
    native: "Keeps the site's own dark theme. Only the boosts run: contrast floor, icon rescue, dimming.",
    dynamic: "Dark Reader's colour engine recolours the page, with these sliders.",
    filter: 'Inverts the whole page and restores images. Fast. Best for Google Docs and canvas apps.',
    bespoke: 'Dynamic with your own palette. Palette colours are available to custom CSS as var(--ns-*).',
};

const REASON: Record<string, string> = {
    'rule': 'Rule',
    'unlisted': 'No rule · default',
    'known-dark': 'No rule · site is dark already',
    'detected-dark': 'No rule · page is dark already',
    'disabled': 'Nightshade is switched off everywhere',
    'paused': 'Paused',
    'only-listed': 'No rule · only listed sites are changed',
};

let tab: chrome.tabs.Tab;
let config: Config;
let page: PageState | null = null;

function currentRule(): {rule: SiteRule; pattern: string} | null {
    const f = tab.url ? findRule(config, tab.url) : null;
    return f ? {rule: f.rule, pattern: f.pattern} : null;
}

function patternForEdit(): string {
    return currentRule()?.pattern ?? siteKeyForHost(hostOf(tab.url ?? ''));
}

function effectiveMode(): Mode {
    return page?.mode ?? resolve(config, tab.url ?? '').mode;
}

async function update(patch: Partial<SiteRule>) {
    const existing = currentRule();
    // A slider change on an unlisted site creates a rule that keeps what the page shows now.
    const base: Partial<SiteRule> = existing ? {} : {mode: effectiveMode() === 'off' ? config.global.mode : effectiveMode()};
    config = await chrome.runtime.sendMessage({type: 'updateSite', pattern: patternForEdit(), patch: {...base, ...patch}});
    page = null;
    render();
    setTimeout(refreshPage, 400);
}

function render() {
    const r = resolve(config, tab.url ?? '');
    const rule = currentRule();
    const mode = effectiveMode();
    $('host').textContent = hostOf(tab.url ?? '');
    const reason = page?.reason ?? r.reason;
    $('scope').textContent = reason === 'rule' && rule ? `Rule: ${rule.pattern}` : REASON[reason] ?? '';
    $('enabled').setAttribute('aria-checked', String(mode !== 'off'));
    document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
    $('help').textContent = HELP[mode];
    const look = r.look;
    for (const id of ['brightness', 'contrast', 'sepia', 'imageDim'] as const) {
        const input = $<HTMLInputElement>(id);
        if (document.activeElement !== input) {
            input.value = String(look[id]);
        }
        (input.nextElementSibling as HTMLOutputElement).value = `${input.value}%`;
    }
    $('sliders').hidden = mode === 'off';
    $<HTMLSelectElement>('floor').value = String(look.contrastFloor);
    $('icons').setAttribute('aria-pressed', String(look.iconRescue));
    const pal = $<HTMLSelectElement>('palette');
    pal.replaceChildren(...Object.keys(config.palettes).map((n) => new Option(n, n)));
    pal.value = look.paletteName;
    $('paletteRow').hidden = mode !== 'bespoke';
    $('reset').hidden = !rule;
    $('pause').textContent = reason === 'paused' ? 'Resume' : 'Pause 1 hour';
    const b = page?.boosts;
    $('stats').textContent = b && mode !== 'off' && mode !== 'filter'
        ? `Contrast fixes on this page: ${b.contrastFixes} · Icons rescued: ${b.iconsRescued}`
        : '';
}

async function refreshPage() {
    try {
        page = await chrome.tabs.sendMessage(tab.id!, {type: 'getPageState'}, {frameId: 0});
    } catch {
        page = null;
    }
    render();
}

async function renderBridge() {
    const s: BridgeStatus = await chrome.runtime.sendMessage({type: 'bridgeStatus'});
    const el = $('bridge');
    // Built with DOM nodes, not markup: the error text can quote the config file.
    const show = (dot: string, text: string, title: string) => {
        const span = document.createElement('span');
        span.className = `dot ${dot}`.trim();
        el.replaceChildren(span, text);
        el.title = title;
    };
    if (s.state === 'connected' && s.error) {
        show('bad', s.error, s.path ?? '');
    } else if (s.state === 'connected') {
        show('ok', 'Agent bridge connected', s.path ?? '');
    } else if (s.state === 'not-installed') {
        show('', 'Agent bridge not installed', 'Run: nightshade bridge install');
    } else {
        show('warn', `Agent bridge ${s.state}`, s.error ?? '');
    }
}

let sliderTimer: number | undefined;

async function main() {
    // ?tab=<id> lets the popup be opened as a page for a given tab (tests, screenshots).
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({active: true, currentWindow: true});
    const url = tab?.url ?? '';
    if (!/^(https?|file):/.test(url) || /^https:\/\/chromewebstore\.google\.com|^https:\/\/chrome\.google\.com\/webstore/.test(url)) {
        $('blocked').hidden = false;
        return;
    }
    $('app').hidden = false;
    if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
        $<HTMLImageElement>('fav').src = tab.favIconUrl;
    }
    config = await chrome.runtime.sendMessage({type: 'getConfig'});
    render();
    void refreshPage();
    // Boost counts settle a second or two after the page loads.
    setTimeout(refreshPage, 1500);
    void renderBridge();

    $('enabled').addEventListener('click', () => {
        const on = effectiveMode() !== 'off';
        const rule = currentRule()?.rule;
        void update({mode: on ? 'off' : rule && rule.mode !== 'off' ? rule.mode : config.global.mode});
    });
    $('modes').addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>('button[data-mode]');
        if (b) {
            void update({mode: b.dataset.mode as Mode});
        }
    });
    for (const id of ['brightness', 'contrast', 'sepia', 'imageDim'] as const) {
        const input = $<HTMLInputElement>(id);
        input.addEventListener('input', () => {
            (input.nextElementSibling as HTMLOutputElement).value = `${input.value}%`;
            clearTimeout(sliderTimer);
            sliderTimer = window.setTimeout(() => void update({[id]: Number(input.value)}), 180);
        });
    }
    $('floor').addEventListener('change', () => void update({contrastFloor: Number($<HTMLSelectElement>('floor').value) as ContrastFloor}));
    $('icons').addEventListener('click', () => void update({iconRescue: $('icons').getAttribute('aria-pressed') !== 'true'}));
    $('palette').addEventListener('change', () => void update({palette: $<HTMLSelectElement>('palette').value}));
    $('pick').addEventListener('click', async () => {
        await chrome.tabs.sendMessage(tab.id!, {type: 'startPicker'}, {frameId: 0}).catch(() => undefined);
        window.close();
    });
    $('pause').addEventListener('click', async () => {
        const paused = (page?.reason ?? resolve(config, url).reason) === 'paused';
        await chrome.runtime.sendMessage({type: 'pause', host: siteKeyForHost(hostOf(url)), minutes: paused ? null : 60});
        window.close();
    });
    $('reset').addEventListener('click', async () => {
        const rule = currentRule();
        if (rule) {
            config = await chrome.runtime.sendMessage({type: 'removeSite', pattern: rule.pattern});
            page = null;
            render();
            setTimeout(refreshPage, 400);
        }
    });
    $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

void main();

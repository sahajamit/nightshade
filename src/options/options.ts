import {DEFAULT_PALETTES, validateConfig} from '../shared/config';
import type {BridgeStatus} from '../shared/messages';
import {MODES, PALETTE_KEYS, type Config, type Mode} from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let config: Config;
let bridgeTimer: number | undefined;

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
}

function msg(id: string, text: string, ok = true) {
    const el = $(id);
    el.textContent = text;
    el.className = `msg ${ok ? 'ok' : 'bad'}`;
}

async function save(next: Config, msgId: string, okText = 'Saved.') {
    try {
        validateConfig(next);
        config = await chrome.runtime.sendMessage({type: 'setConfig', config: next});
        if ((config as any)?.error) {
            throw new Error((config as any).error);
        }
        msg(msgId, okText);
        renderAll();
    } catch (e) {
        msg(msgId, (e as Error).message, false);
        config = await chrome.runtime.sendMessage({type: 'getConfig'});
    }
}

function boostsText(r: Config['sites'][number]): string {
    const parts: string[] = [];
    if (r.contrastFloor !== undefined) {
        parts.push(r.contrastFloor ? `floor ${r.contrastFloor}:1` : 'floor off');
    }
    if (r.iconRescue !== undefined) {
        parts.push(r.iconRescue ? 'icons' : 'no icons');
    }
    for (const k of ['brightness', 'contrast', 'sepia', 'imageDim'] as const) {
        if (r[k] !== undefined) {
            parts.push(`${k} ${r[k]}`);
        }
    }
    if (r.palette) {
        parts.push(`palette ${r.palette}`);
    }
    if (r.css) {
        parts.push('custom CSS');
    }
    return parts.join(' · ') || 'defaults';
}

function renderSites() {
    $('sites').innerHTML = config.sites.map((r, i) => `<tr>
  <td class="mono">${r.match.map(esc).join('<br>')}</td>
  <td><select data-i="${i}" class="modeSel" aria-label="Mode for ${esc(r.match[0])}">${MODES.map((m) => `<option ${m === r.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></td>
  <td class="muted">${esc(boostsText(r))}</td>
  <td>${r.fixes?.length ? `<details><summary>${r.fixes.length}</summary>${r.fixes.map((f, j) => `<div class="mono" style="font-size:11.5px;margin:4px 0">${esc(f.action)} ${esc(f.selector)}${f.colour ? ` ${esc(f.colour)}` : ''} <button type="button" class="btn" data-i="${i}" data-fix="${j}" style="padding:1px 6px">×</button></div>`).join('')}</details>` : '<span class="muted">0</span>'}</td>
  <td class="muted">${esc(r.note ?? '')}</td>
  <td><button type="button" class="btn danger" data-del="${i}">Remove</button></td>
</tr>`).join('') || '<tr><td colspan="6" class="muted">No site rules yet.</td></tr>';
}

function renderGlobal() {
    const g = config.global as any;
    $<HTMLSelectElement>('g-palette').innerHTML = Object.keys(config.palettes).map((n) => `<option>${esc(n)}</option>`).join('');
    for (const k of ['enabled', 'unlisted', 'mode', 'palette', 'brightness', 'contrast', 'sepia', 'grayscale', 'contrastFloor', 'iconRescue', 'imageDim', 'fontFamily', 'useBuiltInFixes']) {
        const el = $<HTMLInputElement | HTMLSelectElement>(`g-${k}`);
        el.value = String(g[k]);
    }
}

function renderPalettes() {
    $('palettes').innerHTML = Object.entries(config.palettes).map(([name, p]) => `<div class="card" data-name="${esc(name)}">
  <strong>${esc(name)}</strong>${DEFAULT_PALETTES[name] ? ' <span class="muted">(built in)</span>' : ''}
  ${PALETTE_KEYS.map((k) => `<div class="tok"><label for="p-${esc(name)}-${k}">${k}</label><input type="color" id="p-${esc(name)}-${k}" data-key="${k}" value="${p[k].slice(0, 7)}"></div>`).join('')}
</div>`).join('');
}

function renderJson() {
    $<HTMLTextAreaElement>('json').value = JSON.stringify(config, null, 2);
}

async function renderBridge() {
    const s: BridgeStatus = await chrome.runtime.sendMessage({type: 'bridgeStatus'});
    const text = s.state === 'connected'
        ? `<span class="dot ok"></span>Connected to <span class="mono">${esc(s.path ?? '')}</span>${s.lastSync ? ` · last sync ${new Date(s.lastSync).toLocaleTimeString()}` : ''}`
        : s.state === 'not-installed'
            ? '<span class="dot"></span>Not installed. Run <span class="mono">nightshade bridge install</span>, then Reconnect.'
            : `<span class="dot warn"></span>${esc(s.state)}`;
    $('bridgeState').innerHTML = text + (s.error ? `<br><span class="msg bad">${esc(s.error)}</span>` : '');
    $('extId').textContent = chrome.runtime.id;
}

function renderAll() {
    renderSites();
    renderGlobal();
    renderPalettes();
    renderJson();
}

function showTab(name: string) {
    document.querySelectorAll<HTMLButtonElement>('nav button[data-tab]').forEach((b) => {
        if (b.dataset.tab === name) {
            b.setAttribute('aria-current', 'page');
        } else {
            b.removeAttribute('aria-current');
        }
    });
    document.querySelectorAll<HTMLElement>('main > section').forEach((s) => {
        s.hidden = s.id !== `tab-${name}`;
    });
    clearInterval(bridgeTimer);
    if (name === 'agent') {
        void renderBridge();
        bridgeTimer = window.setInterval(renderBridge, 1500);
    }
    history.replaceState(null, '', `#${name}`);
}

async function main() {
    config = await chrome.runtime.sendMessage({type: 'getConfig'});
    renderAll();
    showTab(location.hash.slice(1) || 'sites');

    document.querySelector('nav')!.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>('button[data-tab]');
        if (b) {
            showTab(b.dataset.tab!);
        }
    });

    $('addSite').addEventListener('click', () => {
        const pattern = $<HTMLInputElement>('newPattern').value.trim();
        if (!pattern) {
            msg('sitesMsg', 'Type a site first, like example.com.', false);
            return;
        }
        const next = structuredClone(config);
        next.sites.push({match: [pattern], mode: $<HTMLSelectElement>('newMode').value as Mode});
        $<HTMLInputElement>('newPattern').value = '';
        void save(next, 'sitesMsg', `Added ${pattern}.`);
    });
    $('sites').addEventListener('change', (e) => {
        const sel = e.target as HTMLSelectElement;
        if (sel.classList.contains('modeSel')) {
            const next = structuredClone(config);
            next.sites[Number(sel.dataset.i)].mode = sel.value as Mode;
            void save(next, 'sitesMsg');
        }
    });
    $('sites').addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>('button');
        if (!b) {
            return;
        }
        const next = structuredClone(config);
        if (b.dataset.del !== undefined) {
            const [removed] = next.sites.splice(Number(b.dataset.del), 1);
            void save(next, 'sitesMsg', `Removed ${removed.match[0]}.`);
        } else if (b.dataset.fix !== undefined) {
            const rule = next.sites[Number(b.dataset.i)];
            rule.fixes = rule.fixes?.filter((_, j) => j !== Number(b.dataset.fix));
            if (!rule.fixes?.length) {
                delete rule.fixes;
            }
            void save(next, 'sitesMsg', 'Fix removed.');
        }
    });

    $('saveGlobal').addEventListener('click', () => {
        const next = structuredClone(config);
        const g = next.global as any;
        const val = (k: string) => $<HTMLInputElement>(`g-${k}`).value;
        g.enabled = val('enabled') === 'true';
        g.unlisted = val('unlisted');
        g.mode = val('mode');
        g.palette = val('palette');
        for (const k of ['brightness', 'contrast', 'sepia', 'grayscale', 'imageDim']) {
            g[k] = Number(val(k));
        }
        g.contrastFloor = Number(val('contrastFloor'));
        g.iconRescue = val('iconRescue') === 'true';
        g.fontFamily = val('fontFamily').trim();
        g.useBuiltInFixes = val('useBuiltInFixes') === 'true';
        void save(next, 'globalMsg');
    });

    $('palettes').addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const card = input.closest<HTMLElement>('.card');
        if (!card) {
            return;
        }
        const next = structuredClone(config);
        (next.palettes[card.dataset.name!] as any)[input.dataset.key!] = input.value;
        void save(next, 'palMsg');
    });
    $('addPalette').addEventListener('click', () => {
        const name = $<HTMLInputElement>('newPalette').value.trim().toLowerCase();
        const next = structuredClone(config);
        next.palettes[name] = {...config.palettes[config.global.palette] ?? DEFAULT_PALETTES.default};
        void save(next, 'palMsg', `Added palette ${name}.`);
    });

    $('saveJson').addEventListener('click', () => {
        let parsed: Config;
        try {
            parsed = JSON.parse($<HTMLTextAreaElement>('json').value);
        } catch (e) {
            msg('jsonMsg', `Not valid JSON: ${(e as Error).message}`, false);
            return;
        }
        void save(parsed, 'jsonMsg');
    });
    $('exportJson').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'nightshade.config.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('importJson').addEventListener('change', async () => {
        const file = $<HTMLInputElement>('importJson').files?.[0];
        if (!file) {
            return;
        }
        try {
            const parsed = JSON.parse(await file.text());
            void save(parsed, 'jsonMsg', `Imported ${file.name}.`);
        } catch (e) {
            msg('jsonMsg', `Could not read ${file.name}: ${(e as Error).message}`, false);
        }
    });
    $('reconnect').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({type: 'reconnectBridge'});
        setTimeout(renderBridge, 600);
    });

    chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area === 'local' && changes.config) {
            config = await chrome.runtime.sendMessage({type: 'getConfig'});
            if (document.activeElement?.id !== 'json') {
                renderAll();
            }
        }
    });
}

void main();

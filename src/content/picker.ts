/**
 * "Fix an element": hover to highlight, click to choose, pick an action. The fix is saved
 * into the site rule with a selector that prefers roles and labels over generated classes.
 */
import type {Fix, FixAction} from '../shared/types';

const HOST_ID = 'nightshade-picker';
let active = false;
let lastContextTarget: Element | null = null;

addEventListener('contextmenu', (e) => {
    lastContextTarget = e.target instanceof Element ? e.target : null;
}, true);

const ACTIONS: Array<{action: FixAction; label: string; key: string}> = [
    {action: 'make-visible', label: 'Make it visible', key: '1'},
    {action: 'invert', label: 'Invert it', key: '2'},
    {action: 'set-colour', label: 'Set colour', key: '3'},
    {action: 'strengthen-border', label: 'Strengthen border', key: '4'},
    {action: 'leave-untouched', label: 'Leave untouched', key: '5'},
    {action: 'hide', label: 'Hide it', key: '6'},
];

function looksGenerated(token: string): boolean {
    // Hashed or minified names: digit runs, letter+digit mixes, CSS-in-JS prefixes, or
    // short mixed-case gibberish like "aXz9Q" / "T-I-KE".
    if (/^(css|sc|jsx|emotion|styled)-|^_|__[a-z0-9]{5,}$/i.test(token)) {
        return true;
    }
    if (/\d{3,}/.test(token) || /[a-z]\d|\d[a-z]/i.test(token)) {
        return true;
    }
    return token.length <= 6 && /[a-z]/.test(token) && /[A-Z]/.test(token);
}

/** Unique fallback: a short :nth-of-type path from the nearest element with a usable id. */
function pathSelector(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && node !== document.documentElement && parts.length < 6) {
        if (node.id && !looksGenerated(node.id)) {
            parts.unshift(`#${CSS.escape(node.id)}`);
            return parts.join(' > ');
        }
        const tag = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        const same = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
        node = parent;
    }
    return parts.join(' > ');
}

function esc(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function count(sel: string): number {
    try {
        return document.querySelectorAll(sel).length;
    } catch {
        return 0;
    }
}

/** A selector for exactly-this-kind-of element. */
export function selectorFor(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const label = el.getAttribute('aria-label');
    const role = el.getAttribute('role');
    const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
    if (label && label.length <= 60) {
        const s = `${role ? `[role="${esc(role)}"]` : tag}[aria-label="${esc(label)}"]`;
        if (count(s) >= 1) {
            return s;
        }
    }
    if (testId) {
        return `[data-testid="${esc(testId)}"]`;
    }
    if (el.id && !looksGenerated(el.id) && count(`#${CSS.escape(el.id)}`) === 1) {
        return `#${CSS.escape(el.id)}`;
    }
    if (role && !['presentation', 'none', 'generic'].includes(role)) {
        return `${tag}[role="${esc(role)}"]`;
    }
    const classes = [...el.classList].filter((c) => !looksGenerated(c) && !c.startsWith('ns-')).slice(0, 2);
    const own = tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
    if (classes.length && count(own) <= 40) {
        return own;
    }
    // Anchor on the nearest labelled ancestor.
    let p = el.parentElement;
    for (let depth = 0; p && depth < 4; depth++, p = p.parentElement) {
        const pl = p.getAttribute('aria-label');
        const pr = p.getAttribute('role');
        if (pl && pl.length <= 60) {
            return `[aria-label="${esc(pl)}"] ${own}`;
        }
        if (pr && !['presentation', 'none', 'generic'].includes(pr)) {
            return `[role="${esc(pr)}"] ${own}`;
        }
    }
    return pathSelector(el);
}

function stop() {
    active = false;
    document.getElementById(HOST_ID)?.remove();
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', onKey, true);
}

let hovered: Element | null = null;
let root: ShadowRoot | null = null;
let onPick: ((pattern: string | null, fix: Fix) => void) | null = null;

function ui(): ShadowRoot {
    let host = document.getElementById(HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.className = 'nightshade';
        host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
        root = host.attachShadow({mode: 'open'});
        root.innerHTML = `<style>
  :host { color-scheme: dark; }
  [hidden] { display: none !important; }
  .box { position: fixed; outline: 2px dashed #e2a75c; outline-offset: 2px; border-radius: 3px; background: rgba(226,167,92,.08); pointer-events: none; transition: all 60ms; }
  .tag { position: fixed; font: 11px/1.4 ui-monospace, Menlo, monospace; background: #e2a75c; color: #1a1408; padding: 2px 6px; border-radius: 3px; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  .hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); font: 13px/1.4 system-ui, sans-serif; background: #16181b; color: #e6e1d7; border: 1px solid #2c3036; padding: 8px 14px; border-radius: 8px; pointer-events: none; }
  .menu { position: fixed; width: 290px; background: #1b1e22; color: #e6e1d7; border: 1px solid #3a3f46; border-radius: 10px; padding: 8px; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 14px 36px rgba(0,0,0,.5); pointer-events: auto; }
  .menu label { display: block; font: 10.5px ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: #8f897f; margin: 2px 4px 4px; }
  .menu input[type=text] { width: 100%; box-sizing: border-box; background: #101215; color: #e6e1d7; border: 1px solid #343940; border-radius: 6px; padding: 6px 8px; font: 12px ui-monospace, Menlo, monospace; }
  .menu .n { font-size: 11.5px; color: #8f897f; margin: 4px 4px 6px; }
  .menu button { display: flex; justify-content: space-between; width: 100%; background: none; border: 0; color: inherit; font: inherit; text-align: left; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: #2b2f35; outline: none; }
  .menu kbd { font: 11px ui-monospace, Menlo, monospace; color: #8f897f; }
  .menu .row { display: flex; gap: 6px; align-items: center; padding: 4px 8px; }
  .menu input[type=color] { width: 34px; height: 24px; border: 0; background: none; padding: 0; }
</style><div class="box" hidden></div><div class="tag" hidden></div><div class="hint">Nightshade: click the element to fix. Esc to cancel.</div>`;
        document.documentElement.appendChild(host);
    }
    return root!;
}

function highlight(el: Element | null) {
    const r = ui();
    const box = r.querySelector<HTMLElement>('.box')!;
    const tag = r.querySelector<HTMLElement>('.tag')!;
    if (!el) {
        box.hidden = true;
        tag.hidden = true;
        return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    box.hidden = false;
    tag.textContent = `${selectorFor(el)} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    Object.assign(tag.style, {left: `${Math.max(4, rect.left)}px`, top: `${Math.max(4, rect.top - 22)}px`});
    tag.hidden = false;
}

function isOurs(el: Element | null): boolean {
    return Boolean(el?.closest(`#${HOST_ID}`));
}

function onMove(e: MouseEvent) {
    if (root?.querySelector('.menu')) {
        return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && !isOurs(el) && el !== hovered) {
        hovered = el;
        highlight(el);
    }
}

function onClick(e: MouseEvent) {
    if (isOurs(e.target as Element) || e.composedPath().some((n) => n instanceof Element && n.id === HOST_ID)) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (hovered) {
        openMenu(hovered);
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.preventDefault();
        stop();
    }
}

function openMenu(el: Element) {
    const r = ui();
    r.querySelector('.menu')?.remove();
    r.querySelector<HTMLElement>('.hint')!.hidden = true;
    highlight(el);
    const rect = el.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Fix this element');
    const sel = selectorFor(el);
    menu.innerHTML = `<label for="ns-sel">Selector (editable)</label>
<input type="text" id="ns-sel" spellcheck="false">
<div class="n"></div>
${ACTIONS.map((a) => `<button type="button" data-action="${a.action}"><span>${a.label}</span><kbd>${a.key}</kbd></button>`).join('')}
<div class="row" hidden><input type="color" id="ns-col" value="#cfc9bf"><button type="button" data-apply-colour>Apply colour</button></div>
<button type="button" data-cancel><span>Cancel</span><kbd>Esc</kbd></button>`;
    const input = menu.querySelector<HTMLInputElement>('#ns-sel')!;
    const note = menu.querySelector<HTMLElement>('.n')!;
    input.value = sel;
    const updateCount = () => {
        const n = count(input.value);
        note.textContent = n ? `Matches ${n} element${n === 1 ? '' : 's'} on this page.` : 'Selector matches nothing.';
    };
    input.addEventListener('input', updateCount);
    updateCount();
    const left = Math.min(Math.max(8, rect.left), innerWidth - 300);
    const top = rect.bottom + 8 + 330 < innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 338);
    Object.assign(menu.style, {left: `${left}px`, top: `${top}px`});
    const finish = (action: FixAction, colour?: string) => {
        const selector = input.value.trim();
        if (!selector || !count(selector)) {
            note.textContent = 'Fix the selector first: it matches nothing.';
            return;
        }
        onPick?.(null, {selector, action, ...(colour ? {colour} : {})});
        stop();
    };
    menu.addEventListener('click', (e) => {
        const b = (e.target as Element).closest('button');
        if (!b) {
            return;
        }
        if (b.hasAttribute('data-cancel')) {
            stop();
        } else if (b.hasAttribute('data-apply-colour')) {
            finish('set-colour', menu.querySelector<HTMLInputElement>('#ns-col')!.value);
        } else if (b.dataset.action === 'set-colour') {
            menu.querySelector<HTMLElement>('.row')!.hidden = false;
        } else if (b.dataset.action) {
            finish(b.dataset.action as FixAction);
        }
    });
    menu.addEventListener('keydown', (e) => {
        if (e.target === input) {
            return;
        }
        const a = ACTIONS.find((x) => x.key === e.key);
        if (a) {
            e.preventDefault();
            (menu.querySelector(`[data-action="${a.action}"]`) as HTMLButtonElement).click();
        }
    });
    r.appendChild(menu);
    (menu.querySelector('button') as HTMLButtonElement).focus();
}

export function startPicker(save: (pattern: string | null, fix: Fix) => void, fromContextMenu = false): void {
    onPick = save;
    if (active) {
        return;
    }
    active = true;
    ui();
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);
    if (fromContextMenu && lastContextTarget) {
        hovered = lastContextTarget;
        openMenu(lastContextTarget);
    }
}

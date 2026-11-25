/**
 * nightshade: command-line control for the Nightshade extension.
 *
 * Edits ~/.nightshade/config.json. With the bridge installed, open Chrome tabs pick up each
 * change within about a second. Designed to be driven by people and AI agents alike:
 * every command is non-interactive, validates before writing, and supports --json output.
 */
import {accessSync, chmodSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, platform} from 'node:os';
import {dirname, join, resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultConfig, findRule, removeSite, resolve, upsertSite, validateConfig, ConfigError} from '../shared/config';
import {normalisePattern} from '../shared/match';
import {
    CONTRAST_FLOORS, FIX_ACTIONS, MODES, PALETTE_KEYS, UNLISTED,
    type Config, type ContrastFloor, type Fix, type FixAction, type Mode, type SiteRule,
} from '../shared/types';
import {configPath, isExtensionId, nightshadeDir, readRaw, shellQuote, writeConfig} from './file';
import {describeChanges, diffConfigs, type Change} from './changes';
import {dropEntry, HISTORY_LIMIT, listHistory, planUndo, recordChange} from './history';
import {BRIDGE_HOST} from '../shared/messages';
import {addPointer, agentTargets, pointerLine, removePointer, renderSkill, SKILL_MARKER} from './skill';
import SKILL_SOURCE from '../../skills/nightshade/SKILL.md';

declare const __EXTENSION_ID__: string;
declare const __VERSION__: string;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
interface Args {
    _: string[];
    flags: Record<string, string | true>;
}

/** Switches that never take a value, so `--json example.com` keeps example.com as an argument. */
const BOOLEAN_FLAGS = new Set(['json', 'force', 'clear', 'show', 'help', 'pointer', 'dry-run']);

function parseArgs(argv: string[]): Args {
    const out: Args = {_: [], flags: {}};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq !== -1) {
                out.flags[a.slice(2, eq)] = a.slice(eq + 1);
            } else if (!BOOLEAN_FLAGS.has(a.slice(2)) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                out.flags[a.slice(2)] = argv[++i];
            } else {
                out.flags[a.slice(2)] = true;
            }
        } else {
            out._.push(a);
        }
    }
    return out;
}

class UsageError extends Error {}

function fail(message: string): never {
    throw new UsageError(message);
}

let jsonOut = false;
/** --dry-run: commands run as usual, but save() keeps the result instead of writing it. */
let dryRun = false;
/** The command line, saved with each history entry. */
let commandLine = 'nightshade';

interface Output {
    human: string;
    data?: unknown;
}

/** Output is held until the command finishes, so dry runs and change summaries can replace or extend it. */
let output: Output[] = [];

function print(human: string, data?: unknown) {
    output.push({human, data});
}

function flush() {
    for (const o of output) {
        if (jsonOut) {
            process.stdout.write(`${JSON.stringify(o.data ?? {ok: true, message: o.human}, null, 2)}\n`);
        } else {
            process.stdout.write(`${o.human}\n`);
        }
    }
    output = [];
}

// ---------------------------------------------------------------------------
// Config IO
// ---------------------------------------------------------------------------
function load(): Config {
    const raw = readRaw();
    return raw === null ? defaultConfig() : validateConfig(raw);
}

function historyDir(): string {
    return join(nightshadeDir(), 'history');
}

function currentText(): string | null {
    return existsSync(configPath()) ? readFileSync(configPath(), 'utf8') : null;
}

function loadOrDefaults(): Config {
    try {
        return load();
    } catch {
        return defaultConfig();
    }
}

/** What the last save() did (or, in a dry run, would have done). */
let saved: {before: Config; after: Config} | null = null;

function save(config: Config) {
    const after = validateConfig({...config, updatedAt: new Date().toISOString()});
    const before = loadOrDefaults();
    if (!dryRun) {
        const beforeText = currentText();
        const text = writeConfig(after);
        recordChange(historyDir(), beforeText, text, commandLine);
    }
    saved = {before, after};
}

// ---------------------------------------------------------------------------
// Flag → rule patch
// ---------------------------------------------------------------------------
function numFlag(v: string | true | undefined, name: string): number | undefined | null {
    if (v === undefined) {
        return undefined;
    }
    if (v === 'inherit' || v === 'default') {
        return null;
    }
    const n = Number(v);
    if (v === true || Number.isNaN(n)) {
        fail(`--${name} needs a number (or "inherit")`);
    }
    return n;
}

function lookPatch(flags: Args['flags'], allowCss = true): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const nums: Array<[string, string]> = [
        ['brightness', 'brightness'], ['contrast', 'contrast'], ['sepia', 'sepia'], ['warmth', 'sepia'],
        ['grayscale', 'grayscale'], ['image-dim', 'imageDim'], ['text-stroke', 'textStroke'],
    ];
    for (const [flag, key] of nums) {
        const v = numFlag(flags[flag], flag);
        if (v !== undefined) {
            p[key] = v;
        }
    }
    if (flags['contrast-floor'] !== undefined) {
        const v = flags['contrast-floor'];
        if (v === 'inherit') {
            p.contrastFloor = null;
        } else {
            const n = v === 'off' ? 0 : Number(v);
            if (!CONTRAST_FLOORS.includes(n as ContrastFloor)) {
                fail(`--contrast-floor must be off, 3, 4.5, 7 or inherit`);
            }
            p.contrastFloor = n;
        }
    }
    if (flags['icon-rescue'] !== undefined) {
        const v = flags['icon-rescue'];
        p.iconRescue = v === 'inherit' ? null : v === true || v === 'on' || v === 'true';
    }
    if (flags.palette !== undefined) {
        p.palette = flags.palette === 'inherit' ? null : flags.palette;
    }
    if (flags.font !== undefined) {
        p.fontFamily = flags.font === 'inherit' ? null : String(flags.font);
    }
    if (allowCss && flags.css !== undefined) {
        p.css = flags.css === '' ? null : String(flags.css);
    }
    if (allowCss && flags['css-file'] !== undefined) {
        p.css = readFileSync(String(flags['css-file']), 'utf8');
    }
    if (flags.note !== undefined) {
        p.note = flags.note === '' ? null : String(flags.note);
    }
    return p;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function describeRule(r: SiteRule): string {
    const bits: string[] = [r.mode];
    for (const k of ['brightness', 'contrast', 'sepia', 'grayscale', 'imageDim', 'contrastFloor', 'iconRescue', 'palette', 'fontFamily'] as const) {
        if (r[k] !== undefined) {
            bits.push(`${k}=${r[k]}`);
        }
    }
    if (r.fixes?.length) {
        bits.push(`${r.fixes.length} fix${r.fixes.length === 1 ? '' : 'es'}`);
    }
    if (r.css) {
        bits.push('custom css');
    }
    return bits.join('  ');
}

function cmdShow() {
    const c = load();
    if (jsonOut) {
        print('', c);
        return;
    }
    const g = c.global;
    const lines = [
        `Config: ${configPath()}${existsSync(configPath()) ? '' : ' (not created yet: showing defaults)'}`,
        `Global: ${g.enabled ? 'on' : 'OFF'} · unlisted sites: ${g.unlisted} · default mode: ${g.mode} · palette: ${g.palette}`,
        `        brightness ${g.brightness} · contrast ${g.contrast} · warmth ${g.sepia} · contrast floor ${g.contrastFloor || 'off'} · icon rescue ${g.iconRescue ? 'on' : 'off'} · images ${g.imageDim}%`,
        '',
        `Sites (${c.sites.length}):`,
        ...c.sites.map((s) => `  ${s.match.join(', ').padEnd(32)} ${describeRule(s)}${s.note ? `   # ${s.note}` : ''}`),
    ];
    print(lines.join('\n'));
}

function cmdSite(args: Args) {
    const target = args._[1] ?? fail('Usage: nightshade site <domain-or-url>');
    const c = load();
    const url = /^[a-z]+:\/\//i.test(target) ? target : `https://${target}`;
    const found = findRule(c, url);
    const r = resolve(c, url);
    const data = {
        url, rule: found?.rule ?? null, matchedPattern: found?.pattern ?? null,
        effective: {mode: r.mode, reason: r.reason, detectDarkFirst: r.detectDark, ...r.look, palette: r.look.paletteName},
    };
    if (jsonOut) {
        print('', data);
        return;
    }
    print([
        found ? `Rule ${found.pattern}: ${describeRule(found.rule)}` : 'No rule: global default applies.',
        `Effective mode: ${r.mode}${r.detectDark ? ' (switches to native if the page is already dark)' : ''}`,
        `Look: brightness ${r.look.brightness} · contrast ${r.look.contrast} · warmth ${r.look.sepia} · floor ${r.look.contrastFloor || 'off'} · icons ${r.look.iconRescue ? 'on' : 'off'} · palette ${r.look.paletteName}`,
        ...(found?.rule.fixes ?? []).map((f, i) => `  fix ${i}: ${f.action} ${f.selector}${f.colour ? ` ${f.colour}` : ''}`),
        ...(found?.rule.css ? ['Custom CSS:', found.rule.css] : []),
    ].join('\n'), data);
}

function cmdSet(args: Args) {
    const pattern = args._[1] ?? fail('Usage: nightshade set <pattern> [--mode M] [--brightness N] ...');
    const c = load();
    const patch: Record<string, unknown> = lookPatch(args.flags);
    if (args.flags.mode !== undefined) {
        if (!MODES.includes(args.flags.mode as Mode)) {
            fail(`--mode must be one of ${MODES.join(', ')}`);
        }
        patch.mode = args.flags.mode;
    }
    const exists = c.sites.some((s) => s.match.includes(normalisePattern(pattern)));
    if (!exists && patch.mode === undefined) {
        patch.mode = c.global.mode;
    }
    if (Object.keys(patch).length === 0) {
        fail('Nothing to change. Pass at least one option, e.g. --mode native.');
    }
    const next = upsertSite(c, pattern, patch as Partial<SiteRule>);
    save(next);
    const rule = next.sites.find((s) => s.match.includes(normalisePattern(pattern)))!;
    print(`${exists ? 'Updated' : 'Added'} ${normalisePattern(pattern)}: ${describeRule(rule)}`, {ok: true, rule});
}

function cmdOnOff(args: Args, on: boolean) {
    const pattern = args._[1] ?? fail(`Usage: nightshade ${on ? 'on' : 'off'} <pattern> [--mode M]`);
    const c = load();
    const mode = (on ? (args.flags.mode as Mode | undefined) ?? c.global.mode : 'off') as Mode;
    if (!MODES.includes(mode)) {
        fail(`--mode must be one of ${MODES.join(', ')}`);
    }
    save(upsertSite(c, pattern, {mode}));
    print(`${normalisePattern(pattern)} is now ${mode}.`, {ok: true, pattern: normalisePattern(pattern), mode});
}

function cmdUnset(args: Args) {
    const pattern = args._[1] ?? fail('Usage: nightshade unset <pattern>');
    const c = load();
    if (!c.sites.some((s) => s.match.includes(normalisePattern(pattern)))) {
        fail(`No rule for ${normalisePattern(pattern)}. See: nightshade show`);
    }
    save(removeSite(c, pattern));
    print(`Removed the rule for ${normalisePattern(pattern)}. It now follows the global default.`);
}

function cmdFix(args: Args) {
    const sub = args._[1];
    const pattern = args._[2];
    const c = load();
    const rule = pattern ? c.sites.find((s) => s.match.includes(normalisePattern(pattern))) : undefined;
    if (sub === 'list') {
        if (!pattern) {
            fail('Usage: nightshade fix list <pattern>');
        }
        const fixes = rule?.fixes ?? [];
        print(fixes.length ? fixes.map((f, i) => `${i}: ${f.action} ${f.selector}${f.colour ? ` ${f.colour}` : ''}${f.note ? `   # ${f.note}` : ''}`).join('\n') : 'No fixes.', fixes);
        return;
    }
    if (sub === 'add') {
        const selector = args._[3];
        const action = args._[4] as FixAction;
        if (!pattern || !selector || !action) {
            fail(`Usage: nightshade fix add <pattern> <selector> <action> [--colour #hex] [--note text]\nActions: ${FIX_ACTIONS.join(', ')}`);
        }
        const fix: Fix = {selector, action};
        if (typeof args.flags.colour === 'string' || typeof args.flags.color === 'string') {
            fix.colour = String(args.flags.colour ?? args.flags.color);
        }
        if (typeof args.flags.note === 'string') {
            fix.note = args.flags.note;
        }
        const fixes = [...(rule?.fixes ?? []).filter((f) => f.selector !== selector), fix];
        const next = upsertSite(c, pattern, {fixes, ...(rule ? {} : {mode: (args.flags.mode as Mode) ?? c.global.mode})});
        save(next);
        print(`Added fix to ${normalisePattern(pattern)}: ${action} ${selector}`, {ok: true, fix});
        return;
    }
    if (sub === 'rm' || sub === 'remove') {
        const which = args._[3];
        if (!pattern || which === undefined || !rule) {
            fail('Usage: nightshade fix rm <pattern> <index-or-selector>');
        }
        const before = rule.fixes ?? [];
        const after = /^\d+$/.test(which) ? before.filter((_, i) => i !== Number(which)) : before.filter((f) => f.selector !== which);
        if (after.length === before.length) {
            fail(`No fix "${which}" on ${pattern}. See: nightshade fix list ${pattern}`);
        }
        save(upsertSite(c, pattern, {fixes: after.length ? after : undefined} as Partial<SiteRule>));
        print(`Removed fix ${which} from ${normalisePattern(pattern)}.`);
        return;
    }
    fail('Usage: nightshade fix <add|list|rm> ...');
}

function cmdCss(args: Args) {
    const pattern = args._[1] ?? fail('Usage: nightshade css <pattern> (--set "css" | --file path | --append "css" | --clear | --show)');
    const c = load();
    const rule = c.sites.find((s) => s.match.includes(normalisePattern(pattern)));
    if (args.flags.show || Object.keys(args.flags).filter((k) => k !== 'json').length === 0) {
        print(rule?.css ?? '(no custom CSS)', {css: rule?.css ?? ''});
        return;
    }
    let css: string | null;
    if (args.flags.clear) {
        css = null;
    } else if (typeof args.flags.file === 'string') {
        css = readFileSync(args.flags.file, 'utf8');
    } else if (typeof args.flags.append === 'string') {
        css = [rule?.css, args.flags.append].filter(Boolean).join('\n');
    } else if (typeof args.flags.set === 'string') {
        css = args.flags.set;
    } else {
        fail('Pass --set, --file, --append or --clear');
    }
    save(upsertSite(c, pattern, {css, ...(rule ? {} : {mode: c.global.mode})} as Partial<SiteRule>));
    print(css ? `Custom CSS for ${normalisePattern(pattern)} saved (${css.length} chars).` : `Custom CSS for ${normalisePattern(pattern)} cleared.`);
}

function cmdGlobal(args: Args) {
    const c = load();
    const f = args.flags;
    const g: any = {...c.global};
    const look = lookPatch(f, false);
    for (const [k, v] of Object.entries(look)) {
        if (k === 'note') {
            continue;
        }
        if (v === null) {
            fail(`"inherit" doesn't apply to global settings`);
        }
        g[k] = v;
    }
    if (f.mode !== undefined) {
        g.mode = f.mode;
    }
    if (f.unlisted !== undefined) {
        g.unlisted = f.unlisted;
    }
    if (f.enabled !== undefined) {
        g.enabled = f.enabled === true || f.enabled === 'on' || f.enabled === 'true';
    }
    if (f['builtin-fixes'] !== undefined) {
        g.useBuiltInFixes = f['builtin-fixes'] === true || f['builtin-fixes'] === 'on' || f['builtin-fixes'] === 'true';
    }
    const changed = JSON.stringify(g) !== JSON.stringify(c.global);
    if (!changed) {
        const s = c.global;
        print(Object.entries(s).map(([k, v]) => `${k}: ${v}`).join('\n'), s);
        return;
    }
    const next = validateConfig({...c, global: g});
    save(next);
    print('Global settings updated.', {ok: true, global: next.global});
}

function cmdPalette(args: Args) {
    const sub = args._[1];
    const c = load();
    if (!sub || sub === 'list') {
        print(Object.entries(c.palettes).map(([n, p]) => `${n.padEnd(14)} ${PALETTE_KEYS.map((k) => `${k} ${p[k]}`).join('  ')}`).join('\n'), c.palettes);
        return;
    }
    if (sub === 'set') {
        const name = args._[2] ?? fail(`Usage: nightshade palette set <name> [--${PALETTE_KEYS.join(' #hex] [--')} #hex]`);
        const pal: any = {...(c.palettes[name] ?? c.palettes[c.global.palette] ?? c.palettes.default)};
        for (const k of PALETTE_KEYS) {
            if (typeof args.flags[k] === 'string') {
                pal[k] = args.flags[k];
            }
        }
        const next = validateConfig({...c, palettes: {...c.palettes, [name]: pal}});
        save(next);
        print(`Palette ${name} saved.`, {ok: true, palette: next.palettes[name]});
        return;
    }
    if (sub === 'rm') {
        const name = args._[2] ?? fail('Usage: nightshade palette rm <name>');
        if (c.sites.some((s) => s.palette === name) || c.global.palette === name) {
            fail(`Palette ${name} is in use. Point those sites at another palette first.`);
        }
        const palettes = {...c.palettes};
        delete palettes[name];
        save({...c, palettes});
        print(`Palette ${name} removed.`);
        return;
    }
    fail('Usage: nightshade palette <list|set|rm>');
}

function cmdValidate(args: Args) {
    const file = args._[1] ? resolvePath(args._[1]) : configPath();
    try {
        const raw = readRaw(file);
        if (raw === null) {
            print(`${file} does not exist yet. Defaults apply.`, {ok: true, exists: false});
            return;
        }
        const c = validateConfig(raw);
        print(`${file} is valid: ${c.sites.length} site rules, ${Object.keys(c.palettes).length} palettes.`, {ok: true, sites: c.sites.length});
    } catch (e) {
        const problems = e instanceof ConfigError ? e.problems : [(e as Error).message];
        process.exitCode = 1;
        print(`${file} is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`, {ok: false, problems});
    }
}

function cmdInit(args: Args) {
    if (existsSync(configPath()) && !args.flags.force) {
        fail(`${configPath()} already exists. Use --force to reset it to defaults.`);
    }
    save(defaultConfig());
    print(`Wrote defaults to ${configPath()}.`);
}

function cmdImport(args: Args) {
    const file = args._[1] ?? fail('Usage: nightshade import <file.json>');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    save(validateConfig(raw));
    print(`Imported ${file} into ${configPath()}.`);
}

function cmdExport(args: Args) {
    const c = load();
    const text = `${JSON.stringify(c, null, 2)}\n`;
    if (args._[1]) {
        writeFileSync(args._[1], text);
        print(`Exported to ${args._[1]}.`);
    } else {
        process.stdout.write(text);
    }
}

function cmdHistory() {
    const entries = listHistory(historyDir());
    if (!entries.length) {
        print('No changes recorded yet.', {entries: []});
        return;
    }
    const rows = entries.map((e, i) => ({step: i + 1, time: e.time, command: e.command}));
    print([
        `Recent changes, newest first (the last ${HISTORY_LIMIT} are kept). "nightshade undo" reverts the top one.`,
        ...rows.map((r) => `  ${String(r.step).padStart(2)}  ${r.time.replace('T', ' ').slice(0, 19)}  ${r.command}`),
    ].join('\n'), {entries: rows});
}

function cmdUndo(args: Args) {
    const now = currentText();
    const plan = planUndo(historyDir(), now);
    if (!plan) {
        fail('Nothing to undo. Changes made with the CLI are recorded from now on; see: nightshade history');
    }
    if (plan.changedSince && !args.flags.force) {
        fail([
            `The config file has changed since "${plan.entry.command}"`,
            '(probably in the extension: the element picker or the options page).',
            'Undo would throw that change away too. Look at it with: nightshade show',
            'To undo anyway, run: nightshade undo --force',
        ].join('\n'));
    }
    const current = loadOrDefaults();
    const restored = validateConfig({
        ...(plan.entry.before === null ? defaultConfig() : validateConfig(JSON.parse(plan.entry.before))),
        // Newer wins when the extension and the file are reconciled, so the restored copy gets a fresh time.
        updatedAt: new Date().toISOString(),
    });
    const changes = diffConfigs(current, restored);
    if (dryRun) {
        print([`Dry run: nothing was written. Undo would revert "${plan.entry.command}":`, ...describeChanges(changes)].join('\n'),
            {ok: true, dryRun: true, undoes: plan.entry.command, changes});
        return;
    }
    writeConfig(restored);
    dropEntry(historyDir(), plan.entry);
    print([`Undid "${plan.entry.command}":`, ...describeChanges(changes)].join('\n'), {ok: true, undid: plan.entry.command, changes});
}

/** After a command: a dry run replaces its output with the change list; a real change adds what it covers. */
function summarise() {
    if (!saved) {
        return;
    }
    const changes: Change[] = diffConfigs(saved.before, saved.after);
    if (dryRun) {
        output = [];
        print(['Dry run: nothing was written. This would change:', ...describeChanges(changes)].join('\n'), {ok: true, dryRun: true, changes});
        return;
    }
    const last = output[output.length - 1];
    if (!last) {
        return;
    }
    const covers = changes.filter((c) => c.kind === 'site').flatMap((c) => c.target.split(', ').map((p, i) => `${p} covers ${c.covers?.[i] ?? ''}`));
    if (covers.length) {
        last.human = [last.human, ...covers].join('\n');
    }
    const data = last.data ?? {ok: true, message: last.human};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        last.data = {...data, changes};
    }
}

// ---------------------------------------------------------------------------
// Bridge (native messaging host) installation
// ---------------------------------------------------------------------------
function browserHostDirs(): Array<{browser: string; dir: string}> {
    const h = homedir();
    if (platform() === 'darwin') {
        const base = join(h, 'Library', 'Application Support');
        return [
            {browser: 'Google Chrome', dir: join(base, 'Google', 'Chrome')},
            {browser: 'Google Chrome Beta', dir: join(base, 'Google', 'Chrome Beta')},
            {browser: 'Google Chrome Canary', dir: join(base, 'Google', 'Chrome Canary')},
            {browser: 'Chrome for Testing', dir: join(base, 'Google', 'Chrome for Testing')},
            {browser: 'Chromium', dir: join(base, 'Chromium')},
            {browser: 'Brave', dir: join(base, 'BraveSoftware', 'Brave-Browser')},
            {browser: 'Microsoft Edge', dir: join(base, 'Microsoft Edge')},
        ];
    }
    if (platform() === 'linux') {
        const base = join(h, '.config');
        return [
            {browser: 'Google Chrome', dir: join(base, 'google-chrome')},
            {browser: 'Chromium', dir: join(base, 'chromium')},
            {browser: 'Brave', dir: join(base, 'BraveSoftware', 'Brave-Browser')},
            {browser: 'Microsoft Edge', dir: join(base, 'microsoft-edge')},
        ];
    }
    return [];
}

function hostScriptPath(): string {
    // dist/cli/nightshade.mjs → dist/bridge/host.mjs
    return resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'host.mjs');
}

function cmdBridge(args: Args) {
    const sub = args._[1] ?? 'status';
    const manifestName = `${BRIDGE_HOST}.json`;
    const dirs = browserHostDirs();
    if (sub === 'install') {
        if (platform() === 'win32') {
            fail('Windows needs a registry entry; see docs/agent-bridge.md.');
        }
        const extraIds = typeof args.flags['extension-id'] === 'string'
            ? args.flags['extension-id'].split(',').map((id) => id.trim()).filter(Boolean)
            : [];
        const badId = extraIds.find((id) => !isExtensionId(id));
        if (badId !== undefined) {
            fail(`"${badId}" is not an extension ID (32 letters, a to p). Copy it from chrome://extensions.`);
        }
        const ids = [...new Set([__EXTENSION_ID__, ...extraIds])];
        const wrapper = join(nightshadeDir(), 'bridge-host.sh');
        mkdirSync(nightshadeDir(), {recursive: true, mode: 0o700});
        // The browser starts the host with a bare environment, so carry custom locations over.
        const env = ['NIGHTSHADE_HOME', 'NIGHTSHADE_CONFIG']
            .filter((k) => process.env[k])
            .map((k) => `${k}=${shellQuote(resolvePath(process.env[k]!))} `)
            .join('');
        writeFileSync(wrapper, `#!/bin/sh\n# Started by the browser for the Nightshade extension. Generated by \`nightshade bridge install\`.\n${env}exec ${shellQuote(process.execPath)} ${shellQuote(hostScriptPath())} "$@"\n`);
        chmodSync(wrapper, 0o755);
        const manifest = {
            name: BRIDGE_HOST,
            description: 'Nightshade agent bridge: syncs ~/.nightshade/config.json with the extension',
            path: wrapper,
            type: 'stdio',
            allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
        };
        const only = typeof args.flags.browser === 'string' ? args.flags.browser.toLowerCase() : null;
        const installed: string[] = [];
        // A browser started with --user-data-dir looks in <user-data-dir>/NativeMessagingHosts.
        const extra = typeof args.flags['user-data-dir'] === 'string' ? [{browser: 'custom', dir: resolvePath(args.flags['user-data-dir'])}] : [];
        for (const {browser, dir} of [...(extra.length ? extra : dirs)]) {
            if (extra.length) {
                const target = join(dir, 'NativeMessagingHosts');
                mkdirSync(target, {recursive: true});
                writeFileSync(join(target, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
                installed.push(`${dir}: ${join(target, manifestName)}`);
                continue;
            }
            if (only ? !browser.toLowerCase().includes(only) : !existsSync(dir)) {
                continue;
            }
            const target = join(dir, 'NativeMessagingHosts');
            mkdirSync(target, {recursive: true});
            writeFileSync(join(target, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
            installed.push(`${browser}: ${join(target, manifestName)}`);
        }
        if (!existsSync(configPath())) {
            save(defaultConfig());
        }
        print(installed.length
            ? `Bridge installed for:\n${installed.map((l) => `  ${l}`).join('\n')}\nHost: ${wrapper}\nConfig: ${configPath()}\nExtension ID(s): ${ids.join(', ')}\nOpen Nightshade's options → Agent bridge → Reconnect (or restart the browser).`
            : 'No supported browser found. Pass --browser chrome to force.', {ok: installed.length > 0, installed, wrapper, ids});
        return;
    }
    if (sub === 'uninstall') {
        const removed: string[] = [];
        for (const {dir} of dirs) {
            const f = join(dir, 'NativeMessagingHosts', manifestName);
            if (existsSync(f)) {
                rmSync(f);
                removed.push(f);
            }
        }
        rmSync(join(nightshadeDir(), 'bridge-host.sh'), {force: true});
        print(removed.length ? `Removed:\n${removed.map((r) => `  ${r}`).join('\n')}` : 'Bridge was not installed.', {ok: true, removed});
        return;
    }
    if (sub === 'status') {
        const found = dirs.map(({browser, dir}) => ({browser, file: join(dir, 'NativeMessagingHosts', manifestName)})).filter((x) => existsSync(x.file));
        print(found.length
            ? `Bridge registered for: ${found.map((f) => f.browser).join(', ')}\nConfig: ${configPath()}`
            : 'Bridge not installed. Run: nightshade bridge install', {installed: found, config: configPath()});
        return;
    }
    fail('Usage: nightshade bridge <install|uninstall|status> [--extension-id ID[,ID]] [--browser name]');
}

function cmdSchema() {
    const doc = {
        file: configPath(),
        modes: {
            off: 'No changes on the site.',
            native: "Keep the site's own (dark) theme; only boosts run.",
            dynamic: "Dark Reader's recolouring engine.",
            filter: 'Full-page invert with images restored. For canvas apps like Google Docs.',
            bespoke: 'Dynamic with a named palette; palette colours available to CSS as var(--ns-bg) etc.',
        },
        unlisted: UNLISTED,
        contrastFloors: CONTRAST_FLOORS,
        fixActions: FIX_ACTIONS,
        paletteKeys: PALETTE_KEYS,
        patterns: 'example.com (domain and subdomains) · app.example.com/path (path prefix) · *.example.com (subdomains only)',
        siteFields: {
            match: 'string[]', mode: MODES.join('|'), brightness: '50-150', contrast: '50-150', sepia: '0-100 (warmth)',
            grayscale: '0-100', imageDim: '50-100', contrastFloor: CONTRAST_FLOORS.join('|'), iconRescue: 'boolean',
            palette: 'palette name', fontFamily: 'string', textStroke: '0-1', css: 'string', fixes: 'Fix[]', note: 'string',
        },
        example: {match: ['mail.google.com'], mode: 'native', contrastFloor: 4.5, iconRescue: true, fixes: [{selector: '[role=checkbox]', action: 'strengthen-border'}]},
    };
    print(JSON.stringify(doc, null, 2), doc);
}


// ---------------------------------------------------------------------------
// Agent skill
// ---------------------------------------------------------------------------
function onPath(name: string): boolean {
    for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
        try {
            accessSync(join(dir, name), fsConstants.X_OK);
            return true;
        } catch {
            // not in this folder
        }
    }
    return false;
}

function cmdSkill(args: Args) {
    const sub = args._[1] ?? 'status';
    const home = homedir();
    const all = agentTargets(home);
    const wanted = typeof args.flags.agent === 'string' ? args.flags.agent.split(',').map((a) => a.trim()).filter(Boolean) : null;
    const unknown = wanted?.find((w) => !all.some((t) => t.id === w));
    if (unknown) {
        fail(`Unknown agent "${unknown}". Choose from: ${all.map((t) => t.id).join(', ')}`);
    }
    const isOurs = (dir: string) => existsSync(join(dir, 'SKILL.md')) && readFileSync(join(dir, 'SKILL.md'), 'utf8').includes(SKILL_MARKER);

    if (sub === 'install') {
        const targets = wanted ? all.filter((t) => wanted.includes(t.id)) : all.filter((t) => existsSync(t.homeDir));
        if (!targets.length) {
            fail(`No supported agent found (looked for ${all.map((t) => t.homeDir.replace(home, '~')).join(', ')}). Use --agent ${all.map((t) => t.id).join('|')} to install anyway.`);
        }
        // A bare `node` survives Node upgrades; the versioned execPath does not.
        const node = onPath('node') ? 'node' : shellQuote(process.execPath);
        const cli = onPath('nightshade') ? 'nightshade' : `${node} ${shellQuote(fileURLToPath(import.meta.url))}`;
        const text = renderSkill(SKILL_SOURCE, cli, String(__VERSION__));
        const done: Record<string, unknown>[] = [];
        const written = new Set<string>();
        for (const t of targets) {
            const file = join(t.skillDir, 'SKILL.md');
            if (written.has(file) && !(args.flags.pointer && t.pointerFile)) {
                done.push({agent: t.id, skill: file});
                continue;
            }
            written.add(file);
            if (existsSync(file) && !isOurs(t.skillDir) && !args.flags.force) {
                fail(`${file} exists and was not written by Nightshade. Add --force to replace it.`);
            }
            mkdirSync(t.skillDir, {recursive: true});
            writeFileSync(file, text);
            let pointer: string | undefined;
            if (args.flags.pointer && t.pointerFile) {
                const before = existsSync(t.pointerFile) ? readFileSync(t.pointerFile, 'utf8') : '';
                const after = addPointer(before, pointerLine(file.replace(home, '~')));
                if (after !== null) {
                    mkdirSync(dirname(t.pointerFile), {recursive: true});
                    writeFileSync(t.pointerFile, after);
                }
                pointer = t.pointerFile;
            }
            done.push({agent: t.id, skill: file, pointer});
        }
        const lines = done.map((d) => `  ${String(d.agent).padEnd(7)} ${d.skill}${d.pointer ? `  (pointer in ${d.pointer})` : ''}`);
        print(`Nightshade skill installed for:\n${lines.join('\n')}\nCLI command in the skill: ${cli}\nStart a new agent session to pick it up.`, {ok: true, cli, installed: done});
        return;
    }
    if (sub === 'uninstall') {
        const targets = wanted ? all.filter((t) => wanted.includes(t.id)) : all;
        const removed: string[] = [];
        for (const t of targets) {
            if (isOurs(t.skillDir)) {
                rmSync(t.skillDir, {recursive: true, force: true});
                removed.push(t.skillDir);
            }
            if (t.pointerFile && existsSync(t.pointerFile)) {
                const after = removePointer(readFileSync(t.pointerFile, 'utf8'));
                if (after !== null) {
                    writeFileSync(t.pointerFile, after);
                    removed.push(`pointer in ${t.pointerFile}`);
                }
            }
        }
        print(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Nothing to remove.', {ok: true, removed});
        return;
    }
    if (sub === 'status') {
        const rows = all.map((t) => ({
            agent: t.id, label: t.label, agentFound: existsSync(t.homeDir), installed: isOurs(t.skillDir), skill: join(t.skillDir, 'SKILL.md'),
        }));
        print(rows.map((r) => `  ${r.agent.padEnd(7)} ${r.installed ? 'installed' : r.agentFound ? 'not installed' : 'agent not found'}  ${r.label}`).join('\n'), rows);
        return;
    }
    if (sub === 'show') {
        print(SKILL_SOURCE, {skill: SKILL_SOURCE});
        return;
    }
    fail('Usage: nightshade skill <install|uninstall|status|show> [--agent claude,codex,gemini,cursor] [--pointer] [--force]');
}

const HELP = `nightshade ${typeof __VERSION__ === 'string' ? __VERSION__ : ''}: per-site dark mode, from the command line

Config file: ${configPath()}

Sites
  nightshade show                                   Global settings and every site rule
  nightshade site <domain|url>                      Which rule applies to a site, and the effective look
  nightshade set <pattern> [options]                Create or update a site rule
      --mode off|native|dynamic|filter|bespoke
      --brightness 50-150  --contrast 50-150  --warmth 0-100  --grayscale 0-100
      --image-dim 50-100   --contrast-floor off|3|4.5|7   --icon-rescue on|off
      --palette <name>     --font "<family>"   --note "<text>"
      --css "<css>" | --css-file <path>        (any value may be "inherit" to clear it)
  nightshade on <pattern> [--mode M]                Turn a site on (default mode unless given)
  nightshade off <pattern>                          Turn a site off
  nightshade unset <pattern>                        Delete a site's rule
  nightshade fix add <pattern> <selector> <action> [--colour #hex] [--note text]
      actions: ${FIX_ACTIONS.join(', ')}
  nightshade fix list <pattern>
  nightshade fix rm <pattern> <index|selector>
  nightshade css <pattern> --set "<css>" | --file <path> | --append "<css>" | --clear | --show

Preview and undo
  Add --dry-run to any command that changes settings: it prints which sites the change
  covers and every setting it would change, and writes nothing.
  nightshade undo [--force] [--dry-run]             Revert the most recent CLI change (again for the one before)
  nightshade history                                The last ${HISTORY_LIMIT} CLI changes, newest first

Global and palettes
  nightshade global [--enabled on|off] [--unlisted skip-already-dark|always|only-listed]
                    [--mode dynamic|filter|bespoke] [--palette name] [look options as above]
                    [--builtin-fixes on|off]
  nightshade palette list | set <name> [--bg #hex --text #hex ...] | rm <name>

File and bridge
  nightshade init [--force]    nightshade validate [file]    nightshade schema
  nightshade import <file>     nightshade export [file]
  nightshade bridge install [--extension-id ID] [--user-data-dir DIR] | uninstall | status

Agent skill (lets Claude Code, Codex, Gemini CLI and Cursor find Nightshade from any folder)
  nightshade skill install [--agent claude,codex,gemini,cursor] [--pointer] [--force]
      Installs for every agent found unless --agent is given. --pointer also adds one line
      to the agent's global instructions file (CLAUDE.md, AGENTS.md, GEMINI.md).
  nightshade skill uninstall [--agent ...] | status | show

Add --json to any command for machine-readable output.`;

export function main(argv = process.argv.slice(2)): void {
    const args = parseArgs(argv);
    jsonOut = Boolean(args.flags.json);
    dryRun = Boolean(args.flags['dry-run']);
    delete args.flags.json;
    delete args.flags['dry-run'];
    commandLine = ['nightshade', ...argv.filter((a) => a !== '--json' && a !== '--dry-run')
        .map((a) => (/^[\w@%+=:,./#-]+$/.test(a) ? a : shellQuote(a)))].join(' ');
    output = [];
    saved = null;
    const cmd = args._[0];
    try {
        switch (cmd) {
            case undefined: case 'help': case '-h':
                print(HELP);
                break;
            case 'show': case 'list': cmdShow(); break;
            case 'site': case 'get': cmdSite(args); break;
            case 'set': cmdSet(args); break;
            case 'on': cmdOnOff(args, true); break;
            case 'off': cmdOnOff(args, false); break;
            case 'unset': case 'rm': cmdUnset(args); break;
            case 'fix': cmdFix(args); break;
            case 'css': cmdCss(args); break;
            case 'global': cmdGlobal(args); break;
            case 'palette': cmdPalette(args); break;
            case 'validate': cmdValidate(args); break;
            case 'init': cmdInit(args); break;
            case 'import': cmdImport(args); break;
            case 'export': cmdExport(args); break;
            case 'bridge': cmdBridge(args); break;
            case 'skill': cmdSkill(args); break;
            case 'schema': cmdSchema(); break;
            case 'undo': cmdUndo(args); break;
            case 'history': cmdHistory(); break;
            case 'path': print(configPath(), {path: configPath()}); break;
            case 'version': case '--version': print(String(__VERSION__)); break;
            default:
                fail(`Unknown command "${cmd}". Run: nightshade help`);
        }
        summarise();
        flush();
    } catch (e) {
        output = [];
        process.exitCode = 1;
        const problems = e instanceof ConfigError ? e.problems : [(e as Error).message];
        if (jsonOut) {
            process.stdout.write(`${JSON.stringify({ok: false, problems}, null, 2)}\n`);
        } else {
            process.stderr.write(`${problems.join('\n')}\n`);
        }
    }
}

main();

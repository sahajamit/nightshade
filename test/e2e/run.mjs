// End-to-end tests: loads dist/extension into Playwright's Chromium, serves test/fixtures,
// installs the agent bridge into a throwaway profile and drives everything through the CLI.
//   npm run test:e2e            (add --headed to watch, --real to also visit public sites)
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, mkdtempSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join, resolve} from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const headed = process.argv.includes('--headed');
const real = process.argv.includes('--real');
const artifacts = join(root, 'test/e2e/artifacts');
rmSync(artifacts, {recursive: true, force: true});
mkdirSync(artifacts, {recursive: true});

// --- fixture server ---------------------------------------------------------
const types = {'.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png'};
const server = createServer((req, res) => {
    const file = join(root, 'test/fixtures', decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(join(root, 'test/fixtures')) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'}).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// --- isolated profile + config + bridge --------------------------------------
const work = mkdtempSync(join(tmpdir(), 'nightshade-e2e-'));
const profile = join(work, 'profile');
const home = join(work, 'home');
const env = {...process.env, NIGHTSHADE_HOME: home};
const cli = (...args) => execFileSync(process.execPath, [join(root, 'dist/cli/nightshade.mjs'), ...args], {env, encoding: 'utf8'});
cli('init');
cli('bridge', 'install', '--user-data-dir', profile);

const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !headed,
    viewport: {width: 1100, height: 700},
    args: [`--disable-extensions-except=${join(root, 'dist/extension')}`, `--load-extension=${join(root, 'dist/extension')}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const extId = new URL(worker.url()).host;

const results = [];
async function test(name, fn) {
    const t0 = Date.now();
    try {
        await fn();
        results.push({name, ok: true, ms: Date.now() - t0});
        console.log(`  ✓ ${name}`);
    } catch (e) {
        results.push({name, ok: false, error: e.message});
        console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`);
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, {timeout = 8000, interval = 150, message = 'condition'} = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        try {
            last = await fn();
            if (last) {
                return last;
            }
        } catch (e) {
            last = e;
        }
        await sleep(interval);
    }
    throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}

// Colour helpers evaluated in the page.
const lum = `(c => { const m = c.match(/[\\d.]+/g).map(Number); const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]); })`;
const contrast = `((a, b) => { const L = ${lum}; const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); })`;

async function pageState(page) {
    return worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({url});
        return tab ? chrome.tabs.sendMessage(tab.id, {type: 'getPageState'}, {frameId: 0}) : null;
    }, page.url());
}

async function bridgeConnected() {
    return waitFor(() => worker.evaluate(async () => {
        const s = await new Promise((r) => chrome.runtime.sendMessage({type: 'bridgeStatus'}, r)).catch(() => null);
        return s;
    }).then(() => true), {message: 'worker'});
}

console.log(`Nightshade e2e · extension ${extId} · fixtures ${base}`);

await test('extension ID matches the fixed key (bridge relies on it)', async () => {
    assert.equal(extId, 'cilhiaedhodolblheagjkpjgfnananpf');
});

await test('agent bridge connects and seeds the config file', async () => {
    await bridgeConnected();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/options.html#agent`);
    await waitFor(async () => (await page.textContent('#bridgeState'))?.includes('Connected'), {message: 'bridge connected'});
    await page.screenshot({path: join(artifacts, 'options-agent.png')});
    await page.close();
});

await test('light page without a rule gets Dark Reader (dynamic)', async () => {
    const page = await context.newPage();
    await page.goto(`${base}/light.html`);
    await waitFor(async () => (await pageState(page))?.mode === 'dynamic', {message: 'mode dynamic'});
    const bg = await waitFor(async () => {
        const c = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        return (await page.evaluate(`${lum}(${JSON.stringify(c)})`)) < 0.05 ? c : null;
    }, {message: 'dark body background'});
    const fg = await page.evaluate(() => getComputedStyle(document.getElementById('title')).color);
    const ratio = await page.evaluate(`${contrast}(${JSON.stringify(fg)}, ${JSON.stringify(bg)})`);
    assert.ok(ratio > 7, `title contrast ${ratio.toFixed(2)} should be > 7`);
    await page.screenshot({path: join(artifacts, 'light-dynamic.png')});
    await page.close();
});

await test('already-dark page is detected and left native; boosts lift dim icons and borders', async () => {
    const page = await context.newPage();
    await page.goto(`${base}/dark.html`);
    await waitFor(async () => (await pageState(page))?.reason === 'detected-dark', {message: 'detected-dark'});
    const bg = 'rgb(31, 31, 31)';
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), bg, 'site background untouched');
    // SVG path fill (contrast floor 3 by default)
    await waitFor(async () => {
        const fill = await page.evaluate(() => getComputedStyle(document.getElementById('archivePath')).fill);
        return (await page.evaluate(`${contrast}(${JSON.stringify(fill)}, ${JSON.stringify(bg)})`)) >= 3;
    }, {message: 'archive icon fill ≥ 3:1'});
    // checkbox border
    await waitFor(async () => {
        const bd = await page.evaluate(() => getComputedStyle(document.getElementById('cbInner')).borderTopColor);
        return (await page.evaluate(`${contrast}(${JSON.stringify(bd)}, ${JSON.stringify(bg)})`)) >= 3;
    }, {message: 'checkbox border ≥ 3:1'});
    // faint text
    await waitFor(async () => {
        const c = await page.evaluate(() => getComputedStyle(document.getElementById('faintText')).color);
        return (await page.evaluate(`${contrast}(${JSON.stringify(c)}, ${JSON.stringify(bg)})`)) >= 3;
    }, {message: 'faint text ≥ 3:1'});
    // mask icon
    await waitFor(async () => {
        const c = await page.evaluate(() => getComputedStyle(document.getElementById('snoozeIcon')).backgroundColor);
        return (await page.evaluate(`${contrast}(${JSON.stringify(c)}, ${JSON.stringify(bg)})`)) >= 3;
    }, {message: 'mask icon ≥ 3:1'});
    // icon rescue on <img> and background-image glyphs
    await waitFor(async () => (await page.getAttribute('#deleteImg', 'data-ns-icon')) === 'light', {message: 'img icon rescued'});
    await waitFor(async () => (await page.getAttribute('#spamIcon', 'data-ns-icon')) === 'light', {message: 'background-image icon rescued'});
    await page.screenshot({path: join(artifacts, 'dark-native-boosted.png')});
    await page.close();
});

await test('CLI change reaches an open tab through the bridge', async () => {
    const page = await context.newPage();
    await page.goto(`${base}/light.html`);
    await waitFor(async () => (await pageState(page))?.mode === 'dynamic', {message: 'dynamic first'});
    cli('off', '127.0.0.1');
    await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(255, 255, 255)', {message: 'page back to white'});
    assert.equal((await pageState(page)).mode, 'off');
    cli('set', '127.0.0.1', '--mode', 'bespoke', '--palette', 'lamplight', '--warmth', '10');
    await waitFor(async () => (await pageState(page))?.mode === 'bespoke', {message: 'bespoke'});
    const bg = await waitFor(async () => {
        const c = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        return c !== 'rgb(255, 255, 255)' ? c : null;
    }, {message: 'recoloured'});
    assert.ok(await page.evaluate(`${lum}(${JSON.stringify(bg)}) < 0.05`), `bespoke background ${bg} should be dark`);
    await page.screenshot({path: join(artifacts, 'light-bespoke.png')});
    await page.close();
});

await test('filter mode inverts the page', async () => {
    cli('set', '127.0.0.1', '--mode', 'filter');
    const page = await context.newPage();
    await page.goto(`${base}/light.html`);
    await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.documentElement).filter)).includes('invert'), {message: 'html filter'});
    await page.screenshot({path: join(artifacts, 'light-filter.png')});
    await page.close();
});

await test('picker saves a fix to the site rule and the config file', async () => {
    cli('set', '127.0.0.1', '--mode', 'dynamic');
    const page = await context.newPage();
    await page.goto(`${base}/light.html`);
    await waitFor(async () => (await pageState(page))?.mode === 'dynamic', {message: 'dynamic'});
    await worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({url});
        await chrome.tabs.sendMessage(tab.id, {type: 'startPicker'}, {frameId: 0});
    }, page.url());
    await page.hover('#hideme');
    await sleep(150);
    await page.click('#hideme');
    await page.screenshot({path: join(artifacts, 'picker-menu.png')});
    await page.locator('#nightshade-picker').locator('button[data-action="hide"]').click();
    await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.getElementById('hideme')).display)) === 'none', {message: 'element hidden'});
    const fixes = JSON.parse(cli('fix', 'list', '127.0.0.1', '--json'));
    assert.ok(fixes.some((f) => f.action === 'hide' && f.selector.includes('hideme')), `file has the fix: ${JSON.stringify(fixes)}`);
    await page.close();
});

await test('invalid hand edit is rejected and settings stay intact', async () => {
    const {writeFileSync} = await import('node:fs');
    const path = join(home, 'config.json');
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, '{"sites": [{"match": "x", "mode": "rainbow"}]}');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/options.html#agent`);
    await waitFor(async () => (await page.textContent('#bridgeState'))?.includes('invalid'), {message: 'error shown'});
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('config')).config.sites.length);
    assert.ok(stored >= 3, 'previous config kept');
    writeFileSync(path, good);
    await page.close();
});

await test('popup and options render', async () => {
    cli('unset', '127.0.0.1');
    const site = await context.newPage();
    await site.goto(`${base}/dark.html`);
    await waitFor(async () => (await pageState(site))?.reason === 'detected-dark', {message: 'state'});
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({url}))[0].id, site.url());
    const popup = await context.newPage();
    await popup.setViewportSize({width: 340, height: 520});
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await waitFor(async () => (await popup.textContent('#scope'))?.length > 0, {message: 'popup filled'});
    assert.match(await popup.textContent('#scope'), /dark already/);
    await popup.screenshot({path: join(artifacts, 'popup-dark-page.png')});
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/options.html#sites`);
    await opts.waitForSelector('#sites tr');
    await opts.screenshot({path: join(artifacts, 'options-sites.png'), fullPage: true});
    await Promise.all([site.close(), popup.close(), opts.close()]);
});

if (real) {
    for (const [name, url] of [['wikipedia', 'https://en.wikipedia.org/wiki/Night'], ['linkedin', 'https://www.linkedin.com/'], ['x', 'https://x.com/'], ['github', 'https://github.com/darkreader/darkreader'], ['gmail-login', 'https://mail.google.com/']]) {
        await test(`real site: ${name}`, async () => {
            const page = await context.newPage();
            await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
            await sleep(4000);
            const st = await pageState(page);
            await page.screenshot({path: join(artifacts, `real-${name}.png`)});
            console.log(`      ${name}: mode=${st?.mode} reason=${st?.reason} fixes=${st?.boosts?.contrastFixes} icons=${st?.boosts?.iconsRescued}`);
            await page.close();
        });
    }
}

await context.close();
server.close();
rmSync(work, {recursive: true, force: true});
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in test/e2e/artifacts`);
process.exit(failed.length ? 1 : 0);

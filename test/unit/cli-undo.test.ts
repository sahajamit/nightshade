/** Runs the built CLI against a temporary ~/.nightshade, end to end. */
import {beforeAll, describe, expect, it} from 'vitest';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const CLI = 'dist/cli/nightshade.mjs';

beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build.mjs'], {stdio: 'ignore'});
}, 60_000);

function setup() {
    const home = mkdtempSync(join(tmpdir(), 'ns-cli-'));
    const file = join(home, 'config.json');
    const run = (...args: string[]) => {
        const r = spawnSync(process.execPath, [CLI, ...args], {env: {...process.env, NIGHTSHADE_HOME: home, NIGHTSHADE_CONFIG: ''}, encoding: 'utf8'});
        return {code: r.status, out: r.stdout, err: r.stderr};
    };
    const content = () => {
        const c = JSON.parse(readFileSync(file, 'utf8'));
        delete c.updatedAt;
        return c;
    };
    return {home, file, run, content};
}

describe('nightshade --dry-run', () => {
    it('leaves the file byte-for-byte unchanged on every kind of change', () => {
        const {file, run} = setup();
        run('set', 'github.com', '--mode', 'dynamic');
        const before = readFileSync(file);
        const tries = [
            ['set', 'github.com', '--mode', 'bespoke', '--palette', 'default'],
            ['on', 'example.com'], ['off', 'example.com'], ['unset', 'github.com'],
            ['fix', 'add', 'github.com', 'body', 'darken'], ['css', 'github.com', '--set', 'a{color:red}'],
            ['global', '--warmth', '20'], ['palette', 'set', 'dracula', '--bg', '#282a36'],
            ['init', '--force'],
        ];
        for (const t of tries) {
            const r = run(...t, '--dry-run');
            expect(r.code, t.join(' ')).toBe(0);
            expect(r.out, t.join(' ')).toContain('Dry run: nothing was written.');
            expect(readFileSync(file).equals(before), t.join(' ')).toBe(true);
        }
        expect(run('history').out).not.toContain('bespoke');
    });

    it('does not create a config file that does not exist yet', () => {
        const {file, run} = setup();
        expect(run('on', 'example.com', '--dry-run').code).toBe(0);
        expect(existsSync(file)).toBe(false);
    });

    it('shows the scope and old and new values, also as JSON', () => {
        const {run} = setup();
        run('set', 'github.com', '--mode', 'dynamic');
        const r = run('set', 'github.com', '--mode', 'bespoke', '--palette', 'default', '--dry-run');
        expect(r.out).toContain('covers github.com and every subdomain of it (such as www.github.com)');
        expect(r.out).toContain('mode: dynamic -> bespoke');
        const j = JSON.parse(run('set', 'github.com', '--mode', 'off', '--dry-run', '--json').out);
        expect(j).toMatchObject({ok: true, dryRun: true});
        expect(j.changes[0]).toMatchObject({kind: 'site', target: 'github.com', fields: [{field: 'mode', from: 'dynamic', to: 'off'}]});
    });

    it('still rejects invalid changes', () => {
        const {file, run} = setup();
        const r = run('set', 'github.com', '--mode', 'purple', '--dry-run');
        expect(r.code).toBe(1);
        expect(existsSync(file)).toBe(false);
    });

    it('prints the scope after a real change, and in JSON', () => {
        const {run} = setup();
        expect(run('off', '*.example.com').out).toContain('*.example.com covers subdomains of example.com only');
        const j = JSON.parse(run('set', 'a.com', '--mode', 'native', '--json').out);
        expect(j.ok).toBe(true);
        expect(j.changes[0].covers[0]).toContain('a.com and every subdomain');
    });
});

describe('nightshade undo', () => {
    it('steps back through changes and restores the content exactly', () => {
        const {run, content} = setup();
        run('init');
        const s0 = content();
        run('set', 'github.com', '--mode', 'dynamic', '--brightness', '90');
        const s1 = content();
        run('fix', 'add', 'github.com', 'body', 'darken');
        run('global', '--warmth', '20');
        expect(run('history').out).toMatch(/1 .*global --warmth 20[\s\S]*2 .*fix add/);
        expect(run('undo').out).toContain('Undid "nightshade global --warmth 20"');
        expect(run('undo').code).toBe(0);
        expect(content()).toEqual(s1);
        expect(run('undo').code).toBe(0);
        expect(content()).toEqual(s0);
        run('undo');
        const r = run('undo');
        expect(r.code).toBe(1);
        expect(r.err).toContain('Nothing to undo');
    });

    it('gives the restored file a fresh updatedAt so the extension takes it', () => {
        const {file, run} = setup();
        run('on', 'a.com');
        const t1 = JSON.parse(readFileSync(file, 'utf8')).updatedAt;
        run('on', 'b.com');
        run('undo');
        expect(Date.parse(JSON.parse(readFileSync(file, 'utf8')).updatedAt)).toBeGreaterThanOrEqual(Date.parse(t1));
    });

    it('refuses after a change made outside the CLI, unless --force', () => {
        const {file, run, content} = setup();
        run('on', 'a.com');
        const keep = content();
        run('on', 'b.com');
        const c = JSON.parse(readFileSync(file, 'utf8'));
        c.sites.find((s: any) => s.match.includes('b.com')).brightness = 80;
        writeFileSync(file, JSON.stringify(c, null, 2));
        const r = run('undo');
        expect(r.code).toBe(1);
        expect(r.err).toContain('has changed since "nightshade on b.com"');
        expect(run('undo', '--force').code).toBe(0);
        expect(content()).toEqual(keep);
    });

    it('previews with --dry-run without writing or forgetting the step', () => {
        const {file, run} = setup();
        run('on', 'a.com');
        run('off', 'b.com');
        const before = readFileSync(file);
        const r = run('undo', '--dry-run');
        expect(r.out).toContain('Undo would revert "nightshade off b.com"');
        expect(r.out).toContain('Site b.com: removed');
        expect(readFileSync(file).equals(before)).toBe(true);
        expect(run('history').out).toContain('off b.com');
    });
});

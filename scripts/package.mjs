// Builds, then zips the result for a GitHub release:
//   release/nightshade-<version>.zip       the extension (unzip, then "Load unpacked")
//   release/nightshade-cli-<version>.zip   the CLI and the bridge host (needs Node 20+)
// The extension keeps the manifest key, so every copy has the same ID and the bridge accepts it.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
execFileSync(process.execPath, ['scripts/build.mjs'], {stdio: 'inherit'});

rmSync('release', {recursive: true, force: true});
const stage = join('release', 'stage');
const ext = `nightshade-${version}`;
const cli = `nightshade-cli-${version}`;
mkdirSync(join(stage, cli), {recursive: true});

cpSync('dist/extension', join(stage, ext), {recursive: true});
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    cpSync(f, join(stage, ext, f));
    cpSync(f, join(stage, cli, f));
}
cpSync('dist/cli', join(stage, cli, 'cli'), {recursive: true});
cpSync('dist/bridge', join(stage, cli, 'bridge'), {recursive: true});
cpSync('skills', join(stage, cli, 'skills'), {recursive: true});
writeFileSync(join(stage, cli, 'README.txt'), `Nightshade ${version}: command line and agent bridge

Needs Node 20 or newer. Keep the cli and bridge folders next to each other.

  node cli/nightshade.mjs help
  node cli/nightshade.mjs bridge install     registers the bridge with your browsers
  node cli/nightshade.mjs skill install      teaches your coding agents (Claude Code, Codex,
                                             Gemini CLI, Cursor) that Nightshade is here

Then open Nightshade's options page, Agent bridge, Reconnect.
If you move this folder later, run "bridge install" and "skill install" again.
The skill itself is in skills/nightshade/SKILL.md if you prefer to copy it by hand.
Docs: https://github.com/sahajamit/nightshade
`);

function zip(name) {
    try {
        // -X leaves out extra file attributes, -r recurses, -q is quiet.
        execFileSync('zip', ['-X', '-r', '-q', `../${name}.zip`, name], {cwd: stage, stdio: 'inherit'});
    } catch (e) {
        throw new Error(`Could not run "zip" (${e.message}). Install it, or zip release/stage/${name} by hand.`);
    }
    console.log(`release/${name}.zip`);
}
zip(ext);
zip(cli);
rmSync(stage, {recursive: true, force: true});

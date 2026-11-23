// Builds the extension into dist/extension and the CLI + bridge host into dist/cli, dist/bridge.
//   node scripts/build.mjs            development build (keeps the manifest key → stable extension ID)
//   node scripts/build.mjs --store    Chrome Web Store build (drops the key; the store assigns the ID)
//   node scripts/build.mjs --watch
import * as esbuild from 'esbuild';
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';

const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

// Extension ID = first 32 hex chars of sha256(public key DER), mapped 0-f → a-p.
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

rmSync('dist', {recursive: true, force: true});
mkdirSync('dist/extension', {recursive: true});
cpSync('extension', 'dist/extension', {recursive: true});
manifest.version = pkg.version;
if (store) delete manifest.key;
writeFileSync('dist/extension/manifest.json', JSON.stringify(manifest, null, 2));

const common = {
    bundle: true,
    target: 'chrome120',
    loader: {'.config': 'text', '.md': 'text'},
    logLevel: 'info',
    legalComments: 'none',
    define: {__EXTENSION_ID__: JSON.stringify(extensionId), __VERSION__: JSON.stringify(pkg.version)},
};

const builds = [
    {...common, entryPoints: {background: 'src/background/index.ts'}, outdir: 'dist/extension', format: 'esm'},
    {...common, entryPoints: {content: 'src/content/index.ts'}, outdir: 'dist/extension', format: 'iife'},
    {...common, entryPoints: {popup: 'src/popup/popup.ts', options: 'src/options/options.ts'}, outdir: 'dist/extension', format: 'esm'},
    {...common, entryPoints: {'cli/nightshade': 'src/cli/nightshade.ts', 'bridge/host': 'src/bridge/host.ts'}, outdir: 'dist', outExtension: {'.js': '.mjs'},
        format: 'esm', platform: 'node', target: 'node20', banner: {js: '#!/usr/bin/env node'}},
];

if (watch) {
    for (const b of builds) (await esbuild.context(b)).watch();
    console.log(`watching… extension ID ${extensionId}`);
} else {
    await Promise.all(builds.map((b) => esbuild.build(b)));
    chmodSync('dist/cli/nightshade.mjs', 0o755);
    console.log(`built dist/ · extension ID ${store ? '(assigned by the store)' : extensionId}`);
}

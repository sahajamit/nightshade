/**
 * Native messaging host. Chrome starts one per connected extension instance (one per profile).
 * It pushes ~/.nightshade/config.json to the extension whenever the file changes, and writes
 * the file when the extension sends a change made in its UI.
 *
 * Protocol: 4-byte little-endian length + UTF-8 JSON, both directions (Chrome native messaging).
 */
import {watch, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {dirname, basename} from 'node:path';
import {configPath, readRaw, serialise, writeConfig} from '../cli/file';
import {validateConfig} from '../shared/config';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
const path = configPath();
let lastText = '';

/** Chrome drops the connection if a host sends more than 1 MB in one message. */
const MAX_TO_BROWSER = 1024 * 1024;
/** Far above any real config. Anything bigger is not a message from our extension. */
const MAX_FROM_BROWSER = 8 * 1024 * 1024;

function send(msg: unknown) {
    let body = Buffer.from(JSON.stringify(msg), 'utf8');
    if (body.length > MAX_TO_BROWSER) {
        body = Buffer.from(JSON.stringify({type: 'error', message: `${basename(path)} is too large to sync (over 1 MB).`}), 'utf8');
    }
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([head, body]));
}

function pushFile() {
    let text = '';
    try {
        text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    } catch (e) {
        send({type: 'error', message: `Cannot read ${path}: ${(e as Error).message}`});
        return;
    }
    if (text === lastText) {
        return;
    }
    lastText = text;
    if (!text.trim()) {
        send({type: 'config', config: null});
        return;
    }
    let raw: unknown;
    try {
        raw = readRaw(path);
        validateConfig(raw);
    } catch (e) {
        send({type: 'error', message: `${basename(path)} is invalid, keeping the previous settings. ${(e as Error).message}`});
        return;
    }
    send({type: 'config', config: raw});
}

function onMessage(msg: any) {
    if (msg?.type === 'hello') {
        send({type: 'hello', path, version: VERSION});
        lastText = '';
        pushFile();
    } else if (msg?.type === 'write') {
        try {
            const text = serialise(validateConfig(msg.config));
            if (text !== lastText) {
                lastText = writeConfig(msg.config, path);
            }
            send({type: 'written', updatedAt: msg.config.updatedAt});
        } catch (e) {
            send({type: 'error', message: `Write rejected: ${(e as Error).message}`});
        }
    }
}

// --- stdin framing ---
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (len > MAX_FROM_BROWSER) {
            process.exit(1);
        }
        if (buf.length < 4 + len) {
            break;
        }
        const body = buf.subarray(4, 4 + len).toString('utf8');
        buf = buf.subarray(4 + len);
        try {
            onMessage(JSON.parse(body));
        } catch {
            send({type: 'error', message: 'Bad message from extension'});
        }
    }
});
process.stdin.on('end', () => process.exit(0));

// --- watch the directory (editors and our atomic writes replace the file) ---
mkdirSync(dirname(path), {recursive: true});
let debounce: NodeJS.Timeout | undefined;
watch(dirname(path), (_event, name) => {
    if (name && name !== basename(path)) {
        return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(pushFile, 120);
});
// Belt and braces: some editors and sync tools miss fs events.
setInterval(pushFile, 5000);

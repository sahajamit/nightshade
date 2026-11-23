/** Reading and writing ~/.nightshade/config.json (shared by the CLI and the bridge host). */
import {mkdirSync, readFileSync, renameSync, writeFileSync, existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {validateConfig} from '../shared/config';
import type {Config} from '../shared/types';

export function nightshadeDir(): string {
    return process.env.NIGHTSHADE_HOME || join(homedir(), '.nightshade');
}

export function configPath(): string {
    return process.env.NIGHTSHADE_CONFIG || join(nightshadeDir(), 'config.json');
}

/** Raw parsed JSON, or null when the file doesn't exist. Throws on bad JSON. */
export function readRaw(path = configPath()): unknown | null {
    if (!existsSync(path)) {
        return null;
    }
    const text = readFileSync(path, 'utf8');
    if (!text.trim()) {
        return null;
    }
    return JSON.parse(text);
}

export function serialise(config: Config): string {
    return `${JSON.stringify(config, null, 2)}\n`;
}

/** Validates, then writes atomically (temp file + rename) so watchers never see half a file. */
export function writeConfig(config: Config, path = configPath()): string {
    const valid = validateConfig(config);
    const text = serialise(valid);
    // 0700 on creation: the config decides what CSS is injected into every page.
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, text, {mode: 0o600});
    renameSync(tmp, path);
    return text;
}

/** Quotes a value for /bin/sh. Single quotes, so $, backticks and spaces stay literal. */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Chrome extension IDs are 32 letters from a to p. */
export function isExtensionId(value: string): boolean {
    return /^[a-p]{32}$/.test(value);
}

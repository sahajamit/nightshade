/**
 * Change history for `nightshade undo`. Before each CLI change, the config as it was is saved
 * in ~/.nightshade/history/ with the command that changed it and a hash of the file it wrote.
 * Undo only restores when the file still matches that hash, so a later change made in the
 * extension (the picker, the options page) is never silently thrown away.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
    /** File name in the history folder. */
    id: string;
    seq: number;
    time: string;
    command: string;
    /** The config file before the change, or null when there was no file yet. */
    before: string | null;
    /** hashText() of the file the change wrote. */
    afterHash: string;
}

/**
 * sha256 of the config's content. updatedAt is left out: undo writes a fresh one (so the
 * extension takes the restored copy), and that must not count as a change made elsewhere.
 */
export function hashText(text: string): string {
    let content = text;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            delete parsed.updatedAt;
            content = JSON.stringify(parsed);
        }
    } catch {
        // Not JSON: hash it as it is.
    }
    return createHash('sha256').update(content).digest('hex');
}

/** Newest first. Ignores files it doesn't recognise. */
export function listHistory(dir: string): HistoryEntry[] {
    if (!existsSync(dir)) {
        return [];
    }
    const out: HistoryEntry[] = [];
    for (const name of readdirSync(dir)) {
        const m = /^(\d+)\.json$/.exec(name);
        if (!m) {
            continue;
        }
        try {
            const e = JSON.parse(readFileSync(join(dir, name), 'utf8'));
            if (typeof e.command === 'string' && typeof e.afterHash === 'string' && (e.before === null || typeof e.before === 'string')) {
                out.push({id: name, seq: Number(m[1]), time: String(e.time), command: e.command, before: e.before, afterHash: e.afterHash});
            }
        } catch {
            // A damaged entry is skipped rather than blocking undo.
        }
    }
    return out.sort((a, b) => b.seq - a.seq);
}

/** Saves one change and trims the folder to the newest `limit` entries. */
export function recordChange(dir: string, before: string | null, after: string, command: string, limit = HISTORY_LIMIT, now = new Date()): HistoryEntry {
    mkdirSync(dir, {recursive: true, mode: 0o700});
    const existing = listHistory(dir);
    const seq = (existing[0]?.seq ?? 0) + 1;
    const id = `${String(seq).padStart(8, '0')}.json`;
    const entry = {time: now.toISOString(), command, before, afterHash: hashText(after)};
    writeFileSync(join(dir, id), `${JSON.stringify(entry, null, 2)}\n`, {mode: 0o600});
    for (const old of existing.slice(limit - 1)) {
        rmSync(join(dir, old.id), {force: true});
    }
    return {id, seq, ...entry};
}

export interface UndoPlan {
    entry: HistoryEntry;
    /** True when the config file changed after this CLI change (for example in the extension). */
    changedSince: boolean;
}

export function planUndo(dir: string, current: string | null): UndoPlan | null {
    const entry = listHistory(dir)[0];
    if (!entry) {
        return null;
    }
    return {entry, changedSince: current === null || hashText(current) !== entry.afterHash};
}

export function dropEntry(dir: string, entry: HistoryEntry): void {
    rmSync(join(dir, entry.id), {force: true});
}

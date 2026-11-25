import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dropEntry, hashText, listHistory, planUndo, recordChange} from '../../src/cli/history';

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ns-history-'));
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

const cfg = (n: number, at = '2026-01-01T00:00:00.000Z') => JSON.stringify({version: 1, updatedAt: at, n}, null, 2);

describe('history', () => {
    it('is empty when nothing was recorded', () => {
        expect(listHistory(join(dir, 'missing'))).toEqual([]);
        expect(planUndo(dir, cfg(1))).toBeNull();
    });

    it('lists newest first and plans the newest undo', () => {
        recordChange(dir, null, cfg(1), 'nightshade init');
        recordChange(dir, cfg(1), cfg(2), 'nightshade set a.com --mode off');
        const list = listHistory(dir);
        expect(list.map((e) => e.command)).toEqual(['nightshade set a.com --mode off', 'nightshade init']);
        const plan = planUndo(dir, cfg(2))!;
        expect(plan.changedSince).toBe(false);
        expect(plan.entry.before).toBe(cfg(1));
    });

    it('steps back one change at a time', () => {
        recordChange(dir, null, cfg(1), 'one');
        recordChange(dir, cfg(1), cfg(2), 'two');
        dropEntry(dir, planUndo(dir, cfg(2))!.entry);
        const plan = planUndo(dir, cfg(1))!;
        expect(plan.entry.command).toBe('one');
        expect(plan.entry.before).toBeNull();
        expect(plan.changedSince).toBe(false);
    });

    it('ignores updatedAt when checking for outside changes', () => {
        recordChange(dir, cfg(1), cfg(2), 'two');
        expect(planUndo(dir, cfg(2, '2027-05-05T00:00:00.000Z'))!.changedSince).toBe(false);
        expect(hashText(cfg(2))).toBe(hashText(cfg(2, '2030-01-01T00:00:00.000Z')));
    });

    it('notices a change made outside the CLI, or a deleted file', () => {
        recordChange(dir, cfg(1), cfg(2), 'two');
        expect(planUndo(dir, cfg(3))!.changedSince).toBe(true);
        expect(planUndo(dir, null)!.changedSince).toBe(true);
    });

    it('keeps only the newest entries', () => {
        for (let i = 1; i <= 25; i++) {
            recordChange(dir, cfg(i - 1), cfg(i), `change ${i}`, 20);
        }
        const list = listHistory(dir);
        expect(list).toHaveLength(20);
        expect(list[0].command).toBe('change 25');
        expect(list[19].command).toBe('change 6');
    });

    it('skips damaged or unknown files', () => {
        recordChange(dir, null, cfg(1), 'one');
        writeFileSync(join(dir, '00000099.json'), '{not json');
        writeFileSync(join(dir, 'notes.txt'), 'hi');
        expect(listHistory(dir).map((e) => e.command)).toEqual(['one']);
        expect(readdirSync(dir)).toHaveLength(3);
    });
});

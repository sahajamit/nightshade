import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {addPointer, agentTargets, pointerLine, POINTER_MARKER, removePointer, renderSkill, SKILL_MARKER} from '../../src/cli/skill';

const SOURCE = readFileSync('skills/nightshade/SKILL.md', 'utf8');

describe('skill source', () => {
    it('has front matter with a name and a description', () => {
        const head = SOURCE.split('\n---')[0];
        expect(head).toMatch(/^---\nname: nightshade\n/);
        expect(head).toMatch(/\ndescription: .{100,}/);
    });
    it('mentions every fix action and mode the CLI accepts', async () => {
        const {FIX_ACTIONS, MODES} = await import('../../src/shared/types');
        for (const a of FIX_ACTIONS) expect(SOURCE).toContain(`\`${a}\``);
        for (const m of MODES) expect(SOURCE).toContain(`\`${m}\``);
    });
});

describe('renderSkill', () => {
    it('keeps the front matter first and marks the copy', () => {
        const out = renderSkill(SOURCE, 'nightshade', '1.2.3');
        expect(out.startsWith('---\nname: nightshade\n')).toBe(true);
        expect(out).toContain(SKILL_MARKER);
        expect(out).toContain('Nightshade 1.2.3');
        expect(out).not.toContain('not on PATH');
    });
    it('names the exact command when nightshade is not on PATH', () => {
        const out = renderSkill(SOURCE, "node '/opt/ns/cli/nightshade.mjs'", '1.2.3');
        expect(out).toContain("run `node '/opt/ns/cli/nightshade.mjs'` instead");
    });
    it('rejects a file without front matter', () => {
        expect(() => renderSkill('# no front matter', 'nightshade', '1')).toThrow();
    });
});

describe('pointer lines', () => {
    const line = pointerLine('~/.claude/skills/nightshade/SKILL.md');
    it('adds once and removes cleanly', () => {
        const original = '# My rules\n- be brief\n';
        const added = addPointer(original, line)!;
        expect(added).toContain(POINTER_MARKER);
        expect(addPointer(added, line)).toBeNull();
        expect(removePointer(added)).toBe(original);
    });
    it('works on an empty or missing file', () => {
        const added = addPointer('', line)!;
        expect(added).toBe(`${line}\n`);
        expect(removePointer(added)).toBe('');
    });
    it('leaves files without a pointer alone', () => {
        expect(removePointer('# nothing here\n')).toBeNull();
    });
});

describe('agentTargets', () => {
    it('puts every skill in a folder named nightshade under the home folder', () => {
        for (const t of agentTargets('/home/u')) {
            expect(t.skillDir.startsWith('/home/u/')).toBe(true);
            expect(t.skillDir.endsWith('/nightshade')).toBe(true);
        }
    });
});

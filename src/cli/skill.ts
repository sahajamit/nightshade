/**
 * Installs the Nightshade agent skill (skills/nightshade/SKILL.md) into the skills folder of
 * each coding agent found on this machine, so agents know Nightshade exists from any folder.
 * Pure helpers live here so they can be unit tested; the CLI does the file system work.
 */
import {join} from 'node:path';

export interface AgentTarget {
    /** Value for --agent. */
    id: string;
    label: string;
    /** If this folder exists, the agent is considered installed. */
    homeDir: string;
    /** Where the skill folder goes. */
    skillDir: string;
    /** Global instructions file that --pointer adds one line to, when the agent has one. */
    pointerFile?: string;
}

export function agentTargets(home: string): AgentTarget[] {
    return [
        {id: 'claude', label: 'Claude Code', homeDir: join(home, '.claude'),
            skillDir: join(home, '.claude', 'skills', 'nightshade'), pointerFile: join(home, '.claude', 'CLAUDE.md')},
        {id: 'codex', label: 'Codex (reads ~/.agents/skills)', homeDir: join(home, '.codex'),
            skillDir: join(home, '.agents', 'skills', 'nightshade'), pointerFile: join(home, '.codex', 'AGENTS.md')},
        // Gemini CLI reads ~/.agents/skills too, and warns when the same skill is in both places.
        {id: 'gemini', label: 'Gemini CLI (reads ~/.agents/skills)', homeDir: join(home, '.gemini'),
            skillDir: join(home, '.agents', 'skills', 'nightshade'), pointerFile: join(home, '.gemini', 'GEMINI.md')},
        {id: 'cursor', label: 'Cursor', homeDir: join(home, '.cursor'),
            skillDir: join(home, '.cursor', 'skills', 'nightshade')},
    ];
}

/** Marks files and lines Nightshade wrote, so uninstall only removes its own. */
export const SKILL_MARKER = '<!-- installed by `nightshade skill install` -->';
export const POINTER_MARKER = '<!-- nightshade -->';

/**
 * The installed copy of SKILL.md. When `nightshade` is not on PATH, a note names the exact
 * command to use instead, so the agent can still run it.
 */
export function renderSkill(source: string, cliCommand: string, version: string): string {
    const end = source.indexOf('\n---', 4);
    if (!source.startsWith('---\n') || end === -1) {
        throw new Error('SKILL.md has no front matter');
    }
    const head = source.slice(0, end + 4);
    let body = source.slice(end + 4);
    if (cliCommand !== 'nightshade') {
        body = `\n\n> \`nightshade\` is not on PATH on this machine. Wherever this skill says \`nightshade\`, run \`${cliCommand}\` instead.${body}`;
    }
    body += `\n## Running the CLI\n\nInstalled for Nightshade ${version}. If \`${cliCommand}\` stops working (the folder moved, or Nightshade was updated), ask the user to run \`nightshade skill install\` again from their Nightshade copy.\n`;
    return `${head}\n${SKILL_MARKER}${body}`;
}

export function pointerLine(skillPath: string): string {
    return `- Nightshade (per-site browser dark mode): when I ask about dark mode, dark themes or page colours on a website, follow ${skillPath} and use the \`nightshade\` CLI. ${POINTER_MARKER}`;
}

/** Adds the pointer line once; returns null when it is already there. */
export function addPointer(text: string, line: string): string | null {
    if (text.split('\n').some((l) => l.includes(POINTER_MARKER))) {
        return null;
    }
    const base = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`;
    return `${base}${base.length ? '\n' : ''}${line}\n`;
}

/** Removes Nightshade's pointer line (and the blank line addPointer put before it). */
export function removePointer(text: string): string | null {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.includes(POINTER_MARKER));
    if (i === -1) {
        return null;
    }
    const start = i > 0 && lines[i - 1] === '' ? i - 1 : i;
    lines.splice(start, i - start + 1);
    return lines.join('\n');
}

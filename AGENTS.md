# Nightshade for AI agents

Nightshade is a Chrome extension for per-site dark mode. You change it through the `nightshade` CLI, which edits `~/.nightshade/config.json`. With the bridge installed, open tabs update within about a second. Never edit the extension's storage directly.

If you are an agent on a user's machine rather than working on this repo, the same guidance is in the `nightshade` skill. The user installs it for every agent they use with `nightshade skill install`.

## Ground rules

- Use the CLI. It validates every change and refuses bad input with a list of problems. If you edit the JSON file by hand, run `nightshade validate` afterwards.
- Read before you write: `nightshade site <url>` tells you which rule applies to a page and the effective settings.
- Make the smallest change that answers the request. Prefer a site rule over a global change.
- Add `--json` for machine-readable output. Exit code 1 means the change was rejected and nothing was written.
- Preview with `--dry-run` when a change could reach more than the user meant (a bare domain also covers its subdomains; wildcards; global changes). It lists what each pattern covers and every setting it would change, and writes nothing.
- Every CLI change is recorded. `nightshade undo` reverts the last one (run it again to go further back), `nightshade history` lists them. Undo refuses if the file changed since in the extension, so it never drops the user's own edits; `--force` overrides. Tell the user undo exists after a change.

## Common requests

| Request | Command |
| --- | --- |
| "Turn dark mode off on example.com" | `nightshade off example.com` |
| "Turn it back on" | `nightshade on example.com` (or `nightshade unset example.com` to fall back to the default) |
| "LinkedIn already has a dark theme, just make the icons readable" | `nightshade set linkedin.com --mode native --contrast-floor 4.5 --icon-rescue on` |
| "Too bright" / "too harsh" | `nightshade set <site> --brightness 90` or `--contrast 90` |
| "Warmer, it's late" | `nightshade set <site> --warmth 20` (global: `nightshade global --warmth 20`) |
| "Photos are glaring" | `nightshade set <site> --image-dim 80` |
| "The delete button is invisible on Gmail" | `nightshade fix add mail.google.com '[aria-label="Delete"]' make-visible` |
| "Checkboxes are hard to see" | `nightshade fix add <site> '[role=checkbox]' strengthen-border` |
| "Google Docs looks broken" | `nightshade set docs.google.com --mode filter` |
| "Use my own colours on this site" | `nightshade palette set mine --bg '#1b1d21' --text '#ece6dc'` then `nightshade set <site> --mode bespoke --palette mine` |
| "The open email is still bright white" (site is dark, one panel is white) | `nightshade fix add mail.google.com body darken` |
| "Hide that promo banner" | `nightshade fix add <site> '<selector>' hide` |
| "Undo the last fix" | `nightshade fix list <site>` then `nightshade fix rm <site> <index>` |
| "Undo that" / "that went too far" | `nightshade undo` |
| "What would that change?" | the same command with `--dry-run` |
| "Leave dark sites alone" (default) | `nightshade global --unlisted skip-already-dark` |
| "Only change sites I list" | `nightshade global --unlisted only-listed` |

## Modes

- `off`: nothing changes.
- `native`: the site's own theme stays; only boosts run (contrast floor, icon rescue, image dim, warmth, brightness).
- `dynamic`: Dark Reader recolours the page.
- `filter`: the whole page is inverted and images are flipped back. Use for canvas-rendered apps.
- `bespoke`: dynamic with a named palette. Palette colours are available to custom CSS as `var(--ns-bg)`, `var(--ns-surface)`, `var(--ns-text)`, `var(--ns-muted)`, `var(--ns-link)`, `var(--ns-border)`, `var(--ns-icon)`, `var(--ns-selection)`.

## Patterns

- `example.com` matches the domain and every subdomain.
- `mail.google.com` matches that host (and its subdomains) only.
- `*.example.com` matches subdomains but not `example.com`.
- `example.com/inbox` matches that path and below.

The most specific pattern wins. A path beats a host; a longer host beats a shorter one.

## Choosing selectors for fixes

Prefer selectors that survive site redesigns: `[aria-label="Delete"]`, `[role=checkbox]`, `[data-testid="send"]`. Avoid hashed class names like `.T-I-KE` or `.css-1x2y3z`; they change on every deploy. Fix actions: `make-visible`, `invert`, `set-colour` (needs `--colour #hex`), `strengthen-border`, `leave-untouched`, `hide`, `darken`.

`darken` is for dark sites with a bright panel in them. It looks inside the selector for large light panels whose surroundings are dark, inverts only those, and flips photos back. If the site later darkens the panel itself, the fix stops applying. `body` is a fine selector for it.

## Working on the code

- `npm run build`, `npm run typecheck`, `npm test`, `npm run test:e2e`.
- Shared logic lives in `src/shared` and is used by the extension and the CLI alike. Validation changes go in `src/shared/config.ts` and need a unit test.
- The service worker only accepts a short allow-list of messages from content scripts (`src/shared/trust.ts`). Content scripts cannot read extension storage; they are told about changes with a `configChanged` message. See `SECURITY.md`.
- Icons are generated from `assets/logo/nightshade-logo.png` with `npm run icons`. `npm run package` builds the release zips.
- Config writes go through `save()` in `src/cli/nightshade.ts`, which handles `--dry-run` and records history (`src/cli/history.ts`). Change descriptions and scope wording live in `src/cli/changes.ts`.
- `skills/nightshade/SKILL.md` is the short version of this file for agents on users' machines. Keep the two in step: a unit test checks that the skill names every mode and fix action.
- After a build, reload the unpacked extension in `chrome://extensions` to pick up changes.

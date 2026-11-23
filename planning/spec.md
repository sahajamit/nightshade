# Story: Nightshade MVP, per-site dark mode with an agent interface

To be filed as GitHub issue #1 (labels: story, enhancement). Commits for this story are prefixed `[#1]`.

## Problem

General dark-mode extensions apply one look to every site. Sites that already have a dark theme get recoloured twice, and some UIs lose their controls: in webmail, for example, toolbar icons and checkbox outlines end up dark grey on near-black. Fixes in existing tools depend on hand-maintained, obfuscated class names that break whenever a site redeploys.

## Decisions

| Question | Decision |
| --- | --- |
| Build approach | Wrap Dark Reader's engine (MIT, `darkreader` npm package) and vendor its community fix lists. Our code owns rules, UI, boosts, picker and the agent interface. |
| Sites without a rule | Recolour light sites; leave sites that are already dark in their own theme (boosts still run). |
| Schedule | Always on (no time-based switching in the MVP). |
| Agent interface | Config file + CLI, synced to the browser by a native-messaging bridge. |
| Devices | One machine for now; multiple Chrome profiles supported (each syncs through the same file). |
| UI theme | The extension's own UI is always dark. |

## Scope (MVP)

1. Site rules with URL patterns (domain, host, `*.` subdomains, path prefix); most specific wins.
2. Modes: off, native, dynamic, filter, bespoke.
3. Look: brightness, contrast, warmth (sepia), grayscale, image brightness, font override, text stroke, palette, custom CSS.
4. Boosts: contrast floor (off, 3, 4.5, 7) for text, control borders, monochrome SVG and mask icons; icon rescue for small dark glyph images; image dimming.
5. Element picker with six actions, stable selectors (aria-label, role, test id, readable id, then a short path), editable before saving. Also from the context menu.
6. Popup, options page (sites, global, palettes, raw config, bridge), keyboard shortcuts (`Alt+Shift+N`, `Alt+Shift+P`), pause for an hour.
7. CLI: show, site, set, on, off, unset, fix add/list/rm, css, global, palette, validate, init, import, export, schema, bridge install/uninstall/status. `--json` everywhere.
8. Bridge: newer `updatedAt` wins on connect; file changes pushed live; UI changes written back atomically; invalid files rejected without losing settings.

## Out of scope (later stories)

Schedule and automation, Chrome Web Store listing, Windows bridge registration, a page-world stylesheet proxy for CSS-in-JS sites, site-editor live preview, suggested sites.

## Acceptance

- Unit tests: config validation and resolution, URL matching, colour contrast, fix-file parsing, CSS generation.
- End-to-end (Playwright Chromium, extension loaded, bridge installed in a throwaway profile):
  light page recoloured; dark page detected and left native with icons, borders and faint text lifted to the floor; CLI change reaches an open tab; filter mode; picker saves a fix to the file; invalid hand edit rejected; popup and options render.

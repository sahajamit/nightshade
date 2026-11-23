---
name: nightshade
description: Change dark mode in the user's browser with the Nightshade extension and its `nightshade` CLI. Use whenever the user asks to turn dark mode or a dark theme on or off for a website, to make a site darker, lighter, warmer or easier on the eyes, to use their own colours or a theme such as Dracula on a site, to keep a site's own dark theme, or to fix something a dark theme broke (invisible icons or buttons, faint checkboxes, low-contrast text, a panel that is still bright white). Also use when the user mentions Nightshade by name.
---

# Nightshade

Nightshade is a Chrome extension for per-site dark mode. All of its settings live in one JSON file, and the `nightshade` CLI edits that file and validates every change. When the bridge is installed, open tabs update within about a second. Never edit the extension's storage, and prefer the CLI over editing the JSON by hand.

## Before you change anything

1. Check the CLI works: `nightshade version`. If it is not found, see "Running the CLI" at the end.
2. See what applies now: `nightshade site <url-or-domain>` (the rule that matches, and why) or `nightshade show` (everything).
3. Make the smallest change that answers the request. Prefer a site rule over a global change.
4. Add `--json` when you need to parse output. Exit code 1 means the change was rejected and nothing was written; the output lists the problems.
5. Tell the user what you changed, in one line. If `nightshade bridge status` says the bridge is not connected, tell them to open Nightshade's options page, Agent bridge, Reconnect, or to use Config file, Import there.

## Common requests

| Request | Command |
| --- | --- |
| Dark mode on for a site | `nightshade on example.com` (or `nightshade set example.com --mode dynamic`) |
| Dark mode off for a site | `nightshade off example.com` |
| Back to the default for a site | `nightshade unset example.com` |
| Only the sites I list should change | `nightshade global --unlisted only-listed` |
| Every light site dark, leave dark sites alone | `nightshade global --unlisted skip-already-dark` |
| Site has its own dark theme, keep it | `nightshade set example.com --mode native` |
| Icons or text too faint | `nightshade set example.com --contrast-floor 4.5 --icon-rescue on` |
| Too bright or too harsh | `nightshade set example.com --brightness 90` or `--contrast 90` |
| Warmer, it is late | `nightshade set example.com --warmth 20` (all sites: `nightshade global --warmth 20`) |
| Photos glaring | `nightshade set example.com --image-dim 80` |
| Page looks broken (canvas apps, Google Docs) | `nightshade set example.com --mode filter` |
| Panel still bright white on a dark site | `nightshade fix add example.com body darken` |
| A button or icon is invisible | `nightshade fix add example.com '[aria-label="Delete"]' make-visible` |
| Checkboxes hard to see | `nightshade fix add example.com '[role=checkbox]' strengthen-border` |
| Hide something | `nightshade fix add example.com '<selector>' hide` |
| Undo a fix | `nightshade fix list example.com` then `nightshade fix rm example.com <index>` |

## Own colours and themes

A palette is a set of eight colours: `bg surface text muted link border icon selection`. Create one, then point a site at it with bespoke mode:

```sh
nightshade palette set dracula --bg '#282a36' --surface '#44475a' --text '#f8f8f2' \
  --muted '#6272a4' --link '#8be9fd' --border '#44475a' --icon '#bd93f9' --selection '#44475a'
nightshade set github.com --mode bespoke --palette dracula
```

`nightshade palette list` shows existing palettes. Use the theme's published colours when the user names a known theme.

## Modes

- `off`: nothing changes.
- `native`: keep the site's own theme; only the boosts run (contrast floor, icon rescue, image dim, warmth, brightness).
- `dynamic`: Dark Reader's engine recolours the page.
- `filter`: invert the whole page and flip images back.
- `bespoke`: dynamic with a named palette.

## Patterns and selectors

- `example.com` matches the domain and all subdomains; `mail.example.com` only that host; `*.example.com` subdomains only; `example.com/inbox` that path and below. The most specific pattern wins.
- For fixes, prefer selectors that survive redesigns: `[aria-label="..."]`, `[role=...]`, `[data-testid="..."]`. Avoid hashed class names like `.css-1x2y3z`.
- Fix actions: `make-visible`, `invert`, `set-colour` (needs `--colour '#hex'`), `strengthen-border`, `leave-untouched`, `hide`, `darken`.
- If you cannot work out a selector, tell the user to press Alt+Shift+P on the page and click the element; Nightshade's picker saves the fix with a stable selector.

## Reference

`nightshade help` lists every command. `nightshade schema` prints every field and its allowed values. `nightshade validate` checks the file without changing it.

<p align="center"><img src="docs/images/logo.png" alt="Nightshade logo: a crescent moon holding a berry" width="112" height="112"></p>

# Nightshade

[![CI](https://github.com/sahajamit/nightshade/actions/workflows/ci.yml/badge.svg)](https://github.com/sahajamit/nightshade/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-e2a75c.svg)](LICENSE)

Per-site dark mode for Chrome that you control site by site, from a popup or by asking your AI agent.

## Why I built this

Bright screens strain my eyes, so I run dark mode everywhere I can. For years that meant [Dark Reader](https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh), the best-known dark-mode extension on the Chrome Web Store. It is a great piece of work, but three things kept bothering me.

**1. I was handing my whole browser to code I had never read.** A dark-mode extension needs to read and change every page you open: your inbox, your bank, your company's internal tools. Installing one from the Chrome Web Store means trusting a bundle that updates itself silently, that you never see the source of, and that can change owners overnight. Extensions have been bought and quietly turned into spyware before. With AI agents now reading web pages, browsing for us and running tools on our machines, the browser is a bigger target than ever. I did not want an opaque, auto-updating extension sitting in the middle of all that.

**2. Configuring it one site at a time, by hand, was tedious.** Most sites I use already have a good dark theme (Gmail, LinkedIn, X). I did not want them recoloured, I wanted them left alone, with only the bits their dark themes break fixed: an invisible delete button, checkboxes you cannot see, an open email that is still bright white. Other sites I wanted dark, and a few I wanted in my own colours. Getting there meant clicking through a popup on every site, and the settings lived inside the extension where nothing else could see or change them.

**3. I wanted to just tell my agent.** I already ask an AI agent to do most of my computer chores. "Turn dark mode on for these three sites and leave everything else light." "Use a Dracula palette on GitHub." "The checkboxes on Gmail are hard to see." Those should be one sentence to an agent, not ten minutes of clicking.

So I built Nightshade, for myself first:

- **You can read all of it.** Every line is here, it is MIT-licensed, and you build it or download a release yourself. It never updates itself behind your back, has no analytics, and talks to no server. The only code it depends on is [Dark Reader](https://github.com/darkreader/darkreader)'s open-source colour engine, pinned to an exact version.
- **Your settings are one plain JSON file**, `~/.nightshade/config.json`, that you or any agent can read, diff, back up and edit.
- **Any agent can drive it.** A small CLI validates every change, and an optional bridge pushes edits into your open tabs within a second. One command installs a skill that tells your coding agents Nightshade is there, so you can ask for a change from any folder. It works with Claude Code, Codex, Cursor, Gemini CLI or a shell script: anything that can run a command.

What that looks like in practice:

```sh
# Only these sites go dark; everything else stays as the site made it
nightshade global --unlisted only-listed
nightshade set github.com --mode dynamic
nightshade set news.ycombinator.com --mode dynamic

# Your own theme, for example Dracula colours, on a site of your choice
nightshade palette set dracula --bg '#282a36' --surface '#44475a' --text '#f8f8f2' \
  --muted '#6272a4' --link '#8be9fd' --border '#44475a' --icon '#bd93f9' --selection '#44475a'
nightshade set github.com --mode bespoke --palette dracula

# Sites with their own dark theme: keep it, just fix what it breaks
nightshade set mail.google.com --mode native --contrast-floor 4.5
nightshade fix add mail.google.com body darken      # the white open-email pane
```

Or just say it to your agent and let it run those for you.

## What it does

Nightshade is built on Dark Reader's colour engine. What it adds:

- **One rule per site.** Each site gets its own mode, sliders, palette, custom CSS and element fixes. The most specific rule wins (`mail.google.com/mail` beats `mail.google.com` beats `google.com`).
- **Five modes.** Off, Native (keep the site's own dark theme), Dynamic (Dark Reader recolouring), Filter (full-page invert, for canvas apps like Google Docs) and Bespoke (your own palette).
- **Boosts that fix what dark themes break.** A contrast floor lifts dim text, icons and checkbox borders until they reach 3:1, 4.5:1 or 7:1. Icon rescue lightens small dark glyph images. Both find elements by role and size, not by class names, so they keep working when a site ships new CSS.
- **Fix an element.** Point at anything broken, pick *make visible*, *invert*, *set colour*, *strengthen border*, *leave untouched*, *hide* or *darken bright areas*. The last one fixes a dark site that still shows one panel in white (webmail's open message, for example): only light panels on a dark background are inverted, and photos are flipped back. The fix is saved to that site's rule with a stable selector.
- **Agent-friendly by design.** All settings live in one JSON file (`~/.nightshade/config.json`) with a CLI that validates every change. An optional native-messaging bridge pushes file changes into open tabs within a second, so "make LinkedIn warmer" is one command for an agent.

![A dim dark-theme inbox with icons and checkboxes lifted to readable contrast](docs/images/boosts.png)

## Install

Nightshade is not on the Chrome Web Store. You load it yourself, which takes a minute.

### From a release (no build tools needed)

1. Download `nightshade-<version>.zip` from the [latest release](https://github.com/sahajamit/nightshade/releases/latest).
2. Unzip it somewhere you will keep it (Chrome loads the extension from that folder every time it starts).
3. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the unzipped `nightshade-<version>` folder.

To update, replace the folder's contents with the new release and press the reload button on Nightshade's card in `chrome://extensions`. Your settings are kept.

The same steps work in Chromium, Brave and Edge. Each release also carries `nightshade-cli-<version>.zip` (the command line and the agent bridge, for Node 20 or newer) and `SHA256SUMS.txt`.

### From source

```sh
git clone https://github.com/sahajamit/nightshade.git
cd nightshade
npm install
npm run build
```

Then in Chrome: open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose `dist/extension`.

### After installing

- Do the **Load unpacked** step in each Chrome profile where you want Nightshade.
- If you also run Dark Reader or another dark-mode extension, switch it off so the two don't stack.
- Chrome may show a "Disable developer mode extensions" reminder at startup. That is normal for any extension loaded this way.

### Set it up for your AI agent (optional)

From a source checkout:

```sh
npm link                      # puts `nightshade` on your PATH
nightshade bridge install     # registers the bridge with Chrome, Chromium, Brave and Edge
nightshade skill install      # tells your coding agents that Nightshade is here
```

From the release's `nightshade-cli-<version>.zip`, unzip it and run `node cli/nightshade.mjs bridge install` and `node cli/nightshade.mjs skill install` (and use `node cli/nightshade.mjs` wherever this page says `nightshade`). The bridge is for macOS and Linux for now.

`skill install` copies [skills/nightshade/SKILL.md](skills/nightshade/SKILL.md) into the skills folder of every coding agent it finds:

| Agent | Skill goes to |
| --- | --- |
| Claude Code | `~/.claude/skills/nightshade/` |
| Codex, Gemini CLI | `~/.agents/skills/nightshade/` (both read this shared folder) |
| Cursor | `~/.cursor/skills/nightshade/` |

Start a new agent session afterwards. From then on, "use Dracula colours on GitHub" or "the checkboxes on Gmail are hard to see" works from any folder: the agent loads the skill and runs the right commands. Useful options:

- `--agent claude,codex` installs for those agents only.
- `--pointer` also adds one line to the agent's global instructions file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`), for agents or setups that do not load skills.
- `nightshade skill status` shows what is installed; `nightshade skill uninstall` removes only what Nightshade wrote.

If `nightshade` is not on your PATH (for example, you run it from the release zip), the installed skill names the exact command to run instead. Run `skill install` again after you move or update your Nightshade copy. Any other agent can use the same file: point it at `skills/nightshade/SKILL.md` or [AGENTS.md](AGENTS.md).

Every build, from source or from a release, has the same extension ID (`cilhiaedhodolblheagjkpjgfnananpf`), because the manifest carries a fixed public key. The bridge only accepts that ID, so it works without extra setup.

Open Nightshade's options page → **Agent bridge** → **Reconnect** (or restart Chrome). From then on:

```sh
nightshade set linkedin.com --mode native --contrast-floor 4.5
nightshade set example.com --mode bespoke --palette lamplight --warmth 15
nightshade fix add mail.google.com '[role=checkbox]' strengthen-border
nightshade off mybank.example
nightshade site https://mail.google.com/   # what applies here, and why
nightshade show --json
```

Changes made in the popup are written back to the same file, so the file is always the full picture. Without the bridge, the extension works on its own and the options page can import and export the file.

See [AGENTS.md](AGENTS.md) for the full guide written for AI agents (the skill is its short version), and [docs/agent-bridge.md](docs/agent-bridge.md) for how the bridge works.

## Using it

| Where | What |
| --- | --- |
| Toolbar popup | Mode for this site, brightness, contrast, warmth, image brightness, contrast floor, icon rescue, palette, pause for an hour |
| `Alt+Shift+N` | Turn Nightshade on or off for this site |
| `Alt+Shift+P`, or right-click → *Nightshade: fix this element* | Fix one element |
| Options page | All site rules, global defaults, palettes, the raw config, bridge status |

Sites without a rule follow the global default. Out of the box that means: recolour light sites with Dynamic mode, and leave sites that are already dark alone (only the boosts run there).

## Permissions and privacy

Nightshade runs on every site (`<all_urls>`), because dark mode has to restyle whatever page you open, and Dark Reader's engine needs to read the stylesheets and images a page loads from other origins. It has no analytics, talks to no server of its own and loads no remote code. The `nativeMessaging` permission is used only by the optional bridge, and does nothing until you run `nightshade bridge install`.

[SECURITY.md](SECURITY.md) lists each permission, the trust boundaries, and how to report a vulnerability.

## Configuration

```json
{
  "version": 1,
  "global": { "unlisted": "skip-already-dark", "mode": "dynamic", "contrastFloor": 3, "iconRescue": true },
  "palettes": { "lamplight": { "bg": "#1b1d21", "text": "#ece6dc", "...": "..." } },
  "sites": [
    { "match": ["mail.google.com"], "mode": "native", "contrastFloor": 4.5,
      "fixes": [{ "selector": "[role=checkbox]", "action": "strengthen-border" }] },
    { "match": ["docs.google.com"], "mode": "filter" }
  ]
}
```

`nightshade schema` prints every field with its allowed values. `nightshade validate` checks a file without touching anything.

## Development

```sh
npm run build        # dist/extension, dist/cli, dist/bridge
npm run package      # release/nightshade-<version>.zip and release/nightshade-cli-<version>.zip
npm run icons        # regenerate every icon from assets/logo/nightshade-logo.png
npm run watch
npm run typecheck
npm test             # unit tests (vitest)
npm run test:e2e     # loads the extension in Playwright's Chromium against local fixtures
node test/e2e/run.mjs --real   # also visits a few public sites and saves screenshots
```

Source layout:

```
src/shared      config model, validation, URL matching, colour maths, CSS generation
src/background  service worker: rule resolution, Dark Reader fix lists, image analysis, bridge client
src/content     content script: modes, dark-page detection, boosts, element picker
src/popup       toolbar popup
src/options     options page
src/cli         the nightshade CLI
src/bridge      native-messaging host that syncs the config file
skills/nightshade  the agent skill installed by `nightshade skill install`
vendor/darkreader  Dark Reader's community site-fix lists (MIT)
assets/logo     master logo; icons are derived from it
```

`npm run update-fixes` refreshes the vendored Dark Reader lists from upstream.

Pushing a tag like `v0.1.0` (matching the version in `package.json`) runs the release workflow, which builds, tests and attaches the zips to a GitHub release. See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.

### Known limits

- Chrome doesn't let extensions run on `chrome://` pages or the Chrome Web Store.
- Dark Reader's page-world stylesheet proxy can't be injected from a content script, so a few CSS-in-JS sites that only change styles through the CSSOM may update their dark colours a beat late.
- Already-dark detection runs once per page load. A single-page app that changes theme later needs a rule.

## Credits and licence

MIT. Nightshade is an independent project and is not affiliated with or endorsed by Dark Reader. It bundles the [darkreader](https://www.npmjs.com/package/darkreader) library and vendors Dark Reader's site-fix lists, both MIT-licensed by Dark Reader Ltd. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

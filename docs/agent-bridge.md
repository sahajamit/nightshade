# The agent bridge

The bridge keeps the extension and `~/.nightshade/config.json` in sync, so a CLI command (typed by you or run by an agent) reaches open tabs without touching the browser.

```
nightshade CLI ──writes──▶ ~/.nightshade/config.json ◀──watches/writes── bridge host (Node)
                                                                              │ native messaging
                                                                              ▼
                                         extension service worker ──storage──▶ content scripts in every tab
```

## How it works

1. `nightshade bridge install` writes a native messaging manifest named `dev.nightshade.bridge.json` into each installed browser's `NativeMessagingHosts` folder, plus a small launcher script at `~/.nightshade/bridge-host.sh` that starts `dist/bridge/host.mjs` with the Node you installed with.
2. When the extension starts, it calls `chrome.runtime.connectNative('dev.nightshade.bridge')`. Chrome launches the host for that profile. Two profiles means two hosts watching the same file, which keeps the profiles in sync with each other too.
3. On connect, the host sends the file. The newer `updatedAt` wins: if the file is newer, the extension adopts it; if the extension is newer, it sends its config back and the host writes it.
4. After that, the host watches the folder and pushes every change. Changes made in the popup or options page are sent to the host, which writes the file atomically (temporary file, then rename).
5. Every write is validated on both sides. A broken hand edit is reported in the options page (Agent bridge tab) and the extension keeps its previous settings.

If the host isn't installed, the extension retries every five minutes and otherwise works normally.

## Extension IDs

Native messaging only accepts extensions listed in the manifest's `allowed_origins`. Every build (from source, or a zip from GitHub Releases) has a fixed public key in `extension/manifest.json`, so an unpacked copy always gets the same ID (`cilhiaedhodolblheagjkpjgfnananpf`), and `bridge install` allows that ID by default. Only the public half of the key is in the repository; the ID does not depend on who built the copy or where it is unzipped.

A Chrome Web Store build (`node scripts/build.mjs --store`) drops the key and gets an ID from the store. Allow it with:

```sh
nightshade bridge install --extension-id <store-id>
```

The same flag covers a fork that changes or removes the key: copy the ID from `chrome://extensions`. IDs are checked (32 letters, a to p) and nothing else is ever added to `allowed_origins`.

## Custom locations

- `NIGHTSHADE_HOME` moves the whole folder (default `~/.nightshade`).
- `NIGHTSHADE_CONFIG` points at a specific config file.
- `--user-data-dir <dir>` installs the manifest for a browser started with `--user-data-dir` (it looks in `<dir>/NativeMessagingHosts`).

Both variables are baked into the launcher script at install time, because the browser starts the host with a minimal environment.

## Windows

Chrome on Windows finds native hosts through the registry (`HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.nightshade.bridge`). `bridge install` doesn't write that yet.

## Removing it

```sh
nightshade bridge uninstall
```

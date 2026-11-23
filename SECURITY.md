# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability** (direct link: https://github.com/sahajamit/nightshade/security/advisories/new). That opens a private thread with the maintainer.

Include what you can: the version or commit, your browser and OS, steps to reproduce, and what an attacker gains. You should get a first reply within a week. Please give a fix a reasonable chance to ship before you publish details.

Only the latest release and the `main` branch receive fixes.

## What Nightshade can touch

Nightshade is a dark-mode extension, so it needs wide access. This is what it asks for and why:

| Permission | Why |
| --- | --- |
| Content script on `<all_urls>` | Dark mode has to restyle whatever page you open. |
| Host permission `<all_urls>` | Dark Reader's engine must read stylesheets and images that a page loads from other origins, and the service worker fetches them on the page's behalf. |
| `storage` | Your settings live in `chrome.storage.local`. |
| `alarms` | "Pause for an hour" and the bridge's reconnect timer. |
| `contextMenus` | The "Nightshade: fix this element" menu entry. |
| `nativeMessaging` | The optional agent bridge. Nothing runs unless you install the host with `nightshade bridge install`. |

Nightshade has no analytics, makes no requests to any server of its own, and loads no remote code. The only network requests it adds are re-fetches of stylesheets and images the page already uses.

## Trust boundaries

- **Web pages are untrusted.** They cannot message the extension (no `externally_connectable`, no web-accessible resources).
- **Content scripts are less trusted than extension pages**, because they run inside web pages. The service worker accepts only the messages a page needs from them (resolve the rule for this page, fetch a stylesheet or image, analyse an icon, report state, save a picker fix for the page's own site). Reading or replacing the config is limited to the popup and the options page. Extension storage is closed to content scripts (`TRUSTED_CONTEXTS`).
- **Fetches made for a page** are limited to `http:` and `https:` URLs, are sent without cookies, and only return responses served as `text/css` or `image/*`.
- **The config is trusted input from you.** `~/.nightshade/config.json` (and anything you import in the options page) can contain custom CSS that is injected into the sites you list, the same way a user-style manager works. Custom CSS can hide or restyle anything on a page and can load images from other servers. Do not import a config you have not read, and treat any program or agent that can write the file as able to restyle your browsing. The file is created with mode `0600` in a `0700` folder. Every other field is validated: colours must be hex, numbers are range-checked, selectors and font names must be self-contained (no braces, no unclosed quotes or brackets).
- **The bridge host** is a small Node script started by the browser. Its native messaging manifest lists only Nightshade's extension ID in `allowed_origins`, so no other extension can talk to it. It reads and writes one file (the config), validates every message, and writes atomically.
- **Vendored site fixes** in `vendor/darkreader` come from Dark Reader's repository and include CSS. They change only through a reviewed commit (`npm run update-fixes`), never at runtime.

## The key in the manifest

`extension/manifest.json` contains a `key` field. It is a public key, there on purpose: it gives every unpacked copy the same extension ID, which the bridge's `allowed_origins` relies on. The matching private key is not in this repository and is not needed to build or run Nightshade.

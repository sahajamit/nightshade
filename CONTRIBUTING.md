# Contributing

Thanks for taking a look. Bug reports, site-specific fixes and pull requests are welcome.

## Setup

```sh
git clone https://github.com/sahajamit/nightshade.git
cd nightshade
npm install
npm run build
```

Load `dist/extension` in `chrome://extensions` (Developer mode, **Load unpacked**). After each build, press the reload button on the extension's card.

## Before you open a pull request

```sh
npm run typecheck
npm test             # unit tests
npm run test:e2e     # builds, then drives the extension in Playwright's Chromium
```

The first e2e run needs a browser: `npx playwright install chromium`.

## Guidelines

- Keep a pull request to one change. Open an issue first for anything large.
- Shared logic goes in `src/shared` and is used by the extension and the CLI alike. Changes to validation (`src/shared/config.ts`) need a unit test.
- A new message to the service worker must be added to the allow-list in `src/shared/trust.ts` only if a content script really needs it. See [SECURITY.md](SECURITY.md) for the trust boundaries.
- The extension's own UI is dark only.
- Do not edit `vendor/darkreader` by hand. Run `npm run update-fixes` and commit the result on its own.
- Toolbar icons are generated: change `assets/logo/` or `scripts/make-icons.mjs`, then run `npm run icons`.
- A site that looks wrong is best reported with its URL, the mode shown in the popup, and a screenshot.

## Security

Please do not file security problems as public issues. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is released under the MIT licence of this project.

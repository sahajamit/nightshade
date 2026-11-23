# Third-party notices

Nightshade includes code and data from Dark Reader (https://github.com/darkreader/darkreader):

- the `darkreader` npm package (bundled into `content.js`)
- `vendor/darkreader/dynamic-theme-fixes.config`, `inversion-fixes.config` and `dark-sites.config` (bundled into `background.js`)

The fix lists are unmodified copies of the files in Dark Reader's `src/config` folder (refreshed with `npm run update-fixes`); the licence text is also kept next to them in `vendor/darkreader/LICENSE`. Nightshade is not affiliated with or endorsed by Dark Reader.

Both are distributed under the following licence:

```
MIT License

Copyright (c) 2026 Dark Reader Ltd.

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

// Refreshes Dark Reader's community site-fix lists in vendor/darkreader from upstream main.
import {writeFileSync} from 'node:fs';
const base = 'https://raw.githubusercontent.com/darkreader/darkreader/main/src/config/';
for (const name of ['dynamic-theme-fixes.config', 'inversion-fixes.config', 'dark-sites.config']) {
    const res = await fetch(base + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(`vendor/darkreader/${name}`, text);
    console.log(`${name}: ${text.split('\n').length} lines`);
}

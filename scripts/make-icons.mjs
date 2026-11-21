// Draws the toolbar icons (a crescent moon on a dark tile) as PNGs, with no dependencies.
// Variants: on (amber), native (soft blue), off (grey).
import {writeFileSync, mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});
const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
};
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TILE = hex('#16181b');
const VARIANTS = {on: hex('#e2a75c'), native: hex('#8fb5d9'), off: hex('#7d776e')};

function draw(size, moon) {
    const S = 4; // supersampling
    const out = Buffer.alloc(size * size * 4);
    const r = 0.22; // tile corner radius (fraction)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let tile = 0, m = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
            const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
            // rounded square
            const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
            const inTile = dx * dx + dy * dy <= r * r;
            if (!inTile) continue;
            tile++;
            // crescent: big disc minus offset disc
            const inA = (u - 0.47) ** 2 + (v - 0.52) ** 2 <= 0.3 ** 2;
            const inB = (u - 0.62) ** 2 + (v - 0.4) ** 2 <= 0.25 ** 2;
            if (inA && !inB) m++;
        }
        const n = S * S, i = (y * size + x) * 4;
        const a = tile / n;
        if (a === 0) continue;
        const t = tile ? m / tile : 0;
        out[i] = Math.round(TILE[0] * (1 - t) + moon[0] * t);
        out[i + 1] = Math.round(TILE[1] * (1 - t) + moon[1] * t);
        out[i + 2] = Math.round(TILE[2] * (1 - t) + moon[2] * t);
        out[i + 3] = Math.round(a * 255);
    }
    return png(size, out);
}

mkdirSync('extension/icons', {recursive: true});
for (const [name, colour] of Object.entries(VARIANTS)) {
    for (const size of [16, 32, 48, 128]) {
        writeFileSync(`extension/icons/${name}-${size}.png`, draw(size, colour));
    }
}
console.log('icons written');

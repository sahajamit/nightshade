// Derives every icon from the master logo in assets/logo/nightshade-logo.png, with no dependencies.
//
//   extension/icons/{on,native,off}-{16,32,48,128}.png   toolbar and extension icons
//   docs/images/logo.png                                 256 px logo for the README
//
// The master is a flat two-colour image: an amber mark on a dark rounded tile. The script reads
// how much "mark" each pixel holds, redraws the tile with exact geometry, and paints the mark in
// one colour per state: on (amber), native (soft blue: the site's own dark theme is kept) and
// off (grey). Each output pixel is the average of the master pixels it covers, so small sizes
// stay as sharp as the pixel grid allows. Run with: npm run icons
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {deflateSync, inflateSync} from 'node:zlib';

const MASTER = process.env.NIGHTSHADE_LOGO || 'assets/logo/nightshade-logo.png';
const OUT = process.env.NIGHTSHADE_ICON_OUT || '.';

// --- PNG in and out (8-bit RGB or RGBA, not interlaced) ----------------------
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
function encodePng(size, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const stride = size * 4 + 1;
    const raw = Buffer.alloc(stride * size);
    for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
function decodePng(file) {
    const buf = readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
    let pos = 8, width = 0, height = 0, channels = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) throw new Error(`${file}: need an 8-bit RGB or RGBA PNG without interlacing`);
            channels = data[9] === 6 ? 4 : 3;
        } else if (type === 'IDAT') {
            idat.push(data);
        }
        pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const px = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let i = 0; i < stride; i++) {
            const a = i >= channels ? px[y * stride + i - channels] : 0;
            const b = y ? px[(y - 1) * stride + i] : 0;
            const c = y && i >= channels ? px[(y - 1) * stride + i - channels] : 0;
            let v = line[i];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            px[y * stride + i] = v & 255;
        }
    }
    return {width, height, channels, px};
}

// --- the master as a "how much mark is here" map -----------------------------
const master = decodePng(MASTER);
if (master.width !== master.height) throw new Error('The master logo must be square');
const N = master.width;
// The mark is warm (red well above blue); the tile and the corners outside it are neutral.
const WARM = 110;
const mark = new Float32Array(N * N);
for (let i = 0; i < N * N; i++) {
    const r = master.px[i * master.channels], b = master.px[i * master.channels + 2];
    mark[i] = Math.min(1, Math.max(0, (r - b - 12) / (WARM - 12)));
}
// Summed-area table, so the average over any pixel footprint is four lookups.
const sat = new Float64Array((N + 1) * (N + 1));
for (let y = 0; y < N; y++) {
    let row = 0;
    for (let x = 0; x < N; x++) {
        row += mark[y * N + x];
        sat[(y + 1) * (N + 1) + x + 1] = sat[y * (N + 1) + x + 1] + row;
    }
}
// Where the mark sits in the master, as fractions of its size.
const box = {x0: 1, y0: 1, x1: 0, y1: 0};
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (mark[y * N + x] > 0.5) {
        box.x0 = Math.min(box.x0, x / N); box.x1 = Math.max(box.x1, (x + 1) / N);
        box.y0 = Math.min(box.y0, y / N); box.y1 = Math.max(box.y1, (y + 1) / N);
    }
}
if (box.x1 <= box.x0) throw new Error(`${MASTER}: no amber mark found`);
const markSpan = Math.max(box.x1 - box.x0, box.y1 - box.y0);
const markCentre = {x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2};

function markCoverage(x0, y0, x1, y1) {
    const cx = (v) => Math.min(N, Math.max(0, Math.round(v * N)));
    const ax = cx(x0), ay = cx(y0), bx = Math.max(cx(x1), ax + 1), by = Math.max(cx(y1), ay + 1);
    if (bx > N || by > N) return 0;
    const sum = sat[by * (N + 1) + bx] - sat[ay * (N + 1) + bx] - sat[by * (N + 1) + ax] + sat[ay * (N + 1) + ax];
    return sum / ((bx - ax) * (by - ay));
}

// --- drawing ------------------------------------------------------------------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TILE = hex('#16181b');
const STATES = {on: hex('#e2a75c'), native: hex('#8fb5d9'), off: hex('#7d776e')};
const RADIUS = 0.22; // tile corner radius, as a fraction of the size

function tileCoverage(x, y, size) {
    const S = 8;
    let inside = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
        const dx = Math.max(Math.abs(u - 0.5) - (0.5 - RADIUS), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - RADIUS), 0);
        if (dx * dx + dy * dy <= RADIUS * RADIUS) inside++;
    }
    return inside / (S * S);
}

/**
 * `fill` is how much of the tile the mark spans (small icons need a bigger mark to read).
 * `firm` pushes half-covered pixels towards full or empty, which keeps edges crisp at 16 px.
 */
function draw(size, colour, {fill = markSpan, firm = 0} = {}) {
    const zoom = fill / markSpan;
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const alpha = tileCoverage(x, y, size);
        if (alpha === 0) continue;
        // The mark is centred on the tile, whatever its place in the master.
        const sx = (v) => markCentre.x + (v / size - 0.5) / zoom;
        const sy = (v) => markCentre.y + (v / size - 0.5) / zoom;
        let t = markCoverage(sx(x), sy(y), sx(x + 1), sy(y + 1));
        if (firm) {
            const s = t * t * (3 - 2 * t);
            t = t + (s - t) * firm;
        }
        const i = (y * size + x) * 4;
        for (let k = 0; k < 3; k++) out[i + k] = Math.round(TILE[k] * (1 - t) + colour[k] * t);
        out[i + 3] = Math.round(alpha * 255);
    }
    return encodePng(size, out);
}

const SIZES = {16: {fill: 0.78, firm: 1}, 32: {fill: 0.74, firm: 0.6}, 48: {fill: 0.7, firm: 0.3}, 128: {fill: 0.66}};

mkdirSync(`${OUT}/extension/icons`, {recursive: true});
mkdirSync(`${OUT}/docs/images`, {recursive: true});
for (const [state, colour] of Object.entries(STATES)) {
    for (const [size, opts] of Object.entries(SIZES)) {
        writeFileSync(`${OUT}/extension/icons/${state}-${size}.png`, draw(Number(size), colour, opts));
    }
}
writeFileSync(`${OUT}/docs/images/logo.png`, draw(256, STATES.on, {fill: 0.66}));
console.log(`icons written from ${MASTER}`);

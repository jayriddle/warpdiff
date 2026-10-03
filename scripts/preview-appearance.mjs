// Local-only appearance/consent preview and request recorder. No forwarding.
// node scripts/preview-appearance.mjs -> http://127.0.0.1:8081/?usageTest=1
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.WARPDIFF_PREVIEW_PORT || 8081);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
let events = 0;
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__goatcounter_test__/count') {
        console.log(JSON.stringify({ request: ++events, ...Object.fromEntries(url.searchParams) }));
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
        res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
        return;
    }
    try {
        const pathname = decodeURIComponent(url.pathname);
        let filename = path.resolve(root, '.' + pathname);
        if ((filename !== root && !filename.startsWith(root + path.sep)) || pathname.split('/').some(part => part.startsWith('.')) || pathname.startsWith('/node_modules/')) {
            res.writeHead(403); res.end(); return;
        }
        if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
        const data = await readFile(filename);
        const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (range) {
            const start = Number(range[1]), end = Math.min(Number(range[2] || data.length - 1), data.length - 1);
            if (start > end || start >= data.length) { res.writeHead(416); res.end(); return; }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
            res.end(data.subarray(start, end + 1));
        } else { res.writeHead(200, headers); res.end(data); }
    } catch (_) { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Appearance + usage preview: http://127.0.0.1:${port}/?usageTest=1`));

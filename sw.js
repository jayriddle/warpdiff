// Keep in sync with APP_VERSION in index.html
const CACHE_NAME = 'warpdiff-v3.12.26';
const ASSETS = ['./', 'index.html', 'js/audio-viz.js', 'js/scopes.js', 'js/hotkeys.js', 'js/mp4-demux.js', 'js/scrub-video.js', 'js/timecode.js', 'js/opus-sync.js', 'js/audio-decode.js', 'js/transport.js', 'js/starfield.js', 'version.json', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'manifest.json'];
const RUNTIME_URLS = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k.startsWith('warpdiff-v') && k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Only intercept the explicit WarpDiff runtime allowlist. Same-origin alone
    // is not ownership: an embedded deployment can share its origin with a host.
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (!RUNTIME_URLS.has(url.href)) return;

    // Network-first: try fresh copy, fall back to cache
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res.ok && res.type === 'basic') {
                    const clone = res.clone();
                    e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(e.request, clone)));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

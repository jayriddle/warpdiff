// Keep in sync with APP_VERSION in index.html
const CACHE_NAME = 'warpdiff-v3.19.18';
// Staging fills this with the exact public bundle; checkout serving remains build-free.
const RELEASE = null;
const ASSETS = ['./', 'index.html', 'js/app-updates.js', 'js/app-dialogs.js', 'js/preferences.js', 'js/appearance.js', 'js/info-bar.js', 'js/usage.js', 'js/audio-viz.js', 'js/audio-analysis.js', 'js/audio-analysis-worker.js', 'js/scopes.js', 'js/hotkeys.js',
  'js/managed-review.js', 'js/mp4-demux.js', 'js/scrub-video.js', 'js/timecode.js', 'js/wipe.js', 'js/tile-check.js', 'js/audio-routing.js', 'js/audio-monitor.js', 'js/scrub-audio.js', 'js/scrub-audio-core.js', 'js/scrub-worklet.js', 'js/opus-sync.js', 'js/audio-decode.js', 'js/transport.js', 'js/starfield.js', 'version.json', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'manifest.json'];
ASSETS.push('js/playback-audio-core.js', 'js/slow-playback.js', 'js/signalsmith-worklet.js');
ASSETS.push('js/media-input-contract.js', 'js/media-preparation.js');
ASSETS.push('js/media-admission.js');
ASSETS.push('js/prepared-media.js');
ASSETS.push('js/prepared-import.js');
ASSETS.push('js/preparation-connection.js', 'js/local-preparation.js');
const SCOPE = self.registration.scope;
const RUNTIME_URLS = new Set(ASSETS.map(asset => new URL(asset, SCOPE).href));
const SCOPE_SUFFIX = '-' + encodeURIComponent(new URL(SCOPE).pathname);
const RELEASE_CACHE = RELEASE ? CACHE_NAME + '-' + RELEASE.sha + SCOPE_SUFFIX : CACHE_NAME;
const RELEASE_PREFIX = new URL('releases/', SCOPE).href;
const RELEASE_ASSETS = new Set(ASSETS.filter(asset => asset !== './' && asset !== 'index.html'));
RELEASE_ASSETS.add('WarpDiff_Logo_v1.png');
RELEASE_ASSETS.add('js/signalsmith-LICENSE.txt');
const META_URL = new URL('__warpdiff_release__', SCOPE).href;
const DOCUMENT_URL = new URL('index.html', SCOPE).href;

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const existed = (await caches.keys()).includes(RELEASE_CACHE);
        try {
            const cache = await caches.open(RELEASE_CACHE);
            const entries = RELEASE ? Object.entries(RELEASE.files) : ASSETS.map(asset => [asset, null]);
            await cache.addAll(entries.map(([asset, integrity]) => new Request(new URL(asset, SCOPE), {
                cache:'reload', ...(integrity ? {integrity} : {})
            })));
            if (!await _cacheInstallSequence(RELEASE_CACHE)) {
                const owned = (await caches.keys()).filter(name => /^warpdiff-v[0-9.]+-/.test(name) && name.endsWith(SCOPE_SUFFIX));
                const previous = await Promise.all(owned.map(_cacheInstallSequence));
                const sequence = previous.reduce((max, value) => Math.max(max, value), 0) + 1;
                if (!Number.isSafeInteger(sequence)) throw Error('App cache sequence exhausted');
                await cache.put(META_URL, new Response(JSON.stringify({sequence})));
            }
            // Only a complete verified bundle may replace a controller. Existing pages are never reloaded.
            await self.skipWaiting();
        } catch (error) {
            if (!existed) await caches.delete(RELEASE_CACHE);
            throw error;
        }
    })());
});

async function _cacheInstallSequence(name) {
    try {
        const response = await (await caches.open(name)).match(META_URL);
        const sequence = (await response?.json())?.sequence;
        return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
    } catch { return 0; }
}
function _clientRelease(client) {
    return new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = sha => { clearTimeout(timer); channel.port1.close(); resolve(sha); };
        const timer = setTimeout(() => finish(null), 1500);
        channel.port1.onmessage = event => finish(/^[a-f0-9]{40}$/.test(event.data?.sha) ? event.data.sha : null);
        try { client.postMessage({type:'WARPDIFF_RELEASE_QUERY'}, [channel.port2]); }
        catch { finish(null); }
    });
}
let _cleanupPending = null;
function _retireUnusedCaches() {
    if (_cleanupPending) return _cleanupPending;
    _cleanupPending = (async () => {
        const clients = (await self.clients.matchAll({type:'window', includeUncontrolled:true}))
            .filter(client => { const url = new URL(client.url); url.search = ''; url.hash = '';
                return url.href === SCOPE || url.href === DOCUMENT_URL; });
        const releases = await Promise.all(clients.map(_clientRelease));
        const unknown = releases.some(sha => !sha);
        const names = await caches.keys();
        const current = await _cacheInstallSequence(RELEASE_CACHE);
        const owned = names.filter(name => /^warpdiff-v[0-9.]+-/.test(name) && name.endsWith(SCOPE_SUFFIX));
        const stamps = new Map(await Promise.all(owned.map(async name => [name, await _cacheInstallSequence(name)])));
        await Promise.all(names.filter(name => {
            if (name === 'warpdiff-ffmpeg') return true;
            if (name === RELEASE_CACHE || unknown) return false;
            if (/^warpdiff-v[0-9.]+$/.test(name)) return true;
            const match = name.match(/^warpdiff-v[0-9.]+-([a-f0-9]{40})-/);
            return match && name.endsWith(SCOPE_SUFFIX) && !releases.includes(match[1]) &&
                stamps.get(name) > 0 && stamps.get(name) < current;
        }).map(name => caches.delete(name)));
    })().finally(() => { _cleanupPending = null; });
    return _cleanupPending;
}
self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim().then(_retireUnusedCaches));
});
self.addEventListener('message', event => {
    if (event.data?.type === 'WARPDIFF_RELEASE_QUERY' && event.ports[0]) event.ports[0].postMessage({sha:RELEASE?.sha || null});
    if (event.data?.type === 'WARPDIFF_RELEASE_CLEANUP' && event.data.sha === (RELEASE?.sha || null)) event.waitUntil(_retireUnusedCaches());
});

async function _releaseResponse(request, sha) {
    // Exact version paths, across our scope's caches only. Never refill an old bundle with newer bytes.
    for (const name of await caches.keys()) {
        if (!/^warpdiff-v[0-9.]+-/.test(name) || !name.endsWith('-' + sha + SCOPE_SUFFIX)) continue;
        const cached = await (await caches.open(name)).match(request);
        if (cached) return cached;
    }
    const relative = request.url.slice(SCOPE.length);
    const integrity = RELEASE?.files[relative];
    return fetch(new Request(request, {cache:'reload', ...(integrity ? {integrity} : {})}));
}
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    const isDocument = event.request.mode === 'navigate' &&
        (url.origin + url.pathname === SCOPE || url.origin + url.pathname === DOCUMENT_URL);
    if (isDocument) {
        event.respondWith(fetch(new Request(event.request, {cache:'no-cache'})).then(response => {
            if (!response.ok) throw Error('App document unavailable');
            return response;
        }).catch(() => caches.open(RELEASE_CACHE).then(cache => cache.match(RELEASE ? DOCUMENT_URL : new URL('./', SCOPE).href))));
        return;
    }
    if (url.href.startsWith(RELEASE_PREFIX) && !url.search) {
        const match = url.href.slice(RELEASE_PREFIX.length).match(/^([a-f0-9]{40})\/(.+)$/);
        if (match && RELEASE_ASSETS.has(match[2])) {
            event.respondWith(_releaseResponse(event.request, match[1]));
            return;
        }
    }
    if (!RUNTIME_URLS.has(url.href)) return; // No media, signed URLs, sibling pages or collectors.
    event.respondWith((async () => {
        // A legacy open page still names stable asset URLs. Retain its original complete cache.
        if (RELEASE) {
            for (const name of await caches.keys()) {
                if (!/^warpdiff-v[0-9.]+$/.test(name)) continue;
                const cached = await (await caches.open(name)).match(event.request);
                if (cached) return cached;
            }
            return fetch(new Request(event.request, {cache:'reload'}));
        }
        // Unstaged, no-build local development: always revalidate rather than HTTP-cache old scripts.
        try {
            const response = await fetch(new Request(event.request, {cache:'no-cache'}));
            if (response.ok && response.type === 'basic') {
                const cache = await caches.open(RELEASE_CACHE);
                await cache.put(event.request, response.clone());
            }
            return response;
        } catch { return (await caches.open(RELEASE_CACHE)).match(event.request); }
    })());
});

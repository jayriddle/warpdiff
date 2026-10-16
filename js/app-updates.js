// Release identity is captured once. A new controller must not relabel an open comparison.
const _appReleaseSha = document.querySelector('meta[name="warpdiff-release"]')?.content || null;
try {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type !== 'WARPDIFF_RELEASE_QUERY' || !event.ports[0]) return;
            const worker = new URL(event.source?.scriptURL || 'about:blank');
            const expected = new URL('sw.js', location.href);
            if (worker.href !== expected.href) return;
            event.ports[0].postMessage({sha:_appReleaseSha});
        });
    }
} catch (_) {} // Some managed/private contexts deny even reading this optional API.
function _registerAppServiceWorker() {
    // Resolve against the page URL: deployment's <base> pins runtime assets to a release directory.
    return Promise.resolve().then(() => navigator.serviceWorker.register(new URL('sw.js', location.href), {updateViaCache:'none'}))
        .then(() => navigator.serviceWorker.ready)
        .then(registration => registration.active?.postMessage({type:'WARPDIFF_RELEASE_CLEANUP',sha:_appReleaseSha}))
        .catch(() => {}); // Storage/private-mode failures leave online comparison usable.
}

// Staging embeds the three lazy entry points in the document. Managed frames and
// newly claimed pages can then create them offline without a second network load.
const _appBackgroundUrls = new Map();
function _appBackgroundScriptUrl(file) {
    if (_appBackgroundUrls.has(file)) return _appBackgroundUrls.get(file);
    const element = document.getElementById('warpdiff-background-scripts');
    if (!element) return file; // Direct, build-free source serving.
    const sources = JSON.parse(element.textContent);
    if (!Object.hasOwn(sources, file)) throw Error('Unknown background script');
    const bytes = Uint8Array.from(atob(sources[file]), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type:'text/javascript'}));
    _appBackgroundUrls.set(file, url); // At most three, bounded by document lifetime; browsers retire their URLs with it.
    return url;
}

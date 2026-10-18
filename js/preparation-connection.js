// Explicit popup/MessagePort transport. No port scanning, cross-origin fetch,
// engine download, filesystem paths or automatic preparation.
const WarpPreparationConnection = (() => {
    function address(value) {
        const url = new URL(value);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
            url.username || url.password || url.search || url.hash || url.pathname !== '/') {
            throw new Error('Use the local tool address, such as http://127.0.0.1:54321');
        }
        return url.origin;
    }
    function create(changed = () => {}) {
        let popup = null, port = null, origin = null, pairing = null, pending = null, watch = null;
        let ready = false, generation = 0;
        const abort = () => new DOMException('Preparation cancelled', 'AbortError');
        const state = () => Object.freeze({connected: ready, connecting: !!pairing, busy: !!pending});
        function disconnect(reason = 'The local tool was disconnected') {
            ++generation;
            ready = false;
            if (pairing) pairing.finish(new Error(reason));
            if (pending) pending.finish(new Error(reason));
            try { port?.postMessage({type:'disconnect'}); } catch (_) {}
            port?.close(); port = null;
            if (popup && !popup.closed) popup.close();
            popup = null; origin = null; clearInterval(watch); watch = null; changed(state());
        }
        function receive(event) {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'ready' && pairing) {
                ready = true; pairing.finish(); changed(state());
            } else if (data.type === 'closed') disconnect('The local tool connection closed');
            else if (pending && data.id === pending.id && ['result','failed'].includes(data.type)) {
                if (data.type === 'failed') pending.finish(pending.signal?.aborted ? abort() :
                    new Error(typeof data.error === 'string' ? data.error.slice(0,500) : 'Preparation failed'));
                else {
                    const file = data.file, kind = pending.kind;
                    if (!(file instanceof File) || !file.size || file.size > 1024*1024*1024 ||
                        file.type !== (kind === 'video' ? 'video/mp4' : 'audio/wav')) {
                        pending.finish(new Error('The local tool returned an invalid review copy'));
                    } else pending.finish(pending.signal?.aborted ? abort() : null, file);
                }
            }
        }
        function connect(value) {
            const target = address(value); disconnect();
            const epoch = generation;
            const id = crypto.randomUUID().replaceAll('-',''); origin = target;
            const promise = new Promise((resolve,reject) => {
                const finish = error => {
                    clearTimeout(timer); window.removeEventListener('message', hello);
                    pairing = null; if (error) reject(error); else resolve();
                };
                const hello = event => {
                    if (event.source !== popup || event.origin !== target || event.data?.type !== 'WARPDIFF_PREPARATION_HELLO' || event.data.version !== 1 || event.data.id !== id || port) return;
                    const channel = new MessageChannel(); port = channel.port1;
                    port.onmessage = event => {if (epoch === generation && port === channel.port1) receive(event);}; port.start();
                    popup.postMessage({type:'WARPDIFF_PREPARATION_CONNECT',version:1,id},target,[channel.port2]);
                };
                const timer = setTimeout(() => disconnect('Connection timed out. Check that the local tool is running.'),120000);
                pairing = {finish}; window.addEventListener('message',hello);
                try { popup = window.open(target+'/connect.html#'+new URLSearchParams({id,origin:location.origin}), '_blank', 'popup,width=620,height=620'); }
                catch (_) { disconnect('Could not open the local tool connection window'); return; }
                if (!popup) { finish(new Error('Allow the connection window, then try again.')); return; }
                watch = setInterval(() => { if (popup?.closed) disconnect('The local tool window closed'); },500);
            });
            changed(state()); return promise;
        }
        async function prepare(file, kind, signal) {
            if (!ready || !port) throw new Error('Connect the local preparation tool first');
            if (pending) throw new Error('The previous preparation is finishing. Try again shortly.');
            if (!(file instanceof File) || !file.size || file.size > 512*1024*1024 || !['video','audio'].includes(kind)) {
                throw new Error('Choose a video or audio file up to 512 MiB');
            }
            if (signal?.aborted) throw abort();
            return new Promise((resolve,reject) => {
                const id = crypto.randomUUID().replaceAll('-','');
                const cancelled = () => { try { port?.postMessage({type:'cancel',id}); } catch (_) {} };
                const timer = setTimeout(() => disconnect('The local preparation did not finish in time'),11*60*1000);
                const finish = (error,result) => {
                    clearTimeout(timer); signal?.removeEventListener('abort',cancelled); pending = null;
                    if (error) reject(error); else resolve(result); changed(state());
                };
                pending = {id,kind,signal,finish}; signal?.addEventListener('abort',cancelled,{once:true});
                try { port.postMessage({type:'prepare',id,kind,file}); }
                catch (_) { finish(new Error('Could not send the file to the local tool')); }
                changed(state());
            });
        }
        window.addEventListener('pagehide',() => disconnect());
        return Object.freeze({connect,disconnect,prepare,state});
    }
    return Object.freeze({address,create});
})();

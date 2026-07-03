// Timecode formatting — extracted from index.html. Pure given (secs, fps, fmt);
// the only app dependency is _prefs.load for the DEFAULT format when fmt is
// omitted (resolves via the shared global scope of classic <script>s). The
// state-coupled builders (formatLoopTime, _buildTimecopString*) stay in
// index.html. Frame math uses the Math.floor(t*fps + 0.01) epsilon — see
// CLAUDE.md "Frame & timecode". Unit tests: tests/ownership.test.mjs.

// Shared timecode formatter. fmt: 'hms' | 'hmsf' | 's' | 'sf' | 'f'
// Pass fmt explicitly to preview all options in the chooser.
// Pass fps=0 for audio-only (frame-based formats fall back to ms-based).
// Pass fullHours=true (clipboard copy path) to always emit HH:MM:SS.xxx.
function _formatTcForCopy(secs, fps, fmt, fullHours) {
    if (fmt === undefined) fmt = _prefs.load('timecopyFmt', 'hms');
    // Frame-based formats need fps — fall back for audio
    if (!fps && fmt === 'hmsf') fmt = 'hms';
    if (!fps && fmt === 'sf')   fmt = 's';
    if (!fps && fmt === 'f')    fmt = 's';
    secs = Math.max(0, secs);
    fps  = fps || 30;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (fmt === 'hms') {
        const ms = Math.round((secs % 1) * 1000);
        const ss = s.toString().padStart(2,'0') + '.' + ms.toString().padStart(3,'0');
        if (h > 0 || fullHours) return h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0') + ':' + ss;
        return m.toString().padStart(2,'0') + ':' + ss;
    }
    if (fmt === 'hmsf') {
        const f  = Math.floor((secs % 1) * fps + 0.01) % Math.round(fps);
        const sf = s.toString().padStart(2,'0') + ':' + f.toString().padStart(2,'0');
        if (h > 0 || fullHours) return h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0') + ':' + sf;
        return m.toString().padStart(2,'0') + ':' + sf;
    }
    if (fmt === 's') {
        const ms = Math.round((secs % 1) * 1000);
        return Math.floor(secs) + '.' + ms.toString().padStart(3,'0');
    }
    if (fmt === 'sf') {
        const totalF = Math.floor(secs * fps + 0.01);
        const ts = Math.floor(totalF / fps);
        const f  = totalF % Math.round(fps);
        return ts + ':' + f.toString().padStart(2,'0');
    }
    if (fmt === 'f') {
        return 'F' + (Math.floor(secs * fps + 0.01) + 1);
    }
    return secs.toFixed(3);
}

// Marker-label formatter: always keeps exactly one '0:' prefix before the first
// significant component. Only used for the floating in/out labels on the progress bar.
// Timeline display and copied values use _formatTcForCopy (full chosen format).
function _formatTcForMarker(secs, fps) {
    let fmt = _prefs.load('timecopyFmt', 'hms');
    if (!fps && fmt === 'hmsf') fmt = 'hms';
    if (!fps && fmt === 'sf')   fmt = 's';
    if (!fps && fmt === 'f')    fmt = 's';
    secs = Math.max(0, secs);
    fps  = fps || 30;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (fmt === 'hms') {
        const ms = Math.round((secs % 1) * 1000);
        const ss = s.toString().padStart(2,'0') + '.' + ms.toString().padStart(3,'0');
        if (h > 0) return h + ':' + m.toString().padStart(2,'0') + ':' + ss;
        if (m > 0) return '0:' + m.toString().padStart(2,'0') + ':' + ss;
        return '0:' + ss;
    }
    if (fmt === 'hmsf') {
        const f  = Math.floor((secs % 1) * fps + 0.01) % Math.round(fps);
        const sf = s.toString().padStart(2,'0') + ':' + f.toString().padStart(2,'0');
        if (h > 0) return h + ':' + m.toString().padStart(2,'0') + ':' + sf;
        if (m > 0) return '0:' + m.toString().padStart(2,'0') + ':' + sf;
        return '0:' + sf;
    }
    // 's', 'sf', 'f' are already compact — no prefix stripping needed
    if (fmt === 's') {
        const ms = Math.round((secs % 1) * 1000);
        return Math.floor(secs) + '.' + ms.toString().padStart(3,'0');
    }
    if (fmt === 'sf') {
        const totalF = Math.floor(secs * fps + 0.01);
        const ts = Math.floor(totalF / fps);
        const f  = totalF % Math.round(fps);
        return ts + ':' + f.toString().padStart(2,'0');
    }
    if (fmt === 'f') {
        return 'F' + (Math.floor(secs * fps + 0.01) + 1);
    }
    return secs.toFixed(3);
}

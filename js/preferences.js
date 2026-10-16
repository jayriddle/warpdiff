// Browser storage boundary. Ordinary settings may fall back to this visit;
// strict reads/saves (consent, daily claims and info-bar persistence) still throw.
function _createPreferenceStore(accessStorage, onUnsaved = () => {}) {
    const session = new Map();
    const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    const oneOf = values => value => values.includes(value);
    const bool = value => typeof value === 'boolean';
    const rules = {
        magnifierSize: value => finite(value, 100, 400),
        magnifierZoom: value => finite(value, 2, 32),
        volume: value => finite(value, 0, 100),
        muted: bool, audioVizVisible: bool, videoScopesVisible: bool,
        tileCheckHeatmap: bool, magnifierLinked: bool, spectrogramLogScale: bool,
        audioVizHeight: value => finite(value, 0, 600),
        audioVizSplit: value => finite(value, 0, 1),
        paletteIndex: value => Number.isInteger(value) && value >= 0 && value < 256,
        timecodeMode: oneOf(['time','frames','seconds']),
        timecopyFmt: oneOf(['hms','hmsf','s','sf','f']),
        timecopySep: value => typeof value === 'string',
        stackZoomMode: oneOf(['fit','balance']),
        audioVizLevelMode: oneOf(['fit','ref']),
        tileCheckView: oneOf(['repeat','offset']),
        appearance: oneOf(['original','starfield','solar','nebula','glacier']),
        // Keep the existing double-encoded format compatible with older tabs.
        slotRotation: value => typeof value === 'string' && value.length <= 4096
    };
    const rawSettings = new Set(['gridInlineMode','lastSeenVersion','customHotkeys','slotColors']);
    function removeRaw(key) {
        session.delete(key);
        try { accessStorage().removeItem(key); return true; } catch (_) { return false; }
    }
    function readRaw(key) {
        const cached = session.get(key);
        if (cached?.unsaved) return cached.value;
        try { return accessStorage().getItem(key); }
        catch (_) { return cached?.value ?? null; }
    }
    function loadJSON(key, fallback, validate, strict = false) {
        // Strict owners distinguish a missing key from an unreadable one.
        const raw = strict ? accessStorage().getItem(key) : readRaw(key);
        if (raw === null) return fallback;
        try {
            const value = JSON.parse(raw);
            if (validate && !validate(value)) throw new TypeError('Invalid saved setting');
            return value;
        } catch (_) {
            // Removal itself may be blocked. Recovery must still return safely.
            removeRaw(key);
            return fallback;
        }
    }
    function serialize(value) {
        const text = JSON.stringify(value);
        if (typeof text !== 'string') throw new TypeError('Setting cannot be serialized');
        return text;
    }
    function writeOptional(key, text) {
        let saved = false;
        try { accessStorage().setItem(key, text); saved = true; } catch (_) {}
        session.set(key, {value: text, unsaved: !saved});
        if (!saved) onUnsaved();
        return saved;
    }
    return {
        load(key, fallback) {
            const ordinary = Object.hasOwn(rules, key);
            return loadJSON('pref_' + key, fallback, ordinary ? rules[key] : null, !ordinary);
        },
        save(key, value) {
            // Deliberately no catch/session fallback: existing strict owners
            // must know whether their durable write really succeeded.
            accessStorage().setItem('pref_' + key, serialize(value));
            session.delete('pref_' + key);
        },
        trySave(key, value) {
            // This allowlist excludes every consent and daily-claim key.
            if (!Object.hasOwn(rules, key) || !rules[key](value)) return false;
            return writeOptional('pref_' + key, serialize(value));
        },
        readRaw, removeRaw,
        writeRaw(key, value) {
            if (!rawSettings.has(key)) return false;
            return writeOptional(key, String(value));
        },
        loadJSONRaw(key, fallback, validate) { return loadJSON(key, fallback, validate); }
    };
}

const _prefs = _createPreferenceStore(
    () => window.localStorage,
    () => window.dispatchEvent(new Event('warpdiff-preferences-unsaved'))
);

function _loadSlotRotations() {
    const result = {original:0, editA:0, editB:0, editC:0};
    const saved = _prefs.load('slotRotation', null);
    if (saved === null) return result;
    let parsed;
    try { parsed = JSON.parse(saved); }
    catch (_) { _prefs.removeRaw('pref_slotRotation'); return result; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        _prefs.removeRaw('pref_slotRotation'); return result;
    }
    for (const slot of Object.keys(result)) {
        if (Object.hasOwn(parsed, slot) && [0,90,180,270].includes(parsed[slot])) result[slot] = parsed[slot];
    }
    return result;
}

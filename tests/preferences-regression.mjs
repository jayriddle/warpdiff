import {runInNewContext} from 'node:vm';

export function runPreferenceChecks(check, source) {
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function fixture() {
        const values = new Map();
        const faults = {access:false, read:false, write:false, remove:false};
        const storage = {
            getItem(key) {if (faults.read) throw Error('read denied'); return values.get(key) ?? null;},
            setItem(key, value) {if (faults.write) throw Error('quota'); values.set(key, value);},
            removeItem(key) {if (faults.remove) throw Error('remove denied'); values.delete(key);}
        };
        const window = {get localStorage() {if (faults.access) throw Error('access denied'); return storage;}, dispatchEvent() {}};
        const exports = runInNewContext(source + '\n;({prefs:_prefs, create:_createPreferenceStore, rotations:_loadSlotRotations});', {window, Event:class {}});
        return {...exports, values, faults};
    }
    function test(name, fn) {
        try {check('preferences: ' + name, fn() === true);}
        catch (_) {check('preferences: ' + name, false);}
    }
    for (const fault of ['access','read']) test(fault + ' denial returns fallback', () => {
        const f = fixture(); f.faults[fault] = true;
        return f.prefs.load('volume', 100) === 100 && f.prefs.readRaw('gridInlineMode') === null;
    });
    for (const removalBlocked of [false,true]) test('corrupt JSON recovers with removal blocked=' + removalBlocked, () => {
        const f=fixture(); f.values.set('pref_volume','{broken'); f.values.set('pref_muted','true'); f.faults.remove=removalBlocked;
        return f.prefs.load('volume',100)===100 && f.prefs.load('muted',false)===true &&
            (removalBlocked || !f.values.has('pref_volume'));
    });
    for (const value of [null, {}, [], '50', true, -1, 101]) test('invalid volume ' + JSON.stringify(value), () => {
        const f=fixture(); f.values.set('pref_volume',JSON.stringify(value));
        return f.prefs.load('volume',100)===100 && !f.values.has('pref_volume');
    });
    for (const value of [null, {}, [], 'false', 0]) test('invalid boolean ' + JSON.stringify(value), () => {
        const f=fixture(); f.values.set('pref_muted',JSON.stringify(value));
        return f.prefs.load('muted',false)===false;
    });
    test('failed optional save keeps a visit choice and preserves old durable value', () => {
        const f=fixture(); f.values.set('pref_volume','20'); f.faults.write=true;
        return f.prefs.trySave('volume',50)===false && f.prefs.load('volume',100)===50 && f.values.get('pref_volume')==='20';
    });
    test('successful save reads subsequent durable changes', () => {
        const f=fixture(); f.prefs.trySave('volume',50); f.values.set('pref_volume','25');
        return f.prefs.load('volume',100)===25;
    });
    test('read denial after successful optional save retains only ordinary visit state', () => {
        const f=fixture(); f.prefs.trySave('volume',50); f.values.set('pref_usageConsent','{"choice":"yes"}'); f.faults.read=true;
        if (f.prefs.load('volume',100)!==50) return false;
        try {f.prefs.load('usageConsent',null); return false;} catch (_) {return true;}
    });
    for (const key of ['usageConsent','usageConsentTest','usageActiveDay','usageActiveDayTest','infoBarProfiles']) {
        test(key + ' never enters optional persistence', () => {
            const f=fixture(); f.values.set('pref_'+key,'{"choice":"no"}');
            return f.prefs.trySave(key,{choice:'yes'})===false && equal(f.prefs.load(key,null),{choice:'no'});
        });
        test(key + ' strict read failure stays distinguishable from an absent key', () => {
            const f=fixture(); f.faults.read=true;
            try {f.prefs.load(key,null); return false;} catch (_) {return true;}
        });
        test(key + ' strict write failure stays observable', () => {
            const f=fixture(); f.faults.write=true;
            try {f.prefs.save(key,{choice:'yes'}); return false;} catch (_) {return f.prefs.load(key,null)===null;}
        });
    }
    test('consent reads never reuse a saved snapshot across tabs', () => {
        const f=fixture(); f.prefs.save('usageConsent',{choice:'yes'}); f.values.set('pref_usageConsent','{"choice":"no"}');
        return equal(f.prefs.load('usageConsent',null),{choice:'no'});
    });
    test('raw setting remains usable when the storage getter is denied', () => {
        const f=fixture(); f.faults.access=true;
        return !f.prefs.writeRaw('gridInlineMode',true) && f.prefs.readRaw('gridInlineMode')==='true';
    });
    test('raw optional persistence cannot write a consent key', () => {
        const f=fixture(); return !f.prefs.writeRaw('pref_usageConsent','{"choice":"yes"}') && !f.values.has('pref_usageConsent');
    });
    test('invalid raw JSON affects only its own key', () => {
        const f=fixture(); f.values.set('customHotkeys','null'); f.values.set('slotColors','{"editA":"#112233"}');
        const value=f.prefs.loadJSONRaw('customHotkeys',{},v=>v!==null&&typeof v==='object'&&!Array.isArray(v));
        return equal(value,{}) && f.values.has('slotColors');
    });
    test('nested malformed rotation JSON is contained', () => {
        const f=fixture(); f.values.set('pref_slotRotation',JSON.stringify('{broken'));
        return equal(f.rotations(),{original:0,editA:0,editB:0,editC:0}) && !f.values.has('pref_slotRotation');
    });
    test('rotation restoration preserves valid entries and ignores invalid entries', () => {
        const f=fixture(); f.values.set('pref_slotRotation',JSON.stringify(JSON.stringify({original:90,editA:'180',editB:270,editC:45})));
        return equal(f.rotations(),{original:90,editA:0,editB:270,editC:0});
    });
    test('a fresh visit cannot inherit failed optional saves', () => {
        const f=fixture(); f.faults.write=true; f.prefs.trySave('muted',true);
        const fresh=f.create(()=>{throw Error('denied');}); return fresh.load('muted',false)===false;
    });
}

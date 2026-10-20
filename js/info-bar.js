// Info bar preferences and presentation. Classic script; media/geometry stay with
// their existing owners. Canonical asset-* spans remain the read-only value source.
const _INFO_FIELDS = [
    {id:'resolution', label:'Resolution', types:['image','video'], source:'asset-resolution'},
    {id:'aspect', label:'Aspect ratio', types:['image','video'], source:'asset-aspect'},
    {id:'fps', label:'Frame rate', types:['video'], source:'asset-fps'},
    {id:'duration', label:'Duration', types:['video','audio'], source:'asset-duration'},
    {id:'audioCodec', label:'Audio codec', types:['video'], audio:true},
    {id:'channels', label:'Channels / layout', types:['video','audio'], source:'asset-channels', audio:true},
    {id:'sampleRate', label:'Sample rate', types:['video','audio'], source:'asset-sample-rate', audio:true},
    {id:'bitDepth', label:'Bit depth / codec', types:['audio'], source:'asset-bit-depth', audio:true},
    {id:'lufs', label:'Integrated LUFS', types:['video','audio'], source:'asset-lufs', audio:true},
    {id:'lra', label:'Loudness range', types:['video','audio'], source:'asset-lra', audio:true},
    {id:'tp', label:'True peak', types:['video','audio'], source:'asset-tp', audio:true},
    {id:'zoom', label:'Zoom', types:['image','video'], source:'asset-zoom'},
    {id:'filename', label:'Filename', types:['image','video','audio']},
    {id:'fileSize', label:'File size', types:['image','video','audio'], source:'asset-file-size'}
];
const _INFO_PRESETS = ['default','minimal','visual','audio','all'];
const _INFO_PRESET_LABELS = {default:'Default', minimal:'Minimal', visual:'Visual Focus', audio:'Audio Essentials', all:'All Available', custom:'Custom'};
const _INFO_TYPES = ['image','video','audio'];
const _INFO_MAX_SPACERS = 24;
let _infoBarProfiles = null;
let _infoBarInitialized = false;
let _infoBarRefreshRaf = null;
let _infoBarGeometryDirty = false;
const _infoBarSurfaces = new Map();
let _infoBarObserver = null;
let _infoBarOverflow = null;
let _infoEditorType = 'video';
let _infoEditorSelection = null;
let _infoEditorFocus = null;
let _infoEditorDragged = null;
let _infoEditorDropTarget = null;
let _infoEditorPointer = null;
let _infoEditorScrollRaf = null;
let _infoEditorSaveFailed = false;

function _infoBarFields(type) { return _INFO_FIELDS.filter(field => field.types.includes(type)); }
function _infoBarPreset(type, preset = 'default') {
    const defaults = {
        image:['resolution','aspect','zoom'],
        video:['resolution','aspect','fps','duration','audioCodec','channels','sampleRate','lufs','lra','tp','zoom'],
        audio:['channels','sampleRate','bitDepth','duration','fileSize','lufs','lra','tp']
    };
    const groups = {
        minimal: type === 'image' ? [['zoom']] : [['duration']],
        visual: type === 'image' ? [['resolution','aspect'],['zoom']]
            : type === 'video' ? [['resolution','aspect'],['fps','duration'],['zoom']] : [['duration']],
        audio: type === 'image' ? [defaults.image] : type === 'video'
            ? [['lufs','tp'],['duration'],['audioCodec','channels','sampleRate']]
            : [['lufs','tp'],['duration'],['channels','sampleRate','bitDepth']],
        all: type === 'image' ? [['resolution','aspect'],['zoom'],['filename','fileSize']]
            : type === 'video' ? [['resolution','aspect'],['fps','duration'],['audioCodec','channels','sampleRate'],['lufs','lra','tp'],['zoom'],['filename','fileSize']]
            : [['channels','sampleRate','bitDepth'],['duration','fileSize'],['lufs','lra','tp'],['filename']]
    };
    if (!_INFO_PRESETS.includes(preset)) preset = 'default';
    const chosen = preset === 'default' ? [defaults[type]] : groups[preset];
    const elements = [];
    chosen.forEach((group,index) => {
        if (index) elements.push({kind:'spacer', id:'gap-'+index, width:24, visible:true, align:'left'});
        group.forEach(id => elements.push({kind:'field', id, visible:true, align:id === 'zoom' ? 'right' : 'left'}));
    });
    for (const field of _infoBarFields(type)) {
        if (!elements.some(element => element.kind === 'field' && element.id === field.id)) {
            elements.push({kind:'field', id:field.id, visible:false, align:field.id === 'zoom' ? 'right' : 'left'});
        }
    }
    return {preset, elements, styles:{}};
}

// Pure normalization: saved content can choose values, never CSS selectors/markup.
function _infoBarNormalize(type, raw) {
    const fallback = _infoBarPreset(type);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.elements)) return fallback;
    const fields = _infoBarFields(type), seen = new Set(), elements = [];
    // Earlier profiles had one list. Preserve custom order on the left; named
    // presets gain their intended right-hand Zoom without changing visibility.
    const legacyPreset = _INFO_PRESETS.includes(raw.preset) && raw.elements.every(element => !element || element.align === undefined);
    const alignment = element => element.align === 'right' || (legacyPreset && element.id === 'zoom') ? 'right' : 'left';
    let spacerCount = 0;
    for (const element of raw.elements.slice(0,fields.length + _INFO_MAX_SPACERS)) {
        if (!element || typeof element !== 'object') continue;
        if (element.kind === 'field' && fields.some(field => field.id === element.id) && !seen.has(element.id)) {
            elements.push({kind:'field', id:element.id, visible:element.visible === true, align:alignment(element)});
            seen.add(element.id);
        } else if (element.kind === 'spacer' && /^gap-[1-9][0-9]{0,7}$/.test(element.id) && !seen.has(element.id) && spacerCount < _INFO_MAX_SPACERS) {
            const width = Number(element.width);
            elements.push({kind:'spacer', id:element.id, visible:element.visible === true,
                width:Number.isFinite(width) ? Math.max(12,Math.min(48,Math.round(width/4)*4)) : 24, align:alignment(element)});
            seen.add(element.id); spacerCount++;
        }
    }
    for (const field of fields) if (!seen.has(field.id)) elements.push({kind:'field',id:field.id,visible:false,align:'left'});
    const styles = {};
    for (const field of fields) {
        const source = raw.styles && raw.styles[field.id];
        if (!source || typeof source !== 'object') continue;
        styles[field.id] = {size:[11,12,14].includes(source.size) ? source.size : null,
            color:typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color) ? source.color : null,
            bold:source.bold === true};
    }
    // Only the preset factory creates Default: a contradictory stored label must
    // not silently restore legacy fields the user intentionally hid.
    const normalized = {preset:'custom',elements,styles};
    const candidate = _INFO_PRESETS.includes(raw.preset) ? _infoBarPreset(type,raw.preset) : null;
    if (candidate && !Object.keys(styles).length && elements.length === candidate.elements.length &&
        elements.every((element,index) => Object.keys(element).every(key => element[key] === candidate.elements[index][key]))) normalized.preset = raw.preset;
    return normalized;
}

// Collapse gaps before/after content and across hidden/unavailable groups.
function _infoBarLayout(profile, values) {
    const result = [];
    for (const align of ['left','right']) {
        let pending = null, hasField = false;
        for (const element of profile.elements) {
            if (!element.visible || (element.align || 'left') !== align) continue;
            if (element.kind === 'spacer') {
                if (!pending || element.width > pending.width) pending = element;
                continue;
            }
            const value = values[element.id];
            if (!value || !value.text) continue;
            if (pending && hasField) result.push({...pending,align});
            pending = null; hasField = true;
            result.push({...element,align,value});
        }
    }
    return result;
}

function _infoBarProfile(type) { return _infoBarProfiles[type]; }
function _infoBarValueSource(slot) {
    const md = mediaData[slot], layer = getLayer(slot);
    if (!md || !layer) return {};
    const bar = layer.querySelector('.asset-info-bar'), values = {};
    const format = md.audioFormat;
    for (const field of _infoBarFields(md.type)) {
        let text = '', detail = '', warning = false;
        const source = field.source && bar && bar.querySelector('.'+field.source);
        if (source) text = source.textContent.trim();
        if (text === '-') text = '';
        if (field.id === 'filename') text = md.name || '';
        if (field.id === 'fileSize') text = Number.isFinite(md.size) ? formatFileSize(md.size) : text;
        if (md.type === 'video' && ['audioCodec','channels','sampleRate'].includes(field.id)) {
            text = format && format.fields ? format.fields[field.id] || '' : '';
            detail = format?.fieldDetails?.[field.id] || '';
        }
        if (field.id === 'lufs') warning = text !== '' && parseFloat(text) > -9;
        values[field.id] = {text, detail:detail || field.label+': '+text, warning,
            defaultColor:field.id === 'aspect' ? source?.style.color || '' : ''};
    }
    return values;
}

function _infoBarStyle(span, field, profile, defaultColor = '') {
    const style = profile.styles[field] || {};
    span.style.fontSize = style.size ? style.size+'px' : '';
    span.style.fontWeight = style.bold ? '700' : '';
    span.style.color = style.color || defaultColor;
}
function _infoBarItem(entry, profile) {
    const span = document.createElement('span');
    span.dataset.infoId = entry.id;
    span.dataset.infoAlign = entry.align || 'left';
    if (entry.kind === 'spacer') {
        span.className = 'info-gap'; span.dataset.infoKind = 'spacer';
        span.style.width = entry.width+'px'; span.dataset.width = entry.width;
        span.setAttribute('aria-hidden','true');
    } else {
        span.className = 'info-item info-field-'+entry.id; span.dataset.infoKind = 'field';
        span.textContent = entry.value.text; span.title = entry.value.detail;
        span.setAttribute('aria-label',entry.value.detail);
        _infoBarStyle(span,entry.id,profile,entry.value.defaultColor);
        if (entry.value.warning) {
            const alert = document.createElement('span'); alert.className = 'info-level-alert';
            alert.textContent = '!'; alert.setAttribute('aria-label','Loudness above −9 LUFS');
            span.append(alert); span.title += ' · Loudness above −9 LUFS';
        }
    }
    return span;
}

function _infoBarRestoreSurface(root) {
    const record = _infoBarSurfaces.get(root);
    if (!record) return;
    root.classList.remove('info-custom','info-compact'); record.items.remove();
    if (root.parentElement?.classList.contains('video-wrapper')) {
        root.style.width = '';root.style.left = '';_infoBarGeometryDirty = true;
    }
    _infoBarObserver.unobserve(root); _infoBarSurfaces.delete(root);
    if (_infoBarOverflow === record) _closeInfoBarOverflow(false);
    if (root.classList.contains('asset-info-bar')) root.title = mediaData[record.slot]?.name || '';
}
function _infoBarRenderSurface(root, slot, values, profile, force = false) {
    let record = _infoBarSurfaces.get(root);
    if (!record) {
        const items = document.createElement('span'); items.className = 'info-items';
        const more = document.createElement('button'); more.type = 'button'; more.className = 'info-more';
        more.textContent = 'More'; more.setAttribute('aria-expanded','false');
        more.setAttribute('aria-controls','infoOverflowPanel'); more.hidden = true;
        const left = document.createElement('span');left.className = 'info-section info-section-left';
        const right = document.createElement('span');right.className = 'info-section info-section-right';
        items.append(left,more,right);
        record = {root,items,left,right,more,slot,profile,signature:'',entries:[],overflow:[],minWidth:0,height:0};
        more.addEventListener('click',event => {event.stopPropagation();_toggleInfoBarOverflow(record);});
        root.append(items); _infoBarSurfaces.set(root,record); _infoBarObserver.observe(root);
    }
    record.slot = slot; record.profile = profile; root.classList.add('info-custom');
    if (root.classList.contains('asset-info-bar')) root.title = '';
    const entries = _infoBarLayout(profile,values), signature = JSON.stringify([entries,profile.styles]);
    if (signature !== record.signature || force) {
        record.signature = signature; record.entries = entries;
        for (const align of ['left','right']) record[align].replaceChildren(...entries.filter(entry => entry.align === align).map(entry => _infoBarItem(entry,profile)));
    }
    _infoBarFit(record);
    const minWidth = _infoBarGridMinWidth(root);
    const height = minWidth ? root.offsetHeight : 0;
    if (minWidth !== record.minWidth || height !== record.height) {
        record.minWidth = minWidth;record.height = height;_infoBarGeometryDirty = true;
    }
}

// Geometry reads this minimum before sizing Grid cells. A compact More control
// needs 28px plus 4px of margins; reserve a small right-hand field when selected.
// The bar stays one line, so its height cannot feed a resize/relayout cycle.
function _infoBarGridMinWidth(root) {
    if (!root?.classList.contains('info-custom') || !root.parentElement?.classList.contains('video-wrapper')) return 0;
    const record = _infoBarSurfaces.get(root);
    const fieldsSelected = record?.profile.elements.some(element => element.kind === 'field' && element.visible);
    const rightSelected = record?.profile.elements.some(element => element.kind === 'field' && element.visible && element.align === 'right');
    const controls = (root.querySelector('.asset-name')?.getBoundingClientRect().width || 0) + 8 + (fieldsSelected ? 4 + 32 : 0);
    const columns = document.body.classList.contains('inline-cols') ? 3 : 2;
    const available = Math.floor((innerWidth-16-(columns-1)*4)/columns);
    // Three portrait columns must fit the viewport too. Keep identity/More room;
    // a right field can join overflow when its preferred reserve cannot fit.
    return Math.ceil(Math.max(controls,Math.min(controls+(rightSelected ? 32 : 0),available)));
}

// One fit owner. Requested gap widths survive temporary compression and overflow.
function _infoBarFit(record) {
    const {root,items,left,right,more} = record;
    if (!root.isConnected || !root.getClientRects().length) return;
    root.classList.toggle('info-compact',root.classList.contains('asset-info-bar') && root.clientWidth < 180);
    const spans = [...left.children,...right.children];
    spans.forEach(span => {span.hidden = false;span.style.marginInlineStart = '';if (span.dataset.infoKind === 'spacer') span.style.width = span.dataset.width+'px';});
    const width = span => span.getBoundingClientRect().width + (parseFloat(getComputedStyle(span).marginInlineStart) || 0);
    const sectionGap = left.children.length && right.children.length ? 8 : 0;
    const total = () => spans.reduce((sum,span) => sum + width(span),0) + sectionGap;
    if (total() > items.clientWidth) spans.filter(span => span.dataset.infoKind === 'spacer').forEach(span => span.style.width = '12px');
    // Decide final visibility before writing it. Hiding a focused More during
    // measurement blurs it in Chrome even if this same fit shows it again.
    more.hidden = total() <= items.clientWidth;
    if (!more.hidden) {
        let remaining = Math.max(0,items.clientWidth - width(more) - (parseFloat(getComputedStyle(more).marginInlineEnd) || 0));
        // Preserve the far-right fields first, then the left prefix. Fit groups in
        // their own direction so no spacer survives at either visible edge.
        for (const [section,reverse] of [[right,true],[left,false]]) {
            let previous = null, gap = null, exceeded = false;
            const children = [...section.children];
            if (reverse) children.reverse();
            for (const span of children) {
                if (span.dataset.infoKind === 'spacer') {span.hidden = true;gap = span;continue;}
                span.style.marginInlineStart = '0px';
                const separation = previous ? (gap ? parseFloat(gap.style.width) : 8) : 0;
                const next = width(span) + separation;
                if (exceeded || next > remaining) {span.hidden = true;exceeded = true;}
                else {
                    remaining -= next;
                    if (gap && previous) gap.hidden = false;
                    else if (previous) (reverse ? previous : span).style.marginInlineStart = '8px';
                    previous = span;
                }
                gap = null;
            }
        }
    }
    const overflow = spans.filter(span => span.hidden && span.dataset.infoKind === 'field').map(span => span.dataset.infoId);
    record.overflow = overflow;
    more.textContent = root.classList.contains('info-compact') ? '⋯' : 'More'+(overflow.length ? ' '+overflow.length : '');
    more.title = 'Show '+overflow.length+' additional fields';
    more.setAttribute('aria-label','Show '+overflow.length+' additional fields for '+(mediaData[record.slot] ? slotLabel(record.slot) : 'preview'));
    if (!overflow.length && _infoBarOverflow === record) _closeInfoBarOverflow(false);
    else if (_infoBarOverflow === record) _renderInfoBarOverflow();
}

function _queueInfoBarRefresh() {
    if (!_infoBarInitialized || _infoBarRefreshRaf !== null) return;
    _infoBarRefreshRaf = requestAnimationFrame(() => {_infoBarRefreshRaf = null;_refreshInfoBars();});
}
function _refreshInfoBars() {
    if (!_infoBarInitialized) return;
    for (const [root] of _infoBarSurfaces) if (!root.isConnected) _infoBarRestoreSurface(root);
    for (const slot of assetOrder) {
        const md = mediaData[slot], bar = getLayer(slot)?.querySelector('.asset-info-bar');
        if (!md || !bar) continue;
        const profile = _infoBarProfile(md.type);
        if (profile.preset === 'default' || _managedReviewActive()) _infoBarRestoreSurface(bar);
        else _infoBarRenderSurface(bar,slot,_infoBarValueSource(slot),profile);
    }
    const strip = document.getElementById('stackInfoStrip');
    const slot = assetOrder.find(candidate => getLayer(candidate)?.classList.contains('active') && mediaData[candidate]);
    if (!slot || isGridMode || _wipeMode || _managedReviewActive() || _infoBarProfile(mediaData[slot].type).preset === 'default') _infoBarRestoreSurface(strip);
    else {
        _infoBarRenderSurface(strip,slot,_infoBarValueSource(slot),_infoBarProfile(mediaData[slot].type));
        document.getElementById('sihTooltip').style.display = 'none';
    }
    if (!isGridMode && slot) _updateSihAccentBar(slot);
    if (document.getElementById('infoEditorDialog').open) _renderInfoEditorPreview();
    if (_infoBarGeometryDirty && isGridMode && getLoadedSlotCount()) positionLabelsToMediaRaf();
    _infoBarGeometryDirty = false;
}
function _clearInfoBarViews() {
    if (!_infoBarInitialized) return;
    if (_infoBarRefreshRaf !== null) cancelAnimationFrame(_infoBarRefreshRaf);
    _infoBarRefreshRaf = null; _closeInfoBarOverflow(false);
    for (const [root] of _infoBarSurfaces) _infoBarRestoreSurface(root);
}

function _closeInfoBarOverflow(focus = true) {
    const record = _infoBarOverflow;
    _infoBarOverflow = null;
    const panel = document.getElementById('infoOverflowPanel');
    panel.hidden = true; document.getElementById('infoOverflowValues').replaceChildren();
    if (panel.parentElement !== document.body) document.body.append(panel);
    if (record) {record.more.setAttribute('aria-expanded','false');if (focus && record.more.isConnected && !record.more.hidden) record.more.focus();}
}
function _renderInfoBarOverflow() {
    const record = _infoBarOverflow;
    if (!record || !record.root.isConnected || !record.more.getClientRects().length) {_closeInfoBarOverflow(false);return;}
    const list = document.getElementById('infoOverflowValues'); list.replaceChildren();
    for (const entry of record.entries) {
        if (entry.kind !== 'field' || !record.overflow.includes(entry.id)) continue;
        const row = document.createElement('div'); row.className = 'info-overflow-row';
        const label = document.createElement('span');label.textContent = _INFO_FIELDS.find(field => field.id === entry.id).label;
        row.append(label,_infoBarItem(entry,record.profile));list.append(row);
    }
    const panel = document.getElementById('infoOverflowPanel'), anchor = record.more.getBoundingClientRect();
    panel.style.left = Math.max(8,Math.min(anchor.right-panel.offsetWidth,innerWidth-panel.offsetWidth-8))+'px';
    panel.style.top = Math.max(8,Math.min(anchor.bottom+6,innerHeight-panel.offsetHeight-8))+'px';
}
function _toggleInfoBarOverflow(record) {
    if (_infoBarOverflow === record) {_closeInfoBarOverflow();return;}
    _closeInfoBarOverflow(false); _infoBarOverflow = record;
    const panel = document.getElementById('infoOverflowPanel'), dialog = document.getElementById('infoEditorDialog');
    // The native modal top layer must also contain its preview's popup.
    if (dialog.open && dialog.contains(record.root)) dialog.append(panel);
    panel.hidden = false;
    record.more.setAttribute('aria-expanded','true'); _renderInfoBarOverflow();
    document.getElementById('infoOverflowClose').focus();
}

// Only writer for preferences; metadata publication never changes user choices.
function _commitInfoBarProfile(type, profile) {
    _infoEditorFinishDrag(false);
    _infoBarProfiles[type] = _infoBarNormalize(type,profile);
    _infoEditorSaveFailed = false;
    try {_prefs.save('infoBarProfiles',{version:1,profiles:_infoBarProfiles});}
    catch (_) {_infoEditorSaveFailed = true;}
    _closeInfoBarOverflow(false);
    _renderInfoEditor(); _refreshInfoBars();
    // Font sizing affects measured bar height. Reuse the existing geometry owner.
    if (getLoadedSlotCount()) {if (isGridMode) positionLabelsToMedia(5);else applyZoom();}
}
function _infoEditorElementLabel(element) {
    return element.kind === 'spacer' ? 'Spacer '+element.id.slice(4) : _INFO_FIELDS.find(field => field.id === element.id).label;
}
function _infoEditorChange(mutator) {
    const profile = structuredClone(_infoBarProfile(_infoEditorType)); profile.preset = 'custom';
    mutator(profile); _commitInfoBarProfile(_infoEditorType,profile);
}
function _infoEditorClearDrop() {
    document.querySelectorAll('.info-drop-before, .info-drop-after, .info-drop-section, .info-dragging').forEach(element => element.classList.remove('info-drop-before','info-drop-after','info-drop-section','info-dragging'));
    _infoEditorDropTarget = null;
}
function _infoEditorShowDrop(targetElement, y) {
    const row = targetElement?.closest('[data-element-id]'), section = targetElement?.closest('.info-editor-section')?.querySelector('[data-info-section]');
    if (!section || row?.dataset.elementId === _infoEditorDragged) {_infoEditorClearDrop();return;}
    const bounds = row?.getBoundingClientRect();
    const after = bounds ? y > bounds.top + bounds.height/2 : false;
    const target = row?.dataset.elementId || null, align = section.dataset.infoSection;
    if (_infoEditorDropTarget?.target === target && _infoEditorDropTarget.align === align && _infoEditorDropTarget.after === after) return;
    _infoEditorClearDrop();_infoEditorDropTarget = {target,align,after};
    (row || section).classList.add(row ? (after ? 'info-drop-after' : 'info-drop-before') : 'info-drop-section');
    document.querySelector('[data-element-id="'+_infoEditorDragged+'"]')?.classList.add('info-dragging');
}
function _infoEditorFinishDrag(apply) {
    const drop = _infoEditorDropTarget, id = _infoEditorDragged, pointer = _infoEditorPointer;
    if (_infoEditorScrollRaf !== null) cancelAnimationFrame(_infoEditorScrollRaf);
    _infoEditorScrollRaf = null;
    _infoEditorDragged = null;_infoEditorPointer = null;_infoEditorClearDrop();
    if (pointer?.handle.hasPointerCapture(pointer.pointerId)) pointer.handle.releasePointerCapture(pointer.pointerId);
    if (!apply || !document.getElementById('infoEditorDialog').open || !drop || !id || drop.target === id) return;
    _infoEditorSelection = id;
    _infoEditorChange(profile => _infoEditorReorder(profile,id,drop.target,drop.align,drop.after));
    document.querySelector('[data-info-drag="'+id+'"]').focus({preventScroll:true});
}
// A held touch/pen handle must reach offscreen rows without requiring more motion.
// Only the captured gesture owns this frame chain; FinishDrag retires it.
function _infoEditorTrackPointerDrag() {
    const pointer = _infoEditorPointer, dialog = document.getElementById('infoEditorDialog');
    if (!pointer || !_infoEditorDragged || !dialog.open) return;
    const bounds = dialog.getBoundingClientRect(), x = pointer.currentX, y = pointer.currentY;
    const inside = x >= bounds.left && x <= bounds.right;
    const delta = !inside ? 0 : y < bounds.top+40 ? -16 : y > bounds.bottom-40 ? 16 : 0;
    const before = dialog.scrollTop;
    dialog.scrollTop += delta;
    _infoEditorShowDrop(document.elementFromPoint(x,y),y);
    if (delta && dialog.scrollTop !== before) {
        if (_infoEditorScrollRaf === null) _infoEditorScrollRaf = requestAnimationFrame(() => {
            _infoEditorScrollRaf = null;
            _infoEditorTrackPointerDrag();
        });
    } else if (_infoEditorScrollRaf !== null) {
        cancelAnimationFrame(_infoEditorScrollRaf);_infoEditorScrollRaf = null;
    }
}
function _infoEditorReorder(profile, id, target, align, after = false) {
    const element = profile.elements.find(item => item.id === id);
    if (!element || id === target) return;
    element.align = align;
    profile.elements = profile.elements.filter(item => item.id !== id);
    const targetIndex = target ? profile.elements.findIndex(item => item.id === target) : -1;
    const index = targetIndex < 0 ? profile.elements.length : targetIndex + (after ? 1 : 0);
    profile.elements.splice(index,0,element);
}
function _openInfoBarEditor() {
    if (_managedReviewActive()) return;
    _closeAppearancePanel(); _closeInfoBarOverflow(false);
    // macOS WebKit mouse clicks need not focus buttons. Return to the editor's
    // actual trigger, rather than whichever page element retained focus.
    _infoEditorFocus = document.getElementById('infoEditorButton');
    const slot = assetOrder.find(candidate => mediaData[candidate] && getLayer(candidate)?.classList.contains('active'));
    _infoEditorType = slot ? mediaData[slot].type : _infoEditorType;
    _infoEditorSelection = _infoBarProfile(_infoEditorType).elements[0].id;
    _renderInfoEditor();
    _showAppDialog(document.getElementById('infoEditorDialog'));
    document.getElementById('infoEditorButton').setAttribute('aria-expanded','true');
    _renderInfoEditorPreview(); document.getElementById('infoEditorClose').focus();
}
function _closeInfoBarEditor() {document.getElementById('infoEditorDialog').close();}
function _renderInfoEditor() {
    const profile = _infoBarProfile(_infoEditorType), elements = profile.elements;
    if (!elements.some(element => element.id === _infoEditorSelection)) _infoEditorSelection = elements[0].id;
    document.getElementById('infoEditorType').value = _infoEditorType;
    document.getElementById('infoEditorPreset').value = profile.preset;
    const audio = elements.filter(element => element.kind === 'field' && _INFO_FIELDS.find(field => field.id === element.id).audio);
    const audioToggle = document.getElementById('infoEditorAudio');
    audioToggle.disabled = !audio.length;
    audioToggle.checked = audio.length > 0 && audio.every(element => element.visible);
    audioToggle.indeterminate = audio.some(element => element.visible) && !audioToggle.checked;
    const list = document.getElementById('infoEditorElements');list.replaceChildren();
    for (const align of ['left','right']) {
        const section = document.createElement('section');section.className = 'info-editor-section';
        const heading = document.createElement('h3');heading.id = 'infoEditorSection-'+align;heading.textContent = align === 'left' ? 'Left aligned' : 'Right aligned';
        const rows = document.createElement('ol');rows.dataset.infoSection = align;rows.setAttribute('aria-labelledby',heading.id);
        section.append(heading,rows);list.append(section);
        const members = elements.filter(element => element.align === align);
        if (!members.length) {const empty = document.createElement('li');empty.className = 'info-editor-empty';empty.textContent = 'Move or drag an element here';rows.append(empty);}
        members.forEach(element => {
        const row = document.createElement('li');row.className = 'info-editor-row';row.dataset.elementId = element.id;
        row.dataset.elementAlign = align;
        row.classList.toggle('selected',element.id === _infoEditorSelection);row.classList.toggle('disabled-field',!element.visible);row.draggable = true;
        const label = document.createElement('label');label.className = 'info-editor-toggle';
        const check = document.createElement('input');check.type = 'checkbox';check.checked = element.visible;check.dataset.infoToggle = element.id;
        check.setAttribute('aria-label','Show '+_infoEditorElementLabel(element));label.append(check);
        const choose = document.createElement('button');choose.type = 'button';choose.className = 'info-editor-select';choose.dataset.infoSelect = element.id;
        choose.textContent = _infoEditorElementLabel(element)+(element.kind === 'spacer' ? ' · '+element.width+' px' : '');
        choose.setAttribute('aria-pressed',String(element.id === _infoEditorSelection));choose.setAttribute('aria-label','Style '+_infoEditorElementLabel(element));
        const handle = document.createElement('button');handle.type = 'button';handle.className = 'info-editor-drag';handle.textContent = '⠿';
        handle.dataset.infoDrag = element.id;handle.draggable = true;
        handle.setAttribute('aria-label','Move '+_infoEditorElementLabel(element));handle.setAttribute('aria-describedby','infoEditorDragHint');
        handle.title = 'Drag to reorder or change section. Arrow keys move a focused handle.';
        row.append(handle,label,choose);
        rows.append(row);
        });
    }
    const selected = elements.find(element => element.id === _infoEditorSelection);
    document.getElementById('infoEditorSelected').textContent = _infoEditorElementLabel(selected);
    document.getElementById('infoEditorAlign').value = selected.align;
    document.getElementById('infoEditorTextStyle').hidden = selected.kind === 'spacer';
    document.getElementById('infoEditorSpacerStyle').hidden = selected.kind !== 'spacer';
    document.getElementById('infoEditorAddSpacer').disabled = elements.filter(element => element.kind === 'spacer').length >= _INFO_MAX_SPACERS;
    if (selected.kind === 'spacer') {
        document.getElementById('infoEditorSpacerWidth').value = selected.width;
        document.getElementById('infoEditorSpacerValue').value = selected.width+' px';
    } else {
        const style = profile.styles[selected.id] || {};
        document.getElementById('infoEditorSize').value = style.size || 'default';
        document.getElementById('infoEditorBold').checked = style.bold === true;
        document.getElementById('infoEditorColor').value = style.color || '#bbbbbb';
        document.getElementById('infoEditorDefaultColor').disabled = !style.color;
    }
    const status = document.getElementById('infoEditorStatus');
    status.textContent = _infoEditorSaveFailed ? 'Applied for this visit. Browser storage is unavailable; these choices could not be saved.' : 'Saved in this browser · Same choices in Stack and Grid';
    status.setAttribute('role',_infoEditorSaveFailed ? 'alert' : 'status');
    _renderInfoEditorPreview();
}
function _renderInfoEditorPreview() {
    const candidates = assetOrder.filter(slot => mediaData[slot]?.type === _infoEditorType);
    const slot = candidates.find(candidate => getLayer(candidate)?.classList.contains('active')) || candidates[0];
    const samples = {resolution:'3840 × 2160',aspect:'16:9',fps:'23.976 fps',duration:'00:01:32:12',audioCodec:'FLAC',channels:'Stereo',sampleRate:'48 kHz',bitDepth:'24-bit',lufs:'−16.2 LUFS',lra:'LRA 6.1 LU',tp:'TP −1.0 dBTP',zoom:'50%',filename:'review.mp4',fileSize:'24.0 MB'};
    const values = slot ? _infoBarValueSource(slot) : Object.fromEntries(_infoBarFields(_infoEditorType).map(field => [field.id,{text:samples[field.id],detail:field.label+': '+samples[field.id]}]));
    document.getElementById('infoEditorPreviewLabel').textContent = slot ? 'Preview · '+slotLabel(slot) : 'Preview · sample '+_infoEditorType;
    _infoBarRenderSurface(document.getElementById('infoEditorPreview'),slot || null,values,_infoBarProfile(_infoEditorType));
}

function _setupInfoBarEditor() {
    let saved = null;
    try {saved = _prefs.load('infoBarProfiles',null);} catch (_) {}
    _infoBarProfiles = Object.fromEntries(_INFO_TYPES.map(type => [type,_infoBarNormalize(type,saved?.version === 1 ? saved.profiles?.[type] : null)]));
    _infoBarObserver = new ResizeObserver(() => _queueInfoBarRefresh());
    _infoBarInitialized = true;
    document.getElementById('infoEditorButton').addEventListener('click',_openInfoBarEditor);
    const dialog = document.getElementById('infoEditorDialog');
    document.getElementById('infoEditorClose').addEventListener('click',_closeInfoBarEditor);
    dialog.addEventListener('close',() => {
        if (dialog.open) return;
        _infoEditorFinishDrag(false);
        _closeInfoBarOverflow(false); _infoBarRestoreSurface(document.getElementById('infoEditorPreview'));
        document.getElementById('infoEditorButton').setAttribute('aria-expanded','false');
        if (_infoEditorFocus?.isConnected && !document.querySelector('dialog[open]')) _infoEditorFocus.focus();_infoEditorFocus = null;
    });
    dialog.addEventListener('click',event => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) _closeInfoBarEditor();
    });
    document.getElementById('infoEditorType').addEventListener('change',event => {_infoEditorFinishDrag(false);_infoEditorType = event.target.value;_infoEditorSelection = null;_renderInfoEditor();});
    document.getElementById('infoEditorPreset').addEventListener('change',event => _commitInfoBarProfile(_infoEditorType,_infoBarPreset(_infoEditorType,event.target.value)));
    document.getElementById('infoEditorReset').addEventListener('click',() => _commitInfoBarProfile(_infoEditorType,_infoBarPreset(_infoEditorType)));
    document.getElementById('infoEditorAudio').addEventListener('change',event => {
        const visible = event.target.checked;
        _infoEditorChange(profile => profile.elements.forEach(element => {if (element.kind === 'field' && _INFO_FIELDS.find(field => field.id === element.id).audio) element.visible = visible;}));
    });
    const list = document.getElementById('infoEditorElements');
    list.addEventListener('change',event => {
        const id = event.target.dataset.infoToggle;if (!id) return;
        const visible = event.target.checked;
        _infoEditorChange(profile => profile.elements.find(element => element.id === id).visible = visible);
        list.querySelector('[data-info-toggle="'+id+'"]').focus({preventScroll:true});
    });
    list.addEventListener('click',event => {
        const choose = event.target.closest('[data-info-select]');
        if (choose) {_infoEditorSelection = choose.dataset.infoSelect;_renderInfoEditor();list.querySelector('[data-info-select="'+_infoEditorSelection+'"]').focus({preventScroll:true});}
    });
    list.addEventListener('dragstart',event => {
        if (_infoEditorPointer) {event.preventDefault();return;}
        _infoEditorClearDrop();const row = event.target.closest('[data-element-id]');_infoEditorDragged = row?.dataset.elementId || null;
        if (_infoEditorDragged) {event.dataTransfer.setData('text/plain',_infoEditorDragged);event.dataTransfer.effectAllowed = 'move';row.classList.add('info-dragging');}
    });
    list.addEventListener('dragover',event => {
        if (!_infoEditorDragged) return;
        event.preventDefault();event.dataTransfer.dropEffect = 'move';
        _infoEditorShowDrop(event.target,event.clientY);
    });
    list.addEventListener('dragleave',event => {if (!list.contains(event.relatedTarget)) _infoEditorClearDrop();});
    list.addEventListener('drop',event => {
        event.preventDefault();_infoEditorFinishDrag(true);
    });
    list.addEventListener('dragend',() => _infoEditorFinishDrag(false));
    // Native HTML dragging serves the mouse. Touch/pen handles use the same drop
    // policy through pointer capture, so a scrolling dialog cannot lose release.
    list.addEventListener('pointerdown',event => {
        const handle = event.target.closest('[data-info-drag]');
        if (!handle || event.pointerType === 'mouse' || !event.isPrimary) return;
        event.preventDefault();_infoEditorFinishDrag(false);
        _infoEditorPointer = {handle,pointerId:event.pointerId,id:handle.dataset.infoDrag,x:event.clientX,y:event.clientY,currentX:event.clientX,currentY:event.clientY};
        handle.setPointerCapture(event.pointerId);
    });
    list.addEventListener('pointermove',event => {
        const pointer = _infoEditorPointer;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        event.preventDefault();
        if (!_infoEditorDragged && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y) < 6) return;
        _infoEditorDragged = pointer.id;
        pointer.currentX = event.clientX;pointer.currentY = event.clientY;
        _infoEditorTrackPointerDrag();
    });
    list.addEventListener('pointerup',event => {if (_infoEditorPointer?.pointerId === event.pointerId) {event.preventDefault();_infoEditorFinishDrag(true);}});
    // A native mouse drag intentionally cancels its originating pointer stream.
    // Only retire a pointer gesture we own; native dragend owns mouse cleanup.
    list.addEventListener('pointercancel',event => {if (_infoEditorPointer?.pointerId === event.pointerId) _infoEditorFinishDrag(false);});
    list.addEventListener('lostpointercapture',() => {if (_infoEditorPointer) _infoEditorFinishDrag(false);});
    document.addEventListener('visibilitychange',() => {if (document.hidden) _infoEditorFinishDrag(false);});
    document.getElementById('infoEditorAddSpacer').addEventListener('click',() => {
        _infoEditorChange(profile => {
            if (profile.elements.filter(element => element.kind === 'spacer').length >= _INFO_MAX_SPACERS) return;
            let number = 1;
            while (profile.elements.some(element => element.id === 'gap-'+number)) number++;
            const selected = profile.elements.find(element => element.id === _infoEditorSelection);
            const spacer = {kind:'spacer',id:'gap-'+number,width:24,visible:true,align:selected.align};
            profile.elements.splice(profile.elements.findIndex(element => element.id === _infoEditorSelection)+1,0,spacer);_infoEditorSelection = spacer.id;
        });
    });
    document.getElementById('infoEditorSpacerWidth').addEventListener('input',event => {const width = Number(event.target.value);_infoEditorChange(profile => profile.elements.find(element => element.id === _infoEditorSelection).width = width);});
    document.getElementById('infoEditorRemoveSpacer').addEventListener('click',() => {_infoEditorChange(profile => {profile.elements = profile.elements.filter(element => element.id !== _infoEditorSelection);_infoEditorSelection = null;});});
    document.getElementById('infoEditorAlign').addEventListener('change',event => {
        const align = event.target.value;_infoEditorChange(profile => profile.elements.find(element => element.id === _infoEditorSelection).align = align);
    });
    const changeStyle = (key,value) => _infoEditorChange(profile => {profile.styles[_infoEditorSelection] = {...profile.styles[_infoEditorSelection],[key]:value};});
    document.getElementById('infoEditorSize').addEventListener('change',event => changeStyle('size',event.target.value === 'default' ? null : Number(event.target.value)));
    document.getElementById('infoEditorBold').addEventListener('change',event => changeStyle('bold',event.target.checked));
    document.getElementById('infoEditorColor').addEventListener('input',event => changeStyle('color',event.target.value));
    document.getElementById('infoEditorDefaultColor').addEventListener('click',() => changeStyle('color',null));
    document.getElementById('infoOverflowClose').addEventListener('click',() => _closeInfoBarOverflow());
    document.addEventListener('pointerdown',event => {
        if (_infoBarOverflow && !document.getElementById('infoOverflowPanel').contains(event.target) && !_infoBarOverflow.more.contains(event.target)) _closeInfoBarOverflow(false);
    });
    // Capture before app hotkeys. Keep all modal controls in the Tab order even
    // when the browser's native preference skips buttons; other inputs stay native.
    document.addEventListener('keydown',event => {
        if (!dialog.open && (!_infoBarOverflow || document.querySelector('dialog[open]'))) return;
        if (event.key === 'Escape') {event.preventDefault();if (_infoBarOverflow) _closeInfoBarOverflow();else _closeInfoBarEditor();}
        if (dialog.open && event.key === 'Tab') {
            const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
            if (focusable.length) {
                event.preventDefault();
                const index = focusable.indexOf(document.activeElement);
                const next = index < 0 ? (event.shiftKey ? focusable.length-1 : 0)
                    : (index+(event.shiftKey ? -1 : 1)+focusable.length)%focusable.length;
                focusable[next].focus();
            }
        }
        const handle = event.target.closest?.('[data-info-drag]');
        if (dialog.open && handle && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
            event.preventDefault();const id = handle.dataset.infoDrag;
            const profile = _infoBarProfile(_infoEditorType), element = profile.elements.find(item => item.id === id);
            const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight', align = event.key === 'ArrowLeft' ? 'left' : 'right';
            const direction = event.key === 'ArrowUp' ? -1 : 1, members = profile.elements.filter(item => item.align === element.align);
            const next = members[members.indexOf(element)+direction];
            if (horizontal ? element.align !== align : !!next) {
                _infoEditorSelection = id;
                _infoEditorChange(current => {
                    if (horizontal) current.elements.find(item => item.id === id).align = align;
                    else _infoEditorReorder(current,id,next.id,element.align,direction > 0);
                });
            }
            list.querySelector('[data-info-drag="'+id+'"]').focus({preventScroll:true});
        }
        event.stopImmediatePropagation();
    },true);
    window.addEventListener('resize',_queueInfoBarRefresh);
    window.addEventListener('storage',event => {
        if (event.key !== 'pref_infoBarProfiles' && event.key !== null) return;
        _infoEditorFinishDrag(false);
        let current = null;try {current = _prefs.load('infoBarProfiles',null);} catch (_) {}
        _infoBarProfiles = Object.fromEntries(_INFO_TYPES.map(type => [type,_infoBarNormalize(type,current?.version === 1 ? current.profiles?.[type] : null)]));
        _infoEditorSaveFailed = false;_refreshInfoBars();if (dialog.open) _renderInfoEditor();
        if (getLoadedSlotCount()) {if (isGridMode) positionLabelsToMedia(5);else applyZoom();}
    });
    _queueInfoBarRefresh();
}

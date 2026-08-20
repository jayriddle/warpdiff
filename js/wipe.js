// Image wipe controller. Stateful classic script: shares app globals from index.html.
// The presentation path deliberately uses real DOM layers + clip-path so the same
// geometry can later be validated for video without replacing the interaction model.

let _wipeMode = false;
let _wipePairIndex = 0;
let _wipePosition = 0.5;
let _wipeDragging = false;
let _wipeInternalSwitch = false;

function _getWipePairs() {
    return typeof _getDiffPairs === 'function' ? _getDiffPairs() : [];
}

function _wipePair() {
    const pairs = _getWipePairs();
    if (!pairs.length) return null;
    if (_wipePairIndex >= pairs.length) _wipePairIndex = 0;
    return pairs[_wipePairIndex];
}

function _wipeSlotText(slot) {
    return slot === 'original' ? 'Ref' : slot === 'editA' ? 'A' : 'B';
}

function _wipePairText(pair) {
    return pair ? _wipeSlotText(pair[0]) + '–' + _wipeSlotText(pair[1]) : '';
}

function _renderWipePairChooser(nameEl) {
    const pairs = _getWipePairs();
    nameEl.replaceChildren();
    nameEl.classList.add('wipe-pair-chooser');
    nameEl.setAttribute('role', 'group');
    nameEl.setAttribute('aria-label', 'Wipe comparison pair');

    const prefix = document.createElement('span');
    prefix.className = 'wipe-pair-prefix';
    prefix.textContent = 'WIPE';
    nameEl.appendChild(prefix);

    pairs.forEach((pair, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'wipe-pair-option';
        option.classList.toggle('active', index === _wipePairIndex);
        option.setAttribute('aria-pressed', index === _wipePairIndex ? 'true' : 'false');
        option.textContent = _wipePairText(pair);
        option.title = 'Compare ' + _wipePairText(pair);
        option.addEventListener('click', e => {
            e.stopPropagation();
            selectWipePair(index, true);
            option.blur();
        });
        nameEl.appendChild(option);
    });
}

function _updateWipeButton() {
    const btn = document.getElementById('wipeToggleBtn');
    if (!btn) return;
    btn.classList.toggle('active', _wipeMode);
    btn.setAttribute('aria-pressed', _wipeMode ? 'true' : 'false');
    const pair = _wipePair();
    btn.title = _wipeMode && pair
        ? 'Image wipe: ' + _wipePairText(pair) + ' (Q)'
        : 'Image wipe comparison (Q)';
}

function _renderWipeLayers() {
    document.querySelectorAll('.asset-layer').forEach(layer => {
        layer.classList.remove('wipe-base', 'wipe-reveal');
        const wrapper = layer.querySelector('.video-wrapper');
        if (wrapper) wrapper.style.clipPath = '';
    });
    if (!_wipeMode) return;
    const pair = _wipePair();
    if (!pair) return;
    const base = getLayer(pair[0]);
    const reveal = getLayer(pair[1]);
    if (base) base.classList.add('wipe-base');
    if (reveal) reveal.classList.add('wipe-reveal');
}

function _fitWipeRevealMedia(slot, wrapper, width, height) {
    const layer = getLayer(slot);
    const media = layer && layer.querySelector('img');
    if (!media) return;
    const { w: origW, h: origH } = mediaDims(media);
    const { nw, nh } = _rotatedDims(slot, origW, origH);
    if (!nw || !nh || !width || !height) return;

    const scale = Math.min(width / nw, height / nh);
    media.style.imageRendering = scale >= 2 ? 'pixelated' : '';
    const rot = _slotRotation[slot] || 0;
    if (rot) {
        media.style.position = 'absolute';
        media.style.width = Math.round(origW * scale) + 'px';
        media.style.height = Math.round(origH * scale) + 'px';
        media.style.top = '50%';
        media.style.left = '50%';
        media.style.maxWidth = 'none';
        media.style.maxHeight = 'none';
        media.style.objectFit = 'fill';
        media.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg)';
    } else {
        media.style.position = '';
        media.style.width = '100%';
        media.style.height = '100%';
        media.style.top = '';
        media.style.left = '';
        media.style.maxWidth = 'none';
        media.style.maxHeight = 'none';
        media.style.objectFit = 'contain';
        media.style.transform = '';
    }
}

// Single owner for wipe geometry. applyZoom() lays out the base layer first;
// this function maps the reveal layer into that exact comparison rectangle.
function _syncWipeGeometry() {
    if (!_wipeMode || isGridMode) return;
    const pair = _wipePair();
    if (!pair) return;
    const baseLayer = getLayer(pair[0]);
    const revealLayer = getLayer(pair[1]);
    const base = baseLayer && baseLayer.querySelector('.video-wrapper');
    const reveal = revealLayer && revealLayer.querySelector('.video-wrapper');
    const divider = document.getElementById('wipeDivider');
    if (!base || !reveal || !divider) return;

    ['position', 'top', 'left', 'width', 'height'].forEach(prop => {
        reveal.style[prop] = base.style[prop];
    });
    ['centerTop', 'centerLeft', 'scaledW', 'scaledH'].forEach(key => {
        if (base.dataset[key] !== undefined) reveal.dataset[key] = base.dataset[key];
    });

    const width = parseFloat(base.style.width) || 0;
    const height = parseFloat(base.style.height) || 0;
    const left = parseFloat(base.style.left) || 0;
    const top = parseFloat(base.style.top) || 0;
    _fitWipeRevealMedia(pair[1], reveal, width, height);

    base.style.clipPath = '';
    // Spatial order follows Grid order: pair[0] is left, pair[1] is right.
    // The reveal plate is clipped from the left so the base remains visible there.
    reveal.style.clipPath = 'inset(0 0 0 ' + (_wipePosition * 100) + '%)';
    divider.style.left = (left + width * _wipePosition) + 'px';
    divider.style.top = top + 'px';
    divider.style.height = height + 'px';
    divider.setAttribute('aria-valuenow', String(Math.round(_wipePosition * 100)));
    divider.setAttribute('aria-valuetext', Math.round(_wipePosition * 100) + '% ' + _wipeSlotText(pair[0]) + ' on left');
}

function _activateWipePair(announce = true) {
    const pair = _wipePair();
    if (!pair) return;
    _renderWipeLayers();
    const baseIndex = assetOrder.indexOf(pair[0]);
    if (baseIndex >= 0 && currentAssetIndex !== baseIndex) {
        _wipeInternalSwitch = true;
        switchToAsset(baseIndex);
        _wipeInternalSwitch = false;
    } else {
        applyZoom();
        refreshAssetButtons();
    }
    _renderWipeLayers();
    _syncWipeGeometry();
    _updateWipeButton();
    if (announce) showToast('Wipe: ' + _wipePairText(pair));
}

function _setWipeMode(enabled, announce = true) {
    enabled = !!enabled;
    if (enabled) {
        const loaded = assetOrder.filter(slot => mediaData[slot]);
        if (loaded.length < 2) {
            if (announce) showToast('Need at least 2 images for wipe');
            return false;
        }
        if (isGridMode) {
            if (announce) showToast('Image wipe available in Stack only');
            return false;
        }
        if (loaded.some(slot => mediaData[slot].type !== 'image')) {
            if (announce) showToast('Video wipe is not available yet');
            return false;
        }
        if (_diffMode) _setDiffMode(false, false);
        _wipeMode = true;
        document.body.classList.add('wipe-mode');
        _activateWipePair(false);
        if (announce) showToast('Wipe: ' + _wipePairText(_wipePair()));
    } else {
        const wasEnabled = _wipeMode;
        _wipeMode = false;
        _setWipeDragging(false);
        document.body.classList.remove('wipe-mode');
        _renderWipeLayers();
        _updateWipeButton();
        if (wasEnabled && getLoadedSlotCount() && !isGridMode) applyZoom();
        if (wasEnabled && announce) showToast('Wipe off');
    }
    _updateWipeButton();
    return true;
}

function toggleWipeMode() {
    _setWipeMode(!_wipeMode);
}

function cycleWipePair(delta = 1) {
    if (!_wipeMode) return;
    const pairs = _getWipePairs();
    if (pairs.length <= 1) return;
    selectWipePair(_wipePairIndex + delta, true);
}

function selectWipePair(index, announce = true) {
    if (!_wipeMode) return;
    const pairs = _getWipePairs();
    if (!pairs.length) return;
    const next = ((index % pairs.length) + pairs.length) % pairs.length;
    if (next === _wipePairIndex) return;
    _wipePairIndex = next;
    _activateWipePair(announce);
}

function _selectWipeSlot(slot) {
    if (!_wipeMode) return false;
    const pair = _wipePair();
    if (!pair || pair[0] === slot) return true;
    const pairs = _getWipePairs();
    let next = pairs.findIndex(p => p[0] === pair[0] && p[1] === slot);
    if (next < 0) next = pairs.findIndex(p => p.includes(slot));
    if (next >= 0 && next !== _wipePairIndex) {
        selectWipePair(next, true);
    }
    return true;
}

function _setWipePosition(position) {
    _wipePosition = Math.max(0, Math.min(1, position));
    _syncWipeGeometry();
}

function _setWipePositionFromPointer(e) {
    const pair = _wipePair();
    const layer = pair && getLayer(pair[0]);
    const wrapper = layer && layer.querySelector('.video-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;
    _setWipePosition((e.clientX - rect.left) / rect.width);
}

function _setWipeDragging(enabled) {
    _wipeDragging = !!enabled;
    document.body.classList.toggle('wipe-dragging', _wipeDragging);
}

function _setupWipeController() {
    const divider = document.getElementById('wipeDivider');
    const container = document.getElementById('assetContainer');
    if (!divider || divider.dataset.bound) return;
    divider.dataset.bound = '1';
    divider.addEventListener('pointerdown', e => {
        if (!_wipeMode || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        _setWipeDragging(true);
        divider.setPointerCapture(e.pointerId);
        _setWipePositionFromPointer(e);
    });
    divider.addEventListener('pointermove', e => {
        if (!_wipeDragging) return;
        e.preventDefault();
        e.stopPropagation();
        _setWipePositionFromPointer(e);
    });
    const end = e => {
        if (!_wipeDragging) return;
        _setWipeDragging(false);
        if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
    };
    divider.addEventListener('pointerup', end);
    divider.addEventListener('pointercancel', end);
    divider.addEventListener('lostpointercapture', end);
    divider.addEventListener('keydown', e => {
        const step = e.shiftKey ? 0.1 : 0.01;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation(); _setWipePosition(_wipePosition - step);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation(); _setWipePosition(_wipePosition + step);
        } else if (e.key === 'Home') {
            e.preventDefault(); e.stopPropagation(); _setWipePosition(0);
        } else if (e.key === 'End') {
            e.preventDefault(); e.stopPropagation(); _setWipePosition(1);
        }
    });

    // Click-to-snap on the comparison plate. A gesture that moves more than
    // four pixels remains a normal Stack pan, and clicks outside the plate are
    // ignored rather than clamped to an edge.
    if (container) {
        let clickStart = null;
        container.addEventListener('mousedown', e => {
            if (!_wipeMode || e.button !== 0 || e.target.closest('#wipeDivider, #stackMiniMap')) return;
            const pair = _wipePair();
            const layer = pair && getLayer(pair[0]);
            const wrapper = layer && layer.querySelector('.video-wrapper');
            if (!wrapper) return;
            const rect = wrapper.getBoundingClientRect();
            const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                           e.clientY >= rect.top && e.clientY <= rect.bottom;
            clickStart = inside ? { x: e.clientX, y: e.clientY, moved: false } : null;
        });
        container.addEventListener('mousemove', e => {
            if (!clickStart || clickStart.moved) return;
            const dx = e.clientX - clickStart.x;
            const dy = e.clientY - clickStart.y;
            if (dx * dx + dy * dy > 16) clickStart.moved = true;
        });
        container.addEventListener('mouseup', e => {
            const start = clickStart;
            clickStart = null;
            if (!start || start.moved || !_wipeMode) return;
            const pair = _wipePair();
            const layer = pair && getLayer(pair[0]);
            const wrapper = layer && layer.querySelector('.video-wrapper');
            if (!wrapper) return;
            const rect = wrapper.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom || !rect.width) return;
            _setWipePosition((e.clientX - rect.left) / rect.width);
        });
        container.addEventListener('mouseleave', () => { clickStart = null; });
    }
    _updateWipeButton();
}

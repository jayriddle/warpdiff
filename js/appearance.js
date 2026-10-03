// Cosmetic appearance owner. The media canvas, scopes and slot signal colors stay neutral.
const _APPEARANCES = { original: 'Original', starfield: 'Starfield', solar: 'Solar', nebula: 'Nebula', glacier: 'Glacier' };

function _setAppearance(value, persist = true) {
    const name = Object.hasOwn(_APPEARANCES, value) ? value : 'original';
    document.body.dataset.appearance = name;
    if (persist) { try { _prefs.save('appearance', name); } catch (_) {} }
    document.getElementById('appearanceLabel').textContent = _APPEARANCES[name];
    document.querySelectorAll('[data-appearance-choice]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.appearanceChoice === name));
    });
    document.dispatchEvent(new Event('warpdiff-appearance-change'));
}

function _closeAppearancePanel(restoreFocus = false) {
    document.getElementById('appearancePanel').hidden = true;
    document.getElementById('appearanceButton').setAttribute('aria-expanded', 'false');
    if (restoreFocus) document.getElementById('appearanceButton').focus();
}

function _setupAppearance() {
    let saved = 'original';
    try {
        saved = _prefs.load('appearance', 'original');
        // Preserve the old Easter egg only when no different appearance was selected.
        if (saved === 'original' && localStorage.getItem('starfieldOn') === '1') {
            saved = 'starfield';
            _prefs.save('appearance', saved);
        }
        localStorage.removeItem('starfieldOn');
    } catch (_) {}
    _setAppearance(saved, false);
    // Resolve the motion path in each plane's local coordinates on layout changes.
    // A percentage ellipse on the tiny body uses the body's reference box in Chromium.
    const orbitObserver = new ResizeObserver(entries => {
        for (const { target } of entries) {
            const rx = target.clientWidth / 2, ry = target.clientHeight / 2;
            if (!rx || !ry) continue;
            target.style.setProperty('--solar-path',
                `path("M ${rx * 2} ${ry} A ${rx} ${ry} 0 1 1 0 ${ry} A ${rx} ${ry} 0 1 1 ${rx * 2} ${ry}")`);
        }
    });
    document.querySelectorAll('.solar-orbit').forEach(plane => orbitObserver.observe(plane));
    const button = document.getElementById('appearanceButton');
    const panel = document.getElementById('appearancePanel');
    button.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) {
            panel.scrollTop = 0;
            document.getElementById('appearanceClose').focus({ preventScroll: true });
        }
    });
    document.getElementById('usageDetails').addEventListener('click', () => {
        if (panel.hidden) button.click();
        const details = document.getElementById('usageDisclosure');
        details.open = true;
        details.querySelector('summary').focus();
    });
    document.getElementById('appearanceClose').addEventListener('click', () => _closeAppearancePanel(true));
    document.querySelectorAll('[data-appearance-choice]').forEach(choice => {
        choice.addEventListener('click', () => _setAppearance(choice.dataset.appearanceChoice));
    });
    document.addEventListener('pointerdown', event => {
        if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) _closeAppearancePanel();
    });
    // Isolate panel keyboard input from comparison hotkeys; preserve native Tab/Space.
    document.addEventListener('keydown', event => {
        if (panel.hidden || event.metaKey || event.ctrlKey) return;
        if (event.key === 'Escape') { event.preventDefault(); _closeAppearancePanel(true); }
        event.stopImmediatePropagation();
    }, true);
    const syncMotion = () => {
        document.body.classList.toggle('appearance-paused', document.hidden);
    };
    document.addEventListener('visibilitychange', syncMotion);
    syncMotion();
    _setupNebulaGalaxy();
    _usage.setup();
}

// One frame owner for Nebula: freeze elapsed time whenever the decoration is inactive.
function _setupNebulaGalaxy() {
    const canvas = document.getElementById('nebulaGalaxy');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const landing = document.getElementById('landingCta');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, pixelRatio = 0, frame = null, lastTime = null, elapsed = 0;
    // Stable scatter prevents the galaxy rearranging itself on resize or theme changes.
    let seed = 73;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    const stars = Array.from({ length: 240 }, (_, i) => {
        const radius = .08 + Math.sqrt(random()) * .92;
        const arm = i % 2;
        const angle = i < 190 ? arm * Math.PI + radius * 4.8 + (random() - .5) * .45 : random() * Math.PI * 2;
        return { radius, angle, size: .5 + random() * 1.1, alpha: .25 + random() * .5,
            phase: random() * Math.PI * 2, twinkle: i % 13 === 0 };
    });
    const dust = document.createElement('canvas');
    dust.width = dust.height = 64;
    const dustCtx = dust.getContext('2d');
    const dustGlow = dustCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    dustGlow.addColorStop(0, 'rgba(159,110,219,.065)');
    dustGlow.addColorStop(.4, 'rgba(140,89,204,.03)');
    dustGlow.addColorStop(1, 'rgba(140,89,204,0)');
    dustCtx.fillStyle = dustGlow; dustCtx.fillRect(0, 0, 64, 64);
    function draw() {
        if (!width || !height) return;
        ctx.clearRect(0, 0, width, height);
        const cx = width * .36, cy = height * .38;
        const radius = Math.min(width * .53, height * .83);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-.28);
        // The haze and hub remain still; only the loose arms and their stars rotate.
        const hub = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * .3);
        hub.addColorStop(0, 'rgba(224,201,255,.24)');
        hub.addColorStop(.15, 'rgba(189,151,238,.15)');
        hub.addColorStop(.5, 'rgba(128,83,191,.06)');
        hub.addColorStop(1, 'rgba(128,83,191,0)');
        ctx.save(); ctx.scale(1, .65);
        ctx.fillStyle = hub; ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        ctx.restore();
        // Arms wind toward increasing angles outward; rotate the other way so they trail.
        const angleAt = (r, a) => a - elapsed * (.019 + .014 * (1 - r));
        const edgeFade = r => {
            const t = Math.min(1, Math.max(0, (1 - r) / .3));
            return t * t * (3 - 2 * t);
        };
        // Overlapping soft clouds give the arms texture without hard orbit tracks.
        for (let arm = 0; arm < 2; arm++) {
            for (let i = 0; i <= 60; i++) {
                const r = .08 + i / 60 * .92, a = angleAt(r, arm * Math.PI + r * 4.8);
                const x = Math.cos(a) * r * radius, y = Math.sin(a) * r * radius * .57;
                const size = radius * (.12 + .035 * Math.sin(i * .8 + arm));
                ctx.globalAlpha = edgeFade(r) * Math.min(1, (r - .08) / .12);
                ctx.drawImage(dust, x - size / 2, y - size / 2, size, size);
            }
        }
        ctx.globalAlpha = 1;
        for (const star of stars) {
            const a = angleAt(star.radius, star.angle);
            const x = Math.cos(a) * star.radius * radius, y = Math.sin(a) * star.radius * radius * .57;
            const alpha = star.alpha * edgeFade(star.radius) *
                (star.twinkle ? .8 + .2 * Math.sin(elapsed * .65 + star.phase) : 1);
            if (star.twinkle) {
                ctx.fillStyle = `rgba(182,146,235,${alpha * .12})`;
                ctx.beginPath(); ctx.arc(x, y, star.size * 3.5, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = `rgba(210,191,243,${alpha})`;
            ctx.beginPath(); ctx.arc(x, y, star.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
    function tick(time) {
        frame = null;
        if (lastTime !== null) elapsed += Math.min(50, Math.max(0, time - lastTime)) / 1000;
        lastTime = time;
        draw();
        frame = requestAnimationFrame(tick);
    }
    function sync() {
        const visible = document.body.dataset.appearance === 'nebula' && !document.hidden &&
            !landing.classList.contains('hidden') && canvas.getClientRects().length > 0;
        if (visible) {
            const rect = canvas.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
            if (rect.width !== width || rect.height !== height || dpr !== pixelRatio) {
                width = rect.width; height = rect.height; pixelRatio = dpr;
                canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                draw();
            }
        }
        if (visible && !reduced.matches) {
            if (frame === null) frame = requestAnimationFrame(tick);
        } else {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null; lastTime = null;
            if (visible) draw(); // Reduced motion retains a still galaxy.
        }
    }
    new ResizeObserver(sync).observe(canvas.parentElement);
    new MutationObserver(sync).observe(landing, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('warpdiff-appearance-change', sync);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    sync();
}

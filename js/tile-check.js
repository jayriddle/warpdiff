// WarpDiff seamless-tile analysis + preview rendering.
// Pure image-data math and canvas rendering; app state/UI lives in index.html.

function _tileClamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function _tilePercentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = _tileClamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
    return sorted[index];
}

function _tileMean(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
}

// Premultiplied RGBA distance with luma weighted more heavily than chroma.
// Premultiplication makes transparent-edge mismatches visible without assigning
// arbitrary importance to RGB values hidden under alpha=0.
function _tilePixelDistance(data, ia, ib) {
    const aa = data[ia + 3] / 255;
    const ab = data[ib + 3] / 255;
    const ar = data[ia] * aa, ag = data[ia + 1] * aa, ablu = data[ia + 2] * aa;
    const br = data[ib] * ab, bg = data[ib + 1] * ab, bblu = data[ib + 2] * ab;
    const dr = br - ar, dg = bg - ag, db = bblu - ablu;
    const dy = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
    const dcb = db - dy;
    const dcr = dr - dy;
    const da = (ab - aa) * 255;
    return Math.sqrt(0.72 * dy * dy + 0.14 * dcb * dcb + 0.14 * dcr * dcr + 0.35 * da * da);
}

// Difference between the step across a candidate boundary and the average step
// immediately on either side. A color match alone can hide a broken texture
// direction; this signed-gradient comparison catches that discontinuity.
function _tileGradientMismatch(data, iPrev, iA, iB, iNext) {
    let sum = 0;
    const weights = [0.22, 0.62, 0.16, 0.35];
    for (let c = 0; c < 4; c++) {
        let prev = data[iPrev + c], a = data[iA + c], b = data[iB + c], next = data[iNext + c];
        if (c < 3) {
            prev *= data[iPrev + 3] / 255;
            a *= data[iA + 3] / 255;
            b *= data[iB + 3] / 255;
            next *= data[iNext + 3] / 255;
        }
        const seamStep = b - a;
        const adjacentStep = ((a - prev) + (next - b)) * 0.5;
        const delta = seamStep - adjacentStep;
        sum += weights[c] * delta * delta;
    }
    return Math.sqrt(sum);
}

function _tileAxisAnalysis(imageData, axis) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const across = axis === 'x' ? width : height;
    const along = axis === 'x' ? height : width;
    if (across < 4 || along < 1) {
        return { score: 0, rating: 'Review', mean: 0, ratio: 0, heat: [1] };
    }

    const pixelIndex = (cross, line) => axis === 'x'
        ? (line * width + cross) * 4
        : (cross * width + line) * 4;
    const seamJumps = [];
    const seamGradients = [];
    const interiorJumps = [];
    const interiorGradients = [];
    const alongStep = Math.max(1, Math.floor(along / 512));
    const crossStep = Math.max(1, Math.floor((across - 3) / 32));

    for (let line = 0; line < along; line += alongStep) {
        const iPrev = pixelIndex(across - 2, line);
        const iA = pixelIndex(across - 1, line);
        const iB = pixelIndex(0, line);
        const iNext = pixelIndex(1, line);
        seamJumps.push(_tilePixelDistance(data, iA, iB));
        seamGradients.push(_tileGradientMismatch(data, iPrev, iA, iB, iNext));

        for (let cross = 1; cross < across - 2; cross += crossStep) {
            const p = pixelIndex(cross - 1, line);
            const a = pixelIndex(cross, line);
            const b = pixelIndex(cross + 1, line);
            const n = pixelIndex(cross + 2, line);
            interiorJumps.push(_tilePixelDistance(data, a, b));
            interiorGradients.push(_tileGradientMismatch(data, p, a, b, n));
        }
    }

    const seamMean = _tileMean(seamJumps);
    const seamP90 = _tilePercentile(seamJumps, 0.9);
    const seamGradientMean = _tileMean(seamGradients);
    const baseJump = _tilePercentile(interiorJumps, 0.5);
    const baseJumpP90 = _tilePercentile(interiorJumps, 0.9);
    const baseGradientP90 = _tilePercentile(interiorGradients, 0.9);
    const noiseFloor = 0.35;
    const meanRatio = (seamMean + noiseFloor) / (baseJump + noiseFloor);
    const peakRatio = (seamP90 + noiseFloor) / (baseJumpP90 + noiseFloor);
    const gradientRatio = (seamGradientMean + noiseFloor) / (baseGradientP90 + noiseFloor);
    const combinedRatio = 0.5 * meanRatio + 0.3 * peakRatio + 0.2 * gradientRatio;
    const relativeExcess = Math.max(0, combinedRatio - 1.15);
    // Absolute jump only matters when it also exceeds the image's normal texture.
    // A high-frequency checker/noise tile can have a large but perfectly ordinary
    // boundary step, so penalizing raw magnitude alone would be a false positive.
    const absoluteReference = Math.max(3, baseJumpP90 * 1.15);
    const absoluteExcess = Math.max(0, seamMean - absoluteReference) / 12;
    const score = Math.round(100 / (1 + 1.15 * relativeExcess + 0.55 * absoluteExcess));

    const heat = seamJumps.map((jump, i) => {
        const localJumpRatio = (jump + noiseFloor) / (baseJumpP90 + noiseFloor);
        const localGradientRatio = (seamGradients[i] + noiseFloor) / (baseGradientP90 + noiseFloor);
        return _tileClamp((0.72 * localJumpRatio + 0.28 * localGradientRatio - 1) / 3, 0, 1);
    });

    return {
        score: _tileClamp(score, 0, 100),
        rating: _tileRating(score),
        mean: seamMean,
        ratio: combinedRatio,
        heat
    };
}

function _tileRating(score) {
    if (score >= 82) return 'Seamless';
    if (score >= 55) return 'Review';
    return 'Visible seam';
}

function _tileEndpointSeverity(heat) {
    if (!heat || !heat.length) return 0;
    const n = Math.max(1, Math.round(heat.length * 0.08));
    return _tileMean(heat.slice(0, n).concat(heat.slice(-n)));
}

function _analyzeTileability(imageData) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        throw new Error('Tile analysis requires non-empty ImageData');
    }
    const horizontal = _tileAxisAnalysis(imageData, 'x'); // left ↔ right
    const vertical = _tileAxisAnalysis(imageData, 'y');   // top ↔ bottom
    const cornerSeverity = Math.max(
        _tileEndpointSeverity(horizontal.heat),
        _tileEndpointSeverity(vertical.heat)
    );
    const cornerScore = _tileClamp(
        Math.round(Math.min(horizontal.score, vertical.score) - cornerSeverity * 30),
        0,
        100
    );
    const corner = { score: cornerScore, rating: _tileRating(cornerScore), severity: cornerSeverity };
    const overallScore = Math.min(horizontal.score, vertical.score, corner.score);
    return {
        horizontal,
        vertical,
        corner,
        overall: { score: overallScore, rating: _tileRating(overallScore) }
    };
}

function _tileDrawChecker(ctx, width, height) {
    const size = 12;
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#171a20';
    for (let y = 0; y < height; y += size) {
        for (let x = 0; x < width; x += size) {
            if (((x / size) + (y / size)) % 2 === 0) ctx.fillRect(x, y, size, size);
        }
    }
}

function _tileHeatColor(value) {
    if (value < 0.18) return `rgba(74,221,32,${(0.18 + value * 0.5).toFixed(3)})`;
    if (value < 0.5) return `rgba(240,160,48,${(0.24 + value * 0.55).toFixed(3)})`;
    return `rgba(255,70,70,${(0.28 + value * 0.65).toFixed(3)})`;
}

function _tileDrawVerticalHeat(ctx, x, top, height, heat) {
    if (!heat || !heat.length) return;
    const step = Math.max(1, height / heat.length);
    for (let i = 0; i < heat.length; i++) {
        ctx.fillStyle = _tileHeatColor(heat[i]);
        ctx.fillRect(x - 2, top + i * step, 4, Math.ceil(step));
    }
}

function _tileDrawHorizontalHeat(ctx, y, left, width, heat) {
    if (!heat || !heat.length) return;
    const step = Math.max(1, width / heat.length);
    for (let i = 0; i < heat.length; i++) {
        ctx.fillStyle = _tileHeatColor(heat[i]);
        ctx.fillRect(left + i * step, y - 2, Math.ceil(step), 4);
    }
}

function _renderTilePreview(canvas, image, analysis, options) {
    if (!canvas || !image) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelW = Math.round(cssW * dpr);
    const pixelH = Math.round(cssH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    _tileDrawChecker(ctx, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    const pad = 16;
    const availableW = Math.max(1, cssW - pad * 2);
    const availableH = Math.max(1, cssH - pad * 2);
    const view = options && options.view === 'offset' ? 'offset' : 'repeat';
    const showHeatmap = !!(options && options.heatmap && analysis);

    if (view === 'offset') {
        const scale = Math.min(availableW / iw, availableH / ih);
        const dw = Math.max(1, iw * scale);
        const dh = Math.max(1, ih * scale);
        const left = (cssW - dw) / 2;
        const top = (cssH - dh) / 2;
        const sw = iw / 2, sh = ih / 2;
        const hw = dw / 2, hh = dh / 2;
        ctx.drawImage(image, sw, sh, sw, sh, left, top, hw, hh);
        ctx.drawImage(image, 0, sh, sw, sh, left + hw, top, hw, hh);
        ctx.drawImage(image, sw, 0, sw, sh, left, top + hh, hw, hh);
        ctx.drawImage(image, 0, 0, sw, sh, left + hw, top + hh, hw, hh);
        if (showHeatmap) {
            _tileDrawVerticalHeat(ctx, left + hw, top, dh, analysis.horizontal.heat);
            _tileDrawHorizontalHeat(ctx, top + hh, left, dw, analysis.vertical.heat);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(dw) - 1, Math.round(dh) - 1);
        return;
    }

    const scale = Math.min(availableW / (iw * 3), availableH / (ih * 3));
    const tw = Math.max(1, iw * scale);
    const th = Math.max(1, ih * scale);
    const left = (cssW - tw * 3) / 2;
    const top = (cssH - th * 3) / 2;
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            ctx.drawImage(image, left + col * tw, top + row * th, tw, th);
        }
    }
    if (showHeatmap) {
        for (let col = 1; col < 3; col++) {
            for (let row = 0; row < 3; row++) {
                _tileDrawVerticalHeat(ctx, left + col * tw, top + row * th, th, analysis.horizontal.heat);
            }
        }
        for (let row = 1; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                _tileDrawHorizontalHeat(ctx, top + row * th, left + col * tw, tw, analysis.vertical.heat);
            }
        }
    }
}

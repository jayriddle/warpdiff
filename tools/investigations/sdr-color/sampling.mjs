import assert from 'node:assert/strict';
import { ffmpeg, sampleRGB } from './fixtures.mjs';
export function readSamples(element, {
  columns = 8,
  rows = 4
} = {}) {
  const w = element.videoWidth || element.naturalWidth || element.width,
    h = element.videoHeight || element.naturalHeight || element.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true
  });
  ctx.drawImage(element, 0, 0);
  return {
    width: w,
    height: h,
    canvas: ctx.getContextAttributes(),
    samples: Array.from({
      length: columns * rows
    }, (_, i) => {
      const data = ctx.getImageData(Math.floor((i % columns + .5) * w / columns), Math.floor((Math.floor(i / columns) + .5) * h / rows), 1, 1, {
        colorSpace: 'srgb'
      }).data;
      return {
        name: 'patch-' + i,
        rgb: [...data].slice(0, 3)
      };
    })
  };
}
export async function screenshotSamples(locator, file) {
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0);
  await locator.screenshot({
    path: file,
    animations: 'disabled'
  });
  const raw = ffmpeg(['-i', file, '-vf', 'scale=640:360:flags=neighbor', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  return sampleRGB(raw);
}

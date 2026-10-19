// Repository-only deterministic references. Never writes tests/fixtures or downloads media.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
export const width = 640,
  height = 360,
  columns = 8,
  rows = 4;
export const patches = [...[16, 20, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 216, 235].map(y => ({
  name: 'gray-' + y,
  yuv: [y, 128, 128]
})), {
  name: '601-red',
  yuv: [81, 90, 240]
}, {
  name: '601-green',
  yuv: [145, 54, 34]
}, {
  name: '601-blue',
  yuv: [41, 240, 110]
}, {
  name: '709-red',
  yuv: [63, 102, 240]
}, {
  name: '709-green',
  yuv: [173, 42, 26]
}, {
  name: '709-blue',
  yuv: [32, 240, 118]
}, ...[[120, 105, 160], [160, 150, 105], [90, 150, 145], [190, 110, 110], [100, 100, 150], [160, 100, 100]].map((yuv, i) => ({
  name: 'mid-color-' + i,
  yuv
})), {
  name: 'below-black',
  yuv: [4, 128, 128]
}, {
  name: 'above-white',
  yuv: [250, 128, 128]
}, {
  name: 'neutral-black',
  yuv: [0, 128, 128]
}, {
  name: 'neutral-white',
  yuv: [255, 128, 128]
}];
export const sha256 = b => createHash('sha256').update(b).digest('hex');
export const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...args], {
  maxBuffer: 64 * 1024 * 1024,
  timeout: 60000
});
export const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
  maxBuffer: 2 * 1024 * 1024
}));
export function sampleRGB(bytes, w = width, h = height) {
  return patches.map((p, i) => {
    const x = Math.floor((i % columns + .5) * w / columns),
      y = Math.floor((Math.floor(i / columns) + .5) * h / rows),
      at = (y * w + x) * 3;
    return {
      name: p.name,
      rgb: [...bytes.subarray(at, at + 3)]
    };
  });
}
export function reference(file, matrix, range) {
  return sampleRGB(ffmpeg(['-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=in_color_matrix=${matrix}:in_range=${range}:out_range=pc:flags=accurate_rnd+full_chroma_int`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']));
}
export function rawPicture(file) {
  return ffmpeg(['-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
}
// Explicit sRGB PNG, generated without an image dependency.
function crc32(b) {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
export function makePNG(rgb) {
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(width);
  hdr.writeUInt32BE(height, 4);
  hdr[8] = 8;
  hdr[9] = 2;
  const scan = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(scan, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hdr), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}
export function makeFixtures(directory) {
  fs.mkdirSync(directory, {
    recursive: true
  });
  const raw = Buffer.alloc(width * height * 3 / 2),
    rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = Math.floor(y / (height / rows)) * columns + Math.floor(x / (width / columns)),
      p = patches[i];
    raw[y * width + x] = p.yuv[0];
    if (x % 2 === 0 && y % 2 === 0) {
      const uv = y / 2 * (width / 2) + x / 2;
      raw[width * height + uv] = p.yuv[1];
      raw[width * height * 5 / 4 + uv] = p.yuv[2];
    }
    const colors = [[0, 0, 0], [16, 16, 16], [32, 32, 32], [64, 64, 64], [96, 96, 96], [128, 128, 128], [192, 192, 192], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [192, 96, 64], [64, 128, 192]];
    Buffer.from(colors[i % colors.length]).copy(rgb, (y * width + x) * 3);
  }
  const rawFile = path.join(directory, 'patches.yuv');
  fs.writeFileSync(rawFile, raw);
  const image = path.join(directory, 'srgb.png');
  fs.writeFileSync(image, makePNG(rgb));
  const imageTwin = path.join(directory, 'srgb-copy.png');
  fs.copyFileSync(image, imageTwin);
  const cases = [];
  for (const spec of [{
    name: 'matrix709-limited',
    matrix: 'bt709',
    range: 'tv',
    primaries: 'bt709',
    transfer: 'bt709'
  }, {
    name: 'matrix601-limited',
    matrix: 'smpte170m',
    range: 'tv',
    primaries: 'bt709',
    transfer: 'bt709'
  }, {
    name: 'matrix709-full',
    matrix: 'bt709',
    range: 'pc',
    primaries: 'bt709',
    transfer: 'bt709'
  }, {
    name: 'srgb-transfer',
    matrix: 'bt709',
    range: 'tv',
    primaries: 'bt709',
    transfer: 'iec61966-2-1'
  }, {
    name: 'untagged',
    matrix: null,
    range: null,
    primaries: null,
    transfer: null
  }]) {
    const file = path.join(directory, spec.name + '.mp4'),
      tags = spec.matrix ? ['-colorspace', spec.matrix, '-color_range', spec.range, '-color_primaries', spec.primaries, '-color_trc', spec.transfer] : [];
    ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', width + 'x' + height, '-framerate', '24', '-stream_loop', '-1', '-i', rawFile, '-t', '0.5', '-an', ...(spec.matrix ? ['-vf', `setparams=range=${spec.range === 'pc' ? 'full' : 'limited'}:color_primaries=${spec.primaries}:color_trc=${spec.transfer}:colorspace=${spec.matrix}`] : []), '-c:v', 'libx264', '-crf', '0', '-preset', 'fast', '-pix_fmt', 'yuv420p', ...tags, '-movflags', '+faststart', file]);
    cases.push({
      ...spec,
      file,
      metadata: probe(file).streams.find(s => s.codec_type === 'video'),
      references: {
        bt601: reference(file, 'bt601', spec.range || 'tv'),
        bt709: reference(file, 'bt709', spec.range || 'tv')
      },
      rawHash: sha256(rawPicture(file))
    });
  }
  const encoded = path.join(directory, 'encode709.mkv');
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', width + 'x' + height, '-framerate', '24', '-stream_loop', '-1', '-i', rawFile, '-t', '0.5', '-an', '-vf', 'setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'ffv1', '-colorspace', 'bt709', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', encoded]);
  const red = path.join(directory, 'red-untagged.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=960x540:r=24:d=0.5', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'dca', '-strict', '-2', red]);
  const redVariants = [{
    name: 'red-untagged',
    file: red
  }];
  for (const [name, matrix, id] of [['red-tag601', 'smpte170m', 6], ['red-tag709', 'bt709', 1]]) {
    const file = path.join(directory, name + '.mp4');
    ffmpeg(['-i', red, '-c', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=' + id, '-colorspace', matrix, '-color_primaries', 'bt709', '-color_trc', 'bt709', file]);
    redVariants.push({
      name,
      file
    });
  }
  return {
    width,
    height,
    columns,
    rows,
    patches,
    cases,
    redVariants,
    encodeSource: encoded,
    image,
    imageTwin,
    imageSamples: sampleRGB(rgb),
    rawHash: sha256(raw),
    files: [rawFile, image, imageTwin, encoded, ...cases.map(c => c.file), ...redVariants.map(c => c.file)]
  };
}

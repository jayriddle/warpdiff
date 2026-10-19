import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareCompatible } from '../../media-prepare/companion/processor.mjs';
import { probe, rawPicture, sha256, reference, ffmpeg } from './fixtures.mjs';
const colorKeys = ['color_space', 'color_range', 'color_primaries', 'color_transfer', 'chroma_location'];
export function colorMetadata(stream) {
  return Object.fromEntries(colorKeys.map(k => [k, stream[k] ?? null]));
}
export function difference(a, b) {
  assert.equal(a.length, b.length);
  return Math.max(...a.flatMap((p, i) => p.rgb.map((n, k) => Math.abs(n - b[i].rgb[k]))));
}
const videoHash = file => sha256(ffmpeg(['-i', file, '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', 'pipe:1']));
export function assertCopyPreserved(input, output) {
  const before = colorMetadata(probe(input).streams.find(s => s.codec_type === 'video')),
    after = colorMetadata(probe(output).streams.find(s => s.codec_type === 'video'));
  assert.deepEqual(after, before, 'Copied color metadata changed');
  const decodedSamplesEqual = sha256(rawPicture(input)) === sha256(rawPicture(output));
  assert.equal(decodedSamplesEqual, true, 'Copied decoded picture changed');
  const elementaryStreamEqual = videoHash(input) === videoHash(output);
  assert.equal(elementaryStreamEqual, true, 'Copied video bitstream changed');
  return {
    decodedSamplesEqual,
    elementaryStreamEqual
  };
}
export async function nativeChecks(fixtures, directory, record) {
  const cases = [...fixtures.cases, ...fixtures.redVariants, {
    name: 'encode709',
    file: fixtures.encodeSource
  }];
  record.native = [];
  for (const source of cases) {
    const target = path.join(directory, 'prepared-' + source.name);
    fs.mkdirSync(target);
    const before = probe(source.file).streams.find(s => s.codec_type === 'video');
    let row = {
      name: source.name,
      input: source.file,
      metadataBefore: colorMetadata(before),
      pixelFormatBefore: before.pix_fmt
    };
    record.native.push(row);
    try {
      const result = await prepareCompatible({
        input: source.file,
        directory: target,
        kind: 'video'
      });
      Object.assign(row, {
        output: result.file,
        preparation: result.preparation,
        metadataAfter: colorMetadata(probe(result.file).streams.find(s => s.codec_type === 'video'))
      });
      row.decodedSamplesEqual = sha256(rawPicture(source.file)) === sha256(rawPicture(result.file));
      if (result.preparation.picture === 'copied') {
        Object.assign(row, assertCopyPreserved(source.file, result.file));
      }
      const matrix = before.color_space === 'smpte170m' ? 'bt601' : 'bt709',
        range = before.color_range === 'pc' ? 'pc' : 'tv';
      row.referenceBefore = reference(source.file, matrix, range);
      row.referenceAfter = reference(result.file, matrix, row.metadataAfter.color_range === 'pc' ? 'pc' : 'tv');
      row.maxRGBError = difference(row.referenceBefore, row.referenceAfter);
      if (source.name === 'encode709') {
        for (const k of colorKeys.filter(k => k !== 'chroma_location')) assert.equal(row.metadataAfter[k], row.metadataBefore[k], k);
        assert(row.maxRGBError <= 3, 'Flat-patch H264 encoding error exceeded 3 codes');
      }
      row.passed = true;
    } catch (error) {
      row.error = error.stack;
      const rejectedFile = path.join(target, 'review.mp4');
      if (fs.existsSync(rejectedFile)) {
        const stream = probe(rejectedFile).streams.find(s => s.codec_type === 'video');
        row.rejectedOutput = {
          file: rejectedFile,
          pixelFormat: stream?.pix_fmt,
          metadata: colorMetadata(stream || {})
        };
      }
      row.passed = false;
    }
  }
  return record.native;
}

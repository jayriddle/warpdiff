import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 24 fps picture, shorter AAC, B-frames and an edit list. Each frame number is
// stored in six large bars (bit 0 at the left) and also drawn as text.
export function prepareFrameRateFixture(directory) {
  const file = path.join(directory, 'frame-numbers.mp4');
  const bars = "color=c=black:s=320x180:r=24:d=2,format=yuv420p,geq=lum='if(lt(mod(X\\,40)\\,30)\\,if(gte(bitand(N\\,pow(2\\,floor(X/40)))\\,1)\\,235\\,16)\\,16)':cb=128:cr=128";
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', bars,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.2',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-bf', '2', '-g', '12', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    '-vf', "drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf:text='%{n}':fontsize=48:fontcolor=white:x=200:y=80",
    file
  ], { timeout: 30000 });
  const probe = execFileSync('ffprobe', [
    '-hide_banner', '-v', 'error',
    '-show_entries', 'stream=codec_type,r_frame_rate,duration',
    '-of', 'compact', file
  ], { encoding: 'utf8' });
  if (!probe.includes('codec_type=video') || !probe.includes('r_frame_rate=24/1')) {
    throw new Error('Frame-rate fixture is not 24 fps video');
  }
  const video = probe.split('\n').find(line => line.includes('codec_type=video')) || '';
  const audio = probe.split('\n').find(line => line.includes('codec_type=audio')) || '';
  const duration = kind => Number((kind.match(/duration=([0-9.]+)/) || [])[1]);
  if (!(duration(audio) > 0) || !(duration(audio) < duration(video) - 0.5)) {
    throw new Error('Frame-rate fixture audio is not shorter than the picture');
  }
  if (!openingEdit(file)) throw new Error('Frame-rate fixture has no opening video edit list');
  const types = execFileSync('ffprobe', [
    '-hide_banner', '-v', 'error', '-select_streams', 'v:0',
    '-show_frames', '-show_entries', 'frame=pict_type', '-of', 'csv', file
  ], { encoding: 'utf8' });
  if (!types.includes(',B')) throw new Error('Frame-rate fixture has no B-frames');
  return file;
}

function openingEdit(file) {
  const data = fs.readFileSync(file);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const typeAt = off => String.fromCharCode(data[off + 4], data[off + 5], data[off + 6], data[off + 7]);
  function walk(start, end, depth) {
    let off = start;
    while (off + 8 <= end && depth < 8) {
      let size = view.getUint32(off);
      const type = typeAt(off);
      let header = 8;
      if (size === 1) {
        if (off + 16 > end) return false;
        size = Number(view.getBigUint64(off + 8));
        header = 16;
      } else if (size === 0) size = end - off;
      if (!Number.isSafeInteger(size) || size < header || off + size > end) return false;
      if (type === 'elst') {
        const payload = off + header;
        if (payload + 16 > end || data[payload] > 1) return false;
        const mediaTime = data[payload] === 1
          ? Number(view.getBigInt64(payload + 16))
          : view.getInt32(payload + 12);
        return mediaTime > 0;
      }
      if (['moov', 'trak', 'edts', 'mdia'].includes(type) && walk(off + header, off + size, depth + 1)) return true;
      off += size;
    }
    return false;
  }
  return walk(0, data.length, 0);
}

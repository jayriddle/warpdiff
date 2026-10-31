import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {clusterOffsets, patchFirstClusterUnknown} from './helpers/webm-cluster.mjs';

// Unknown-size Cluster/Segment elements end at the next element of the same or
// higher level. BlockGroup carries a normal Block, including the last Opus packet.
export function runWebmClusterChecks(check, source = readFileSync(new URL('../js/mp4-demux.js', import.meta.url), 'utf8')) {
  const realm = {console: {log() {}, warn() {}}};
  runInNewContext(source, realm);
  const parse = bytes => realm._demuxWebMAudio(bytes);

  function vint(value) {
    if (value < 0x7F) return Buffer.from([0x80 | value]);
    if (value < 0x3FFF) return Buffer.from([0x40 | (value >> 8), value & 0xFF]);
    if (value < 0x1FFFFF) return Buffer.from([0x20 | (value >> 16), (value >> 8) & 0xFF, value & 0xFF]);
    return Buffer.from([0x10 | ((value >>> 24) & 0xFF), (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]);
  }
  function unknownVint(width) {
    const bytes = Buffer.alloc(width, 0xFF);
    const marker = 1 << (8 - width);
    bytes[0] = marker | (marker - 1);
    return bytes;
  }
  function el(id, body, size) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.concat(body);
    return Buffer.concat([Buffer.from(id, 'hex'), size || vint(payload.length), payload]);
  }
  function uint(value) {
    const bytes = [];
    let rest = value;
    do { bytes.unshift(rest & 255); rest = Math.floor(rest / 256); } while (rest > 0);
    return Buffer.from(bytes);
  }
  function frame(id, track, rel, payload, flags = 0x80) {
    const timed = (rel + 0x10000) & 0xFFFF;
    return el(id, Buffer.concat([
      Buffer.from([0x80 | track, timed >> 8, timed & 0xFF, flags]),
      Buffer.from(payload)
    ]));
  }
  function cluster(timestamp, children, unknownWidth) {
    const body = Buffer.concat([el('e7', uint(timestamp)), ...children]);
    return el('1f43b675', body, unknownWidth ? unknownVint(unknownWidth) : undefined);
  }
  function track(num = 1) {
    return el('ae', Buffer.concat([
      el('d7', Buffer.from([num])),
      el('83', Buffer.from([2])),
      el('86', Buffer.from('A_OPUS'))
    ]));
  }
  function webm(parts, segmentWidth) {
    const body = Buffer.concat(parts);
    return new Uint8Array(Buffer.concat([
      el('1a45dfa3', Buffer.alloc(0)),
      el('18538067', body, segmentWidth ? unknownVint(segmentWidth) : undefined)
    ]));
  }
  function packets(timestamp) {
    return [
      frame('a3', 1, 0, [1, timestamp & 255]),
      frame('a3', 1, 20, [2, timestamp & 255])
    ];
  }
  const known = webm([
    el('1654ae6b', track()),
    cluster(0, packets(0)),
    cluster(1000, packets(1))
  ]);
  const knownParsed = parse(known);
  check('webm-cluster: known clusters keep every audio packet and its cluster time',
    knownParsed?.chunks.length === 4 && knownParsed.chunks.map(chunk => chunk.timestamp).join(',') === '0,20000,1000000,1020000'
    && knownParsed.chunks[0].data[0] === 1 && knownParsed.chunks[3].data[0] === 2);

  for (const width of [1, 2, 8]) {
    const unknown = parse(webm([
      el('1654ae6b', track()),
      cluster(0, packets(0), width),
      cluster(1000, packets(1))
    ]));
    check('webm-cluster: unknown-size cluster width ' + width + ' still reaches the next cluster',
      unknown?.chunks.length === 4 && unknown.chunks[3].timestamp === 1020000 && unknown.chunks[3].data[0] === 2);
  }

  const streaming = parse(webm([
    el('1654ae6b', track()),
    cluster(0, packets(0), 1),
    cluster(1000, packets(1), 1)
  ], 8));
  check('webm-cluster: unknown segment and unknown clusters still return every packet',
    streaming?.chunks.length === 4 && streaming.chunks[2].timestamp === 1000000);

  const grouped = parse(webm([
    el('1654ae6b', track()),
    cluster(0, [
      frame('a3', 1, 0, [7, 8, 9]),
      el('a0', Buffer.concat([
        frame('a1', 1, 40, [4, 5, 6]),
        el('9b', Buffer.from([0x28]))
      ]))
    ])
  ]));
  check('webm-cluster: a Block inside BlockGroup is an audio packet',
    grouped?.chunks.length === 2 && grouped.chunks[0].data.join(',') === '7,8,9'
    && grouped.chunks[1].timestamp === 40000 && grouped.chunks[1].data.join(',') === '4,5,6');

  const unfinished = parse(webm([
    el('1654ae6b', track()),
    cluster(0, [
      frame('a3', 1, 0, [1]),
      el('a3', Buffer.from([0x81, 0, 0, 0x80, 9]), unknownVint(1))
    ])
  ]));
  check('webm-cluster: an unbounded block does not publish a shorter soundtrack', unfinished === null);

  const prefix = frame('a3', 1, 0, [1, 2, 3]);
  for (const [lace, flags] of [['Xiph', 0x02], ['fixed-size', 0x04], ['EBML', 0x06]]) {
    for (const [kind, id] of [['SimpleBlock', 'a3'], ['BlockGroup', 'a1']]) {
      const laced = frame(id, 1, 20, [0x01, 0xf8, 0xff, 0xfe, 0xf8, 0xff, 0xfe], flags);
      const damaged = id === 'a1' ? el('a0', Buffer.concat([laced, el('9b', Buffer.from([0x28]))])) : laced;
      check('webm-cluster: ' + lace + ' lacing in ' + kind + ' publishes no extraction',
        parse(webm([el('1654ae6b', track()), cluster(0, [prefix, damaged])])) === null);
    }
  }
  const otherTrackLaced = frame('a3', 2, 0, [9, 9, 9], 0x06);
  const kept = parse(webm([
    el('1654ae6b', track()),
    cluster(0, [otherTrackLaced, frame('a3', 1, 0, [4, 5, 6])])
  ]));
  check('webm-cluster: lacing on another track does not discard the selected soundtrack',
    kept?.chunks.length === 1 && kept.chunks[0].data.join(',') === '4,5,6');

  function reject(name, bytes) {
    check('webm-cluster: ' + name + ' does not publish the valid prefix', parse(bytes) === null);
  }
  const truncated = Buffer.from('a340', 'hex');
  reject('truncated header after a packet in a known cluster', webm([
    el('1654ae6b', track()), cluster(0, [prefix, truncated])
  ]));
  reject('truncated header after a packet in an unknown cluster', webm([
    el('1654ae6b', track()), cluster(0, [prefix, truncated], 1)
  ]));
  reject('selected-track block header missing its timestamp', webm([
    el('1654ae6b', track()), cluster(0, [prefix, el('a3', Buffer.from([0x81]))])
  ]));
  reject('selected-track block header missing its timestamp in an unknown cluster', webm([
    el('1654ae6b', track()), cluster(0, [prefix, el('a3', Buffer.from([0x81]))], 1)
  ]));

  const overflow = el('a3', Buffer.alloc(30, 7));
  const overflowBody = Buffer.concat([el('e7', uint(0)), prefix, overflow]);
  const overflowKeep = overflowBody.length - overflow.length + 4;
  reject('block declaring data past its known cluster', webm([
    el('1654ae6b', track()),
    Buffer.concat([Buffer.from('1f43b675', 'hex'), vint(overflowKeep), overflowBody])
  ]));
  const unknownOverflow = Buffer.concat([
    el('1654ae6b', track()),
    el('1f43b675', overflowBody, unknownVint(1))
  ]);
  // Shrink the file so the last block's declared size crosses EOF while a packet remains.
  const eofBody = Buffer.concat([el('e7', uint(0)), prefix, Buffer.from([0xa3, 0xfe]), Buffer.alloc(7, 1)]);
  reject('declared block size clamped at EOF in a known cluster', webm([
    el('1654ae6b', track()), el('1f43b675', eofBody)
  ]));
  reject('declared block size clamped at EOF in an unknown cluster', webm([
    el('1654ae6b', track()), el('1f43b675', eofBody, unknownVint(1))
  ]));
  check('webm-cluster: parent-boundary fixture actually extends past the cluster size',
    overflow.length > 4 && overflowKeep < overflowBody.length && unknownOverflow.length > overflowKeep);

  const tracksAfter = webm([
    cluster(0, [frame('a3', 1, 0, [3, 3, 3])], 1),
    el('1654ae6b', track())
  ]);
  const lateMetadata = realm._demuxWebMAudio(tracksAfter, true);
  const latePackets = parse(tracksAfter);
  check('webm-cluster: tracks after an unknown cluster still select that soundtrack',
    lateMetadata?.trackSelectionVerified === true && lateMetadata.audioTracks.length === 1
    && latePackets?.chunks.length === 1 && latePackets.chunks[0].data[0] === 3);

  const directory = mkdtempSync(join(tmpdir(), 'warpdiff-webm-cluster-'));
  try {
    const file = join(directory, 'clusters.webm');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
      '-b:v', '80k', '-c:a', 'libopus', '-b:a', '32k', '-cluster_time_limit', '200', file], {timeout: 30000});
    const original = readFileSync(file);
    const patched = patchFirstClusterUnknown(original);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-count_packets',
      '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], {encoding: 'utf8', timeout: 30000}).trim();
    const expected = Number(probe);
    const full = parse(new Uint8Array(original));
    const partial = parse(new Uint8Array(patched));
    check('webm-cluster: generated file has several clusters and the patched size stays unknown',
      clusterOffsets(original).length >= 2 && clusterOffsets(patched).length === 0
      && patched[clusterOffsets(original)[0] + 4] !== original[clusterOffsets(original)[0] + 4]);
    check('webm-cluster: generated known and unknown-size files keep ffprobe\'s audio packets',
      expected > 20 && full?.chunks.length === expected && partial?.chunks.length === expected
      && partial.chunks.at(-1).timestamp > 1500000);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

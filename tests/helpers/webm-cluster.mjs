// Patch the first Cluster size in a real WebM to the unknown-size sentinel
// without changing the element header width or any payload bytes.

function readId(data, offset) {
  if (offset >= data.length) return null;
  const first = data[offset];
  const width = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (!width || offset + width > data.length) return null;
  let id = 0;
  for (let i = 0; i < width; i++) id = id * 256 + data[offset + i];
  return {id, width};
}

function readSize(data, offset) {
  if (offset >= data.length) return null;
  const first = data[offset];
  let width = 1, mask = 0x80;
  while (width <= 8 && !(first & mask)) { width++; mask >>= 1; }
  if (width > 8 || offset + width > data.length) return null;
  let value = first & (mask - 1);
  let unknown = value === mask - 1;
  for (let i = 1; i < width; i++) {
    if (data[offset + i] !== 0xFF) unknown = false;
    value = value * 256 + data[offset + i];
  }
  return {width, mask, value, unknown};
}

// Cluster element offsets in a known-size Segment. Unknown sizes stop the walk.
export function clusterOffsets(input) {
  const data = Buffer.from(input);
  const found = [];
  function walk(start, end, depth) {
    if (depth > 6) return;
    let offset = start;
    while (offset + 2 <= end) {
      const id = readId(data, offset);
      const size = id && readSize(data, offset + id.width);
      if (!id || !size || size.unknown || !Number.isSafeInteger(size.value)) return;
      const dataOffset = offset + id.width + size.width;
      const next = dataOffset + size.value;
      if (next < dataOffset || next > end) return;
      if (id.id === 0x1F43B675) found.push(offset);
      if (id.id === 0x1A45DFA3 || id.id === 0x18538067) walk(dataOffset, next, depth + 1);
      offset = next;
    }
  }
  walk(0, data.length, 0);
  return found;
}

export function patchFirstClusterUnknown(input) {
  const data = Buffer.from(input);
  const offsets = clusterOffsets(data);
  if (offsets.length < 2) throw new Error('WebM fixture needs at least two clusters');
  const sizeAt = offsets[0] + 4; // Cluster ID is 4 bytes
  const size = readSize(data, sizeAt);
  if (!size || size.unknown) throw new Error('first cluster size is missing or already unknown');
  data[sizeAt] = size.mask | (size.mask - 1);
  for (let i = 1; i < size.width; i++) data[sizeAt + i] = 0xFF;
  return data;
}

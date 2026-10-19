// Deliberate negative control, never loaded by the app. This retired curve must
// still make the compositor comparison fail, while ordinary scrubbing passes.
export function installLegacyFilter() {
  const table = '0 0.0156 0.0554 0.0995 0.139 0.1759 0.2114 0.249 0.2853 0.3205 0.3534 0.3869 0.4208 0.4504 0.4807 0.5119 0.5431 0.5744 0.6056 0.6361 0.6615 0.6915 0.7202 0.7501 0.7775 0.8087 0.836 0.8631 0.8924 0.918 0.9453 0.9727 1';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(ns, 'filter');
  filter.id = 'legacy-color-negative-control';
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const transfer = document.createElementNS(ns, 'feComponentTransfer');
  for (const channel of ['R', 'G', 'B']) {
    const fn = document.createElementNS(ns, 'feFunc' + channel);
    fn.setAttribute('type', 'table'); fn.setAttribute('tableValues', table);
    transfer.append(fn);
  }
  filter.append(transfer); svg.append(filter); document.body.append(svg);
}

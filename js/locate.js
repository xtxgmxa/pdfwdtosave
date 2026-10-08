const TARGET_HEIGHTS = [40, 64, 90];

export function inkMask(source) {
  const { width, height } = source;
  const data = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const build = (limit) => {
    const mask = new Uint8Array(width * height);
    let dark = 0;
    for (let i = 0, j = 0; j < mask.length; i += 4, j += 1) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      if (max < limit && max - Math.min(r, g, b) < 60) {
        mask[j] = 1;
        dark += 1;
      }
    }
    return { mask, dark };
  };
  let result = build(150);
  if (result.dark < width * height * 0.004) result = build(185);
  return { mask: result.mask, width, height };
}

export function textRows({ mask, width, height }) {
  const x0 = Math.round(width * 0.08);
  const x1 = Math.round(width * 0.92);
  const minInk = Math.max(3, Math.round(width * 0.004));
  const gapLimit = Math.max(2, Math.round(height * 0.006));
  const rows = [];
  let start = -1;
  let gap = 0;

  for (let y = 0; y <= height; y += 1) {
    let count = 0;
    if (y < height) {
      const offset = y * width;
      for (let x = x0; x < x1; x += 1) count += mask[offset + x];
    }
    if (count >= minInk) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > gapLimit || y === height) {
        const end = y - gap + 1;
        if (end - start >= height * 0.012) rows.push({ y0: start, y1: end });
        start = -1;
        gap = 0;
      }
    }
  }

  for (const row of rows) {
    let left = width;
    let right = 0;
    for (let y = row.y0; y < row.y1; y += 1) {
      const offset = y * width;
      for (let x = x0; x < x1; x += 1) {
        if (!mask[offset + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    row.left = left;
    row.right = right;
    row.span = Math.max(0, right - left);
    row.height = row.y1 - row.y0;
  }
  return rows;
}

export function headlineRows(view) {
  const { width, height } = view;
  return textRows(view)
    .filter((row) => row.y0 < height * 0.65)
    .filter((row) => row.height >= height * 0.022 && row.height <= height * 0.16)
    .filter((row) => row.span >= width * 0.25);
}

export function rowImage(view, row, targetHeight) {
  const pad = Math.round(row.height * 0.35);
  const left = Math.max(0, row.left - pad);
  const top = Math.max(0, row.y0 - pad);
  const right = Math.min(view.width, row.right + pad);
  const bottom = Math.min(view.height, row.y1 + pad);
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  const raw = document.createElement('canvas');
  raw.width = cropWidth;
  raw.height = cropHeight;
  const context = raw.getContext('2d');
  const pixels = context.createImageData(cropWidth, cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const value = view.mask[(top + y) * view.width + left + x] ? 0 : 255;
      const at = (y * cropWidth + x) * 4;
      pixels.data[at] = value;
      pixels.data[at + 1] = value;
      pixels.data[at + 2] = value;
      pixels.data[at + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);

  const scale = targetHeight / row.height;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cropWidth * scale));
  out.height = Math.max(1, Math.round(cropHeight * scale));
  const outContext = out.getContext('2d');
  outContext.fillStyle = '#ffffff';
  outContext.fillRect(0, 0, out.width, out.height);
  outContext.imageSmoothingEnabled = true;
  outContext.imageSmoothingQuality = 'high';
  outContext.drawImage(raw, 0, 0, out.width, out.height);
  return out;
}

export function compact(text) {
  return String(text || '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d\u4e00-\u9fff]/g, '');
}

export function vote(readings) {
  const usable = readings.filter((reading) => reading.text);
  if (!usable.length) return { text: '', confidence: 0 };
  const groups = new Map();
  for (const reading of usable) {
    const group = groups.get(reading.text.length) || [];
    group.push(reading);
    groups.set(reading.text.length, group);
  }
  const weight = (group) => group.reduce((sum, reading) => sum + reading.confidence, 0);
  const group = [...groups.values()].sort((a, b) => b.length - a.length || weight(b) - weight(a))[0];
  let text = '';
  for (let i = 0; i < group[0].text.length; i += 1) {
    const tally = new Map();
    for (const reading of group) {
      const ch = reading.text[i];
      tally.set(ch, (tally.get(ch) || 0) + 1 + reading.confidence / 1000);
    }
    text += [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { text, confidence: weight(group) / group.length };
}

export { TARGET_HEIGHTS };

export function similarity(a, b) {
  if (!a || !b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = keep;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

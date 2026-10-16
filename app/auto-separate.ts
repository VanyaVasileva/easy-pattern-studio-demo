export type AlphaComponent = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Int32Array;
};

export type AlphaSheetCheck = {
  likelyOpaqueBackground: boolean;
  transparentRatio: number;
  transparentBorderRatio: number;
};

// Pixels below roughly 3% opacity are invisible in normal artwork but are a
// common residue left by background-removal tools. Treating alpha 1 as solid
// can connect an entire clipart sheet into one accidental component.
const SEPARATION_ALPHA_THRESHOLD = 8;

export function inspectAlphaSheet(data: Uint8ClampedArray, width: number, height: number): AlphaSheetCheck {
  const total = Math.max(1, width * height);
  let transparent = 0;
  let transparentBorder = 0;
  let border = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3];
    if (alpha <= SEPARATION_ALPHA_THRESHOLD) transparent++;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      border++;
      if (alpha <= SEPARATION_ALPHA_THRESHOLD) transparentBorder++;
    }
  }
  const transparentRatio = transparent / total;
  const transparentBorderRatio = transparentBorder / Math.max(1, border);
  return {
    transparentRatio,
    transparentBorderRatio,
    likelyOpaqueBackground: transparentRatio < .002 && transparentBorderRatio < .02,
  };
}

// Eight-neighbour alpha islands preserve soft painted edges while ignoring
// imperceptible residue and microscopic accidental specks.
export function findAlphaComponents(data: Uint8ClampedArray, width: number, height: number): AlphaComponent[] {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: AlphaComponent[] = [];
  const minimumPixels = Math.max(12, Math.round(width * height * .00001));
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed] || data[seed * 4 + 3] <= SEPARATION_ALPHA_THRESHOLD) continue;
    visited[seed] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    const pixels: number[] = [];
    let minX = width, minY = height, maxX = 0, maxY = 0;
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (visited[neighbour] || data[neighbour * 4 + 3] <= SEPARATION_ALPHA_THRESHOLD) continue;
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    if (pixels.length >= minimumPixels && componentWidth * componentHeight >= 25) {
      components.push({ x: minX, y: minY, width: componentWidth, height: componentHeight, pixels: Int32Array.from(pixels) });
    }
  }
  return components.sort((a, b) => a.y - b.y || a.x - b.x);
}

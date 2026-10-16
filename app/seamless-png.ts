export type WrappedComponent = { x: number; y: number; width: number; height: number; pixels: Int32Array };
const mod = (n: number, size: number) => (n + size) % size;
// The shortest circular bounds put split edge/corner pieces back together
// without resampling or shifting their original position in the repeat.
function circularBounds(used: Uint8Array) {
  const positions: number[] = [];
  for (let i = 0; i < used.length; i++) if (used[i]) positions.push(i);
  let gap = -1, start = positions[0];
  for (let i = 0; i < positions.length; i++) {
    const next = positions[(i + 1) % positions.length];
    const distance = (i === positions.length - 1 ? next + used.length : next) - positions[i] - 1;
    if (distance > gap) { gap = distance; start = next; }
  }
  return { start, size: used.length - gap };
}
export function findWrappedComponents(data: Uint8ClampedArray, width: number, height: number): WrappedComponent[] {
  const visited = new Uint8Array(width * height);
  // Allocate for the largest connected motif, rather than the entire tile.
  let queue = new Int32Array(Math.min(width * height, 65536));
  const result: WrappedComponent[] = [];
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed] || data[seed * 4 + 3] <= 8) continue;
    let head = 0, tail = 1; queue[0] = seed; visited[seed] = 1;
    const columns = new Uint8Array(width), rows = new Uint8Array(height);
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      columns[x] = 1; rows[y] = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const next = mod(y + dy, height) * width + mod(x + dx, width);
        if (visited[next] || data[next * 4 + 3] <= 8) continue;
        visited[next] = 1;
        if (tail === queue.length) {
          const grown = new Int32Array(Math.min(width * height, queue.length * 2));
          grown.set(queue); queue = grown;
        }
        queue[tail++] = next;
      }
    }
    const horizontal = circularBounds(columns), vertical = circularBounds(rows);
    result.push({ x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size, pixels: queue.slice(0, tail) });
  }
  return result;
}
export function componentPixels(data: Uint8ClampedArray, tileWidth: number, tileHeight: number, part: WrappedComponent) {
  const result = new Uint8ClampedArray(part.width * part.height * 4);
  for (const p of part.pixels) {
    const x = mod(p % tileWidth - part.x, tileWidth), y = mod(Math.floor(p / tileWidth) - part.y, tileHeight);
    const target = (y * part.width + x) * 4;
    result.set(data.subarray(p * 4, p * 4 + 4), target);
  }
  return result;
}

// A review group is a union of original tile pixels. Its shortest circular
// bounds reconnect selected details without moving, scaling or repainting them.
export function mergeWrappedComponents(parts: WrappedComponent[], width: number, height: number): WrappedComponent {
  if (!parts.length) throw new Error('Select at least one motif.');
  const pixels = new Int32Array(parts.reduce((total, part) => total + part.pixels.length, 0));
  const columns = new Uint8Array(width), rows = new Uint8Array(height);
  let offset = 0;
  for (const part of parts) {
    pixels.set(part.pixels, offset); offset += part.pixels.length;
    for (const p of part.pixels) { columns[p % width] = 1; rows[Math.floor(p / width)] = 1; }
  }
  const horizontal = circularBounds(columns), vertical = circularBounds(rows);
  return { x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size, pixels };
}

export const joinWrappedComponents = mergeWrappedComponents;

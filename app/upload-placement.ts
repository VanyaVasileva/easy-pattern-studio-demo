type Size = { width: number; height: number; scale?: number; x?: number; y?: number };

/** Distribute new PNGs in the central part of the tile, avoiding existing art. */
export function spreadUploadedMotifs<T extends Size>(newMotifs: T[], existing: Size[], tileWidth: number, tileHeight: number, random = Math.random): T[] {
  const placed = existing.map((motif) => ({
    x: motif.x ?? tileWidth / 2, y: motif.y ?? tileHeight / 2,
    width: motif.width * (motif.scale ?? 1), height: motif.height * (motif.scale ?? 1),
  }));
  const phase = random() * Math.PI * 2;
  const centerX = tileWidth / 2, centerY = tileHeight / 2;
  const rings = [0, .09, .18, .27, .35];
  return newMotifs.map((motif, index) => {
    const width = motif.width * (motif.scale ?? 1);
    const height = motif.height * (motif.scale ?? 1);
    const margin = 24;
    const minX = Math.min(centerX, Math.max(tileWidth * .12, width / 2 + margin));
    const maxX = Math.max(centerX, Math.min(tileWidth * .88, tileWidth - width / 2 - margin));
    const minY = Math.min(centerY, Math.max(tileHeight * .12, height / 2 + margin));
    const maxY = Math.max(centerY, Math.min(tileHeight * .88, tileHeight - height / 2 - margin));
    let best = { x: centerX, y: centerY, score: Infinity };
    for (const ring of rings) {
      const steps = ring === 0 ? 1 : 16;
      for (let step = 0; step < steps; step++) {
        const angle = phase + (step + index * .37) * Math.PI * 2 / steps;
        const x = Math.max(minX, Math.min(maxX, centerX + Math.cos(angle) * ring * tileWidth));
        const y = Math.max(minY, Math.min(maxY, centerY + Math.sin(angle) * ring * tileHeight));
        let collision = 0;
        for (const other of placed) {
          const overlapX = Math.max(0, (width + other.width) / 2 + margin - Math.abs(x - other.x));
          const overlapY = Math.max(0, (height + other.height) / 2 + margin - Math.abs(y - other.y));
          collision += overlapX * overlapY;
        }
        const score = collision * 100 + ring * 100 + random() * 3;
        if (score < best.score) best = { x, y, score };
      }
    }
    placed.push({ x: best.x, y: best.y, width, height });
    return { ...motif, x: best.x, y: best.y };
  });
}

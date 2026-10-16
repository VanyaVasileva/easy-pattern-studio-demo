// Fill the repeat in one operation. Independently cleared/clipped tiles can
// leave antialiased gaps at fractional device-pixel positions during a pinch.
export function fillRepeatPattern(context: CanvasRenderingContext2D, tile: HTMLCanvasElement, width: number, height: number, cellWidth: number, cellHeight: number, originX: number, originY: number) {
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return;
  pattern.setTransform({ a: cellWidth / tile.width, b: 0, c: 0, d: cellHeight / tile.height, e: originX, f: originY });
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
  context.restore();
}

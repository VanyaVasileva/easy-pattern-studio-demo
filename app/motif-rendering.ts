// Compensate tiny floating-point errors when a canvas conversion lands on half a pixel.
export function roundedMotifSize(width: number, height: number, scale: number, outputRatio: number) {
  return {
    width: Math.max(1, Math.round(width * scale * outputRatio + 1e-9)),
    height: Math.max(1, Math.round(height * scale * outputRatio + 1e-9)),
  };
}

export function nativeMotifWorkingSize(sourceWidth: number, sourceHeight: number, canvasWidth: number, tileSize = 1000) {
  return {
    width: sourceWidth / canvasWidth * tileSize,
    height: sourceHeight / canvasWidth * tileSize,
  };
}

export const MIN_CUSTOM_CANVAS_SIZE = 500;
export const MAX_CUSTOM_CANVAS_SIZE = 6000;

export function parseSquareCanvasSize(rawValue: string) {
  const value = rawValue.trim();
  if (!/^\d+$/.test(value)) return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < MIN_CUSTOM_CANVAS_SIZE || size > MAX_CUSTOM_CANVAS_SIZE) return null;
  return size;
}

export function pixelAlignedTopLeft(centerX: number, centerY: number, width: number, height: number) {
  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
  };
}

export function nearestWrappedCopy(value: number, pointer: number, period: number) {
  const canonical = ((value % period) + period) % period;
  const offset = Math.round((pointer - canonical) / period);
  return { center: canonical + offset * period, offset };
}

export type RepeatViewport = { zoom: number; panX: number; panY: number };
export type RepeatPoint = { x: number; y: number };

export function visibleRepeatTiles(width: number, height: number, cellWidth: number, cellHeight: number, startX: number, startY: number, viewport: RepeatViewport) {
  const left = width / 2 + (-width / 2 - viewport.panX) / viewport.zoom;
  const right = width / 2 + (width / 2 - viewport.panX) / viewport.zoom;
  const top = height / 2 + (-height / 2 - viewport.panY) / viewport.zoom;
  const bottom = height / 2 + (height / 2 - viewport.panY) / viewport.zoom;
  return {
    firstColumn: Math.floor((left - startX) / cellWidth),
    endColumn: Math.ceil((right - startX) / cellWidth),
    firstRow: Math.floor((top - startY) / cellHeight),
    endRow: Math.ceil((bottom - startY) / cellHeight),
  };
}

export function clampRepeatViewport(viewport: RepeatViewport, width: number, height: number, aspect: number): RepeatViewport {
  const zoom = Math.max(1, Math.min(6, viewport.zoom));
  // The full-screen repeat is infinite, so a finite 2x2 boundary must not
  // prevent moving to other parts of the pattern on a tall phone screen.
  return { zoom, panX: viewport.panX, panY: viewport.panY };
}

// Points are relative to the viewport center. Keep the same pattern point
// under the fingers as their distance and midpoint change.
export function zoomRepeatAt(viewport: RepeatViewport, zoom: number, from: RepeatPoint, to: RepeatPoint = from): RepeatViewport {
  const nextZoom = Math.max(1, Math.min(6, zoom));
  const ratio = nextZoom / viewport.zoom;
  return { zoom: nextZoom, panX: to.x - (from.x - viewport.panX) * ratio, panY: to.y - (from.y - viewport.panY) * ratio };
}

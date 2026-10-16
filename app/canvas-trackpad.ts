export function zoomCanvasAt(current: { zoom: number; panX: number; panY: number }, requestedZoom: number, x: number, y: number, frameWidth: number, frameHeight: number) {
  const zoom = Math.max(1, Math.min(6, requestedZoom));
  const ratio = zoom / current.zoom;
  const maxX = frameWidth * (zoom - 1) / 2;
  const maxY = frameHeight * (zoom - 1) / 2;
  return {
    zoom,
    panX: Math.max(-maxX, Math.min(maxX, x - (x - current.panX) * ratio)),
    panY: Math.max(-maxY, Math.min(maxY, y - (y - current.panY) * ratio)),
  };
}

export function panCanvasBy(current: { zoom: number; panX: number; panY: number }, deltaX: number, deltaY: number, frameWidth: number, frameHeight: number) {
  if (current.zoom <= 1) return { zoom: 1, panX: 0, panY: 0 };
  const maxX = frameWidth * (current.zoom - 1) / 2;
  const maxY = frameHeight * (current.zoom - 1) / 2;
  return {
    zoom: current.zoom,
    panX: Math.max(-maxX, Math.min(maxX, current.panX - deltaX)),
    panY: Math.max(-maxY, Math.min(maxY, current.panY - deltaY)),
  };
}

// Bound GPU-backed preview memory on tablets. Export dimensions are separate.
export function editorPreviewSize(displayWidth: number, displayHeight: number, deviceDensity: number) {
  const density = Math.min(Math.max(deviceDensity, 1), 3);
  const requestedWidth = Math.max(1, displayWidth * density);
  const requestedHeight = Math.max(1, displayHeight * density);
  const reduction = Math.min(1, 4096 / requestedWidth, 4096 / requestedHeight, Math.sqrt(16_000_000 / (requestedWidth * requestedHeight)));
  return {
    width: Math.max(1, Math.floor(requestedWidth * reduction)),
    height: Math.max(1, Math.floor(requestedHeight * reduction)),
  };
}

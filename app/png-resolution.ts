// Read PNG physical-resolution metadata without decoding or changing pixels.
export function readPngDpi(bytes: Uint8Array): number | null {
  if (bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "pHYs" && length === 9 && bytes[offset + 16] === 1) {
      const x = view.getUint32(offset + 8) * .0254;
      const y = view.getUint32(offset + 12) * .0254;
      // A scalar DPI cannot describe unequal horizontal/vertical resolution.
      if (Math.abs(x - y) > .1) return null;
      const dpi = Math.round((x + y) / 2);
      return dpi >= 36 && dpi <= 2400 ? dpi : null;
    }
    if (type === "IEND") break;
    offset = end;
  }
  return null;
}

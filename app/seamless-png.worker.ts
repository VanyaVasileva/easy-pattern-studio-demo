import { findWrappedComponents } from './seamless-png';
import { inspectAlphaSheet } from './auto-separate';
self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; size: number }>) => {
  try {
    const { data, size } = event.data;
    if (inspectAlphaSheet(data, size, size).likelyOpaqueBackground) throw new Error('This PNG still has a background. Remove it in your image editor, then upload the seamless tile as a transparent PNG.');
    const parts = findWrappedComponents(data, size, size);
    if (!parts.length) throw new Error('No visible motifs were found in this PNG.');
    if (parts.length > 1000) throw new Error('Too many disconnected pieces were found. Clean up small background-removal residue in your image editor and try again.');
    self.postMessage({ data, parts }, { transfer: [data.buffer, ...parts.map(part => part.pixels.buffer)] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not reconnect this tile.' }); }
};

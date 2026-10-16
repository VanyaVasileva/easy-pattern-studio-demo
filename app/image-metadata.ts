const PROFILE_PATH = `${import.meta.env.BASE_URL}profiles/sRGB-IEC61966-2.1.icc.b64`;

let profilePromise: Promise<Uint8Array> | null = null;

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function loadSrgbProfile() {
  if (!profilePromise) {
    profilePromise = fetch(PROFILE_PATH).then(async (response) => {
      if (!response.ok) throw new Error("Could not load the sRGB color profile");
      const encoded = (await response.text()).replace(/\s/g, "");
      const binary = atob(encoded);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    });
  }
  return profilePromise;
}

export function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(typeName: string, data: Uint8Array) {
  const type = new TextEncoder().encode(typeName);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const checksumInput = new Uint8Array(type.length + data.length);
  checksumInput.set(type);
  checksumInput.set(data, type.length);
  view.setUint32(8 + data.length, crc32(checksumInput));
  return chunk;
}

async function deflate(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([ownedBuffer(bytes)]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function withPngMetadata(blob: Blob, dpi: number, profile: Uint8Array) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const physical = new Uint8Array(9);
  const physicalView = new DataView(physical.buffer);
  physicalView.setUint32(0, ppm);
  physicalView.setUint32(4, ppm);
  physical[8] = 1;

  const compressedProfile = await deflate(profile);
  const metadata: Uint8Array[] = [];
  if (compressedProfile) {
    const name = new TextEncoder().encode("sRGB IEC61966-2.1");
    const iccp = new Uint8Array(name.length + 2 + compressedProfile.length);
    iccp.set(name);
    iccp[name.length] = 0;
    iccp[name.length + 1] = 0;
    iccp.set(compressedProfile, name.length + 2);
    metadata.push(pngChunk("iCCP", iccp));
  } else {
    metadata.push(pngChunk("sRGB", new Uint8Array([0])));
  }
  metadata.push(pngChunk("pHYs", physical));

  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    if (!["iCCP", "sRGB", "pHYs"].includes(type)) parts.push(bytes.slice(offset, end));
    if (type === "IHDR" && !inserted) {
      parts.push(...metadata);
      inserted = true;
    }
    offset = end;
  }
  return new Blob(parts.map(ownedBuffer), { type: "image/png" });
}

function setJpegDpi(bytes: Uint8Array, dpi: number) {
  for (let offset = 2; offset + 17 < bytes.length;) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe0 && bytes[offset + 4] === 0x4a && bytes[offset + 5] === 0x46 && bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x46) {
      const density = Math.max(1, Math.min(65535, Math.round(dpi)));
      bytes[offset + 11] = 1;
      bytes[offset + 12] = density >> 8;
      bytes[offset + 13] = density & 0xff;
      bytes[offset + 14] = density >> 8;
      bytes[offset + 15] = density & 0xff;
      break;
    }
    if (length < 2) break;
    offset += length + 2;
  }
}

export async function withJpegMetadata(blob: Blob, dpi: number, profile: Uint8Array) {
  const source = new Uint8Array(await blob.arrayBuffer());
  setJpegDpi(source, dpi);
  const signature = new TextEncoder().encode("ICC_PROFILE\0");
  const maxPayload = 65519;
  const count = Math.ceil(profile.length / maxPayload);
  const segments: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const payload = profile.slice(index * maxPayload, (index + 1) * maxPayload);
    const segment = new Uint8Array(18 + payload.length);
    segment[0] = 0xff;
    segment[1] = 0xe2;
    const length = 16 + payload.length;
    segment[2] = length >> 8;
    segment[3] = length & 0xff;
    segment.set(signature, 4);
    segment[16] = index + 1;
    segment[17] = count;
    segment.set(payload, 18);
    segments.push(segment);
  }
  return new Blob([source.slice(0, 2), ...segments, source.slice(2)].map(ownedBuffer), { type: "image/jpeg" });
}

export function encodeTiffPixels(width: number, height: number, rgba: Uint8ClampedArray, transparent: boolean, dpi: number, profile: Uint8Array) {
  const samples = transparent ? 4 : 3;
  const entries = transparent ? 16 : 15;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const xResolutionOffset = bitsOffset + samples * 2;
  const yResolutionOffset = xResolutionOffset + 8;
  const profileOffset = yResolutionOffset + 8;
  const pixelsOffset = profileOffset + profile.length + (profile.length % 2);
  const byteCount = width * height * samples;
  const buffer = new ArrayBuffer(pixelsOffset + byteCount);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries, true);
  let entryIndex = 0;
  const entry = (tag: number, type: number, count: number, value: number) => {
    const at = ifdOffset + 2 + entryIndex++ * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  };
  entry(256, 4, 1, width);
  entry(257, 4, 1, height);
  entry(258, 3, samples, bitsOffset);
  entry(259, 3, 1, 1);
  entry(262, 3, 1, 2);
  entry(273, 4, 1, pixelsOffset);
  entry(274, 3, 1, 1);
  entry(277, 3, 1, samples);
  entry(278, 4, 1, height);
  entry(279, 4, 1, byteCount);
  entry(282, 5, 1, xResolutionOffset);
  entry(283, 5, 1, yResolutionOffset);
  entry(284, 3, 1, 1);
  entry(296, 3, 1, 2);
  if (transparent) entry(338, 3, 1, 2);
  entry(34675, 7, profile.length, profileOffset);
  view.setUint32(ifdOffset + 2 + entries * 12, 0, true);
  for (let index = 0; index < samples; index++) view.setUint16(bitsOffset + index * 2, 8, true);
  view.setUint32(xResolutionOffset, dpi, true);
  view.setUint32(xResolutionOffset + 4, 1, true);
  view.setUint32(yResolutionOffset, dpi, true);
  view.setUint32(yResolutionOffset + 4, 1, true);
  bytes.set(profile, profileOffset);
  let output = pixelsOffset;
  for (let input = 0; input < rgba.length; input += 4) {
    bytes[output++] = rgba[input];
    bytes[output++] = rgba[input + 1];
    bytes[output++] = rgba[input + 2];
    if (transparent) bytes[output++] = rgba[input + 3];
  }
  return new Blob([buffer], { type: "image/tiff" });
}

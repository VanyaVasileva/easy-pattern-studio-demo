export type Rgb = { r: number; g: number; b: number };
export type Hsv = { h: number; s: number; v: number };
export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(rgb: Rgb): string {
  return "#" + [rgb.r, rgb.g, rgb.b].map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  h = ((h % 360) + 360) % 360; s = clampUnit(s); v = clampUnit(v);
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) };
}

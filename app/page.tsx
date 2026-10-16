"use client";

import { panCanvasBy, zoomCanvasAt } from "./canvas-trackpad";
import { editorPreviewSize } from "./editor-preview-resolution";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronsDown, ChevronsUp, Copy, Crosshair, Download, Eraser, FilePlus2, FlipHorizontal2, ImagePlus, LassoSelect, Maximize2, MousePointer2, Redo2, RotateCcw, Scissors, Trash2, Undo2, Upload, X } from "lucide-react";
import { ButtonHTMLAttributes, ChangeEvent, ComponentProps, CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { encodeTiffPixels, loadSrgbProfile, withJpegMetadata, withPngMetadata } from "./image-metadata";
import { MAX_CUSTOM_CANVAS_SIZE, MIN_CUSTOM_CANVAS_SIZE, nativeMotifWorkingSize, nearestWrappedCopy, parseSquareCanvasSize, pixelAlignedTopLeft, roundedMotifSize } from "./motif-rendering";
import { MotifRasterCache } from "./motif-raster-cache";
import { LayerMove, reorderMotifLayer } from "./motif-layering";
import { motifDragThreshold, shouldCommitMotifDrag, shouldDeselectCanvasOnPointerDown } from "./editor-gesture";
import { clearLastPattern, readLastPattern, saveLastPattern } from "./recovery-storage";
import { spreadUploadedMotifs } from "./upload-placement";
import { findAlphaComponents, inspectAlphaSheet } from "./auto-separate";
import { SeamlessPngDialog, type ImportedSeamlessPng, type ImportedSeamlessPiece } from "./seamless-png-dialog";
import { positionUnmergedPart } from "./merge-layout";
import { clampRepeatViewport, zoomRepeatAt, RepeatViewport } from "./repeat-viewport";
import { cropToolInstruction, cropTouchIntent } from "./crop-touch";
import { fillRepeatPattern } from "./repeat-pattern";

const TILE = 1000;
const EXPORT_SIZE = 2000;
const DEFAULT_DPI = 300;
const CANVAS_PRESETS = [2000, 3000, 4000] as const;
const isCanvasPreset = (size: number) => (CANVAS_PRESETS as readonly number[]).includes(size);
const MAX_PRINT_SAFE_SCALE = 1.25;
const QUICK_SCROLL_THRESHOLD_PX = 12;
const QUICK_SCROLL_WINDOW_MS = 180;
const QUICK_SCROLL_AXIS_RATIO = 1.15;
const TRANSPORT_GUIDE = `${import.meta.env.BASE_URL}templates/vintage-transport.png`;
const LIBRARY_TEMPLATES = [
  { id: "red-florals", name: "Red Florals", src: `${import.meta.env.BASE_URL}templates/library/red-florals.jpeg` },
  { id: "vintage-transport", name: "Vintage Transport", src: TRANSPORT_GUIDE },
  { id: "ocean-line-art", name: "Ocean Line Art", src: `${import.meta.env.BASE_URL}templates/library/ocean-line-art.jpeg` },
  { id: "deer", name: "Woodland Deer", src: `${import.meta.env.BASE_URL}templates/library/deer.jpeg` },
] as const;
type Workflow = "motifs" | "finished";
type MeasurementUnit = "cm" | "in";
type ExportFormat = "png" | "jpeg" | "tiff";
type ExportBackground = "included" | "transparent";
type LineColorScope = "selected" | "all";
type Motif = { id: string; name: string; src: string; originalFile?: File; sourceWidth?: number; sourceHeight?: number; sourceDpi?: number; sheetId?: string; sheetBounds?: CropRect; mergeParts?: { motif: Motif; offsetX: number; offsetY: number }[]; x: number; y: number; width: number; height: number; scale: number; maxScale?: number; rotation: number; flipX: boolean; opacity: number; lineColor: string | null };
type GuideLayer = { id?: string; src: string; name: string; kind: "library" | "uploaded"; x: number; y: number; width: number; height: number; scale: number; opacity: number; visible: boolean; sourceWidth?: number; sourceHeight?: number };
type FinishedPattern = { name: string; src: string; previewSrc: string; width: number; height: number; mime: string; originalFile?: File };
type MotifCanvas = { width: number; height: number; dpi: number };
type CropSheet = { id: string; src: string; name: string; width: number; height: number; dpi: number };
type CropRect = { x: number; y: number; width: number; height: number };
type CropPoint = { x: number; y: number };
type CropTool = "move" | "lasso" | "eraser";
type CropRemoval = { motifId: string; x: number; y: number; width: number; height: number; patch: HTMLCanvasElement; lasso: CropPoint[] | null; pixels?: Int32Array };
type EraserStroke = { points: CropPoint[]; size: number };
type CropViewport = { zoom: number; panX: number; panY: number };
type EditorTouchGesture = { startDistance: number; startZoom: number; anchorX: number; anchorY: number };
type CropTouchGesture =
  | { kind: "pan"; pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number }
  | { kind: "pinch"; startDistance: number; startZoom: number; startCenterX: number; startCenterY: number; startPanX: number; startPanY: number }
  | null;
type EditorSnapshot = { motifs: Motif[]; selectedId: string | null; background: string; guide: GuideLayer | null; workflow: Workflow; finishedPattern: FinishedPattern | null; sourceDpi: number; motifCanvas: MotifCanvas };
type RecoverySnapshot = EditorSnapshot & { version: 1; patternName: string; measurementUnit: MeasurementUnit; exportFormat: ExportFormat; exportBackground: ExportBackground; savedAt: number };
type Interaction =
  | { kind: "move"; id: string; dx: number; dy: number; copyX: number; copyY: number; startClientX: number; startClientY: number; centerX: number; centerY: number; originX: number; originY: number; pointerType: string; activated: boolean; historyRecorded: boolean; startSnapshot: EditorSnapshot }
  | { kind: "resize"; id: string; startDistance: number; startScale: number; copyX: number; copyY: number }
  | { kind: "rotate"; id: string; angleOffset: number; copyX: number; copyY: number }
  | null;
type SelectedCopy = { id: string; offsetX: number; offsetY: number };
type EditorPointerGesture = {
  pointerId: number;
  pointerType: string;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  startedAt: number;
  startPoint: CropPoint;
  hit: { motif: Motif; offsetX: number; offsetY: number; centerX: number; centerY: number } | null;
  mode: "pending" | "drag" | "ignored";
};
const wrap = (v: number, length = TILE) => ((v % length) + length) % length;
const motifOpacity = (motif: Pick<Motif, "opacity">) => Math.max(0, Math.min(100, motif.opacity ?? 100));
const normalizeAngle = (degrees: number) => ((degrees + 540) % 360) - 180;
const clampColorChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const adjustBackgroundColor = (hex: string, brighter: number, muted: number, temperature: number) => {
  const normalized = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const muteAmount = Math.max(0, Math.min(100, muted)) / 100;
  const brightnessAmount = Math.max(-100, Math.min(100, brighter)) / 100;
  const luminance = red * .2126 + green * .7152 + blue * .0722;
  const mutedRed = red + (luminance - red) * muteAmount;
  const mutedGreen = green + (luminance - green) * muteAmount;
  const mutedBlue = blue + (luminance - blue) * muteAmount;
  const brightenedChannels = [mutedRed, mutedGreen, mutedBlue].map((channel) => brightnessAmount >= 0
    ? channel + (255 - channel) * brightnessAmount
    : channel * (1 + brightnessAmount));
  const temperatureShift = Math.max(-100, Math.min(100, temperature)) / 100 * 14;
  const channels = [
    brightenedChannels[0] + temperatureShift,
    brightenedChannels[1],
    brightenedChannels[2] - temperatureShift,
  ].map(clampColorChannel);
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};
const normalizeHexColor = (value: string) => {
  const compact = value.trim().replace(/\s+/g, "");
  const digits = compact.startsWith("#") ? compact.slice(1) : compact;
  return /^[\da-f]{6}$/i.test(digits) ? `#${digits.toLowerCase()}` : null;
};
const createId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `motif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};
function withoutOriginalFile<T extends { originalFile?: File }>(value: T): Omit<T, "originalFile"> {
  const copy = { ...value };
  delete copy.originalFile;
  return copy;
}
const DEFAULT_GUIDE: GuideLayer = { id: "vintage-transport", src: TRANSPORT_GUIDE, name: "Vintage Transport", kind: "library", x: 500, y: 500, width: 1000, height: 1000, scale: 1, opacity: 18, visible: true };

type PencilButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onPointerDown" | "onPointerUp"> & {
  onActivate: () => void;
};

function pencilActivationProps(onActivate: () => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "pen") return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "pen") return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.dataset.pencilActivatedAt = String(performance.now());
      onActivate();
    },
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
      const pencilActivatedAt = Number(event.currentTarget.dataset.pencilActivatedAt || 0);
      delete event.currentTarget.dataset.pencilActivatedAt;
      if (performance.now() - pencilActivatedAt < 600) {
        event.preventDefault();
        return;
      }
      onActivate();
    },
  };
}

function PencilButton({ onActivate, ...props }: PencilButtonProps) {
  return <button {...props} {...pencilActivationProps(onActivate)} />;
}

type PencilDialogActionProps = Omit<ComponentProps<typeof AlertDialogAction>, "onClick" | "onPointerDown" | "onPointerUp"> & {
  onActivate: () => void;
};

function PencilDialogAction({ onActivate, ...props }: PencilDialogActionProps) {
  return <AlertDialogAction {...props} {...pencilActivationProps(onActivate)} />;
}

function PencilDialogCancel({ onActivate, ...props }: PencilDialogActionProps) {
  return <AlertDialogCancel {...props} {...pencilActivationProps(onActivate)} />;
}

function srgbContext(canvas: HTMLCanvasElement, willReadFrequently = false) {
  const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently });
  if (!context) throw new Error("Canvas rendering is not available");
  return context;
}

function motifWorkingSize(sourceWidth: number, sourceHeight: number, canvas: MotifCanvas) {
  return nativeMotifWorkingSize(sourceWidth, sourceHeight, canvas.width, TILE);
}

function removeCropArea(context: CanvasRenderingContext2D, removal: Pick<CropRemoval, "x" | "y" | "width" | "height" | "lasso" | "pixels">) {
  if (removal.pixels) {
    const frame = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    for (const index of removal.pixels) frame.data[index * 4 + 3] = 0;
    context.putImageData(frame, 0, 0);
    return;
  }
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  if (removal.lasso && removal.lasso.length > 2) {
    context.beginPath();
    context.moveTo(removal.lasso[0].x, removal.lasso[0].y);
    for (const point of removal.lasso.slice(1)) context.lineTo(point.x, point.y);
    context.closePath();
    context.fill();
  } else {
    context.fillRect(removal.x, removal.y, removal.width, removal.height);
  }
  context.restore();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function pngDpi(file: File) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 33 || String.fromCharCode(...bytes.slice(1, 4)) !== "PNG") return DEFAULT_DPI;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (type === "pHYs" && length >= 9 && bytes[offset + 16] === 1) {
        const xDpi = view.getUint32(offset + 8) * .0254;
        const yDpi = view.getUint32(offset + 12) * .0254;
        const dpi = Math.round((xDpi + yDpi) / 2);
        return dpi >= 36 && dpi <= 2400 ? dpi : DEFAULT_DPI;
      }
      offset += 12 + length;
    }
  } catch {
    // A missing or unreadable PNG resolution tag safely falls back to 300 DPI.
  }
  return DEFAULT_DPI;
}

function trimTransparentCanvasWithBounds(source: HTMLCanvasElement) {
  const context = srgbContext(source, true);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (pixels[(y * source.width + x) * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { canvas: source, x: 0, y: 0, empty: true };
  const padding = 2;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(source.width - 1, maxX + padding);
  maxY = Math.min(source.height - 1, maxY + padding);
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) return { canvas: source, x: 0, y: 0 };
  const trimmed = document.createElement("canvas");
  trimmed.width = maxX - minX + 1;
  trimmed.height = maxY - minY + 1;
  srgbContext(trimmed).drawImage(source, minX, minY, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  return { canvas: trimmed, x: minX, y: minY };
}

function trimTransparentCanvas(source: HTMLCanvasElement) {
  return trimTransparentCanvasWithBounds(source).canvas;
}

async function trimTransparentImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  srgbContext(canvas).drawImage(image, 0, 0);
  const trimmed = trimTransparentCanvas(canvas);
  return { src: trimmed.toDataURL("image/png"), width: trimmed.width, height: trimmed.height };
}

async function makePreviewCopy(src: string, mime: string, maxSize = 1600) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const largest = Math.max(image.naturalWidth, image.naturalHeight);
  if (largest <= maxSize) return src;
  const scale = maxSize / largest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  srgbContext(canvas).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mime === "image/jpeg" ? "image/jpeg" : "image/png", .92);
}

function selectionGeometry(motif: Motif, tileHeight = TILE, offsetX = 0, offsetY = 0) {
  const center = { x: wrap(motif.x) + offsetX * TILE, y: wrap(motif.y, tileHeight) + offsetY * tileHeight };
  const halfWidth = motif.width * motif.scale / 2 + 10;
  const halfHeight = motif.height * motif.scale / 2 + 10;
  const radians = motif.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const point = (x: number, y: number) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  });
  return {
    center,
    corners: [
      point(-halfWidth, -halfHeight),
      point(halfWidth, -halfHeight),
      point(halfWidth, halfHeight),
      point(-halfWidth, halfHeight),
    ],
    rotation: point(0, -halfHeight - 50),
  };
}

async function removeEdgeBackground(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = srgbContext(canvas, true);
  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  const width = canvas.width;
  const height = canvas.height;
  const count = width * height;

  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  let red = 0, green = 0, blue = 0, opaqueCorners = 0;
  for (const [x, y] of corners) {
    const at = (y * width + x) * 4;
    if (pixels[at + 3] > 20) {
      red += pixels[at];
      green += pixels[at + 1];
      blue += pixels[at + 2];
      opaqueCorners++;
    }
  }
  if (!opaqueCorners) return src;
  red /= opaqueCorners;
  green /= opaqueCorners;
  blue /= opaqueCorners;
  const luminance = red * .2126 + green * .7152 + blue * .0722;
  if (luminance < 190) return src;

  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  const distance = (index: number) => {
    const at = index * 4;
    return Math.sqrt((pixels[at] - red) ** 2 + (pixels[at + 1] - green) ** 2 + (pixels[at + 2] - blue) ** 2);
  };
  const canRemove = (index: number) => pixels[index * 4 + 3] < 20 || distance(index) <= 72;
  const enqueue = (index: number) => {
    if (visited[index] || !canRemove(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let index = 0; index < count; index++) {
    const at = index * 4;
    if (visited[index]) {
      const d = distance(index);
      const feather = Math.max(0, Math.min(1, (d - 18) / 54));
      pixels[at + 3] = Math.round(pixels[at + 3] * feather);
    }
    if (pixels[at + 3] > 8) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  ctx.putImageData(frame, 0, 0);
  if (maxX < minX || maxY < minY) return src;
  const padding = Math.max(2, Math.round(Math.max(width, height) * .006));
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const cropped = document.createElement("canvas");
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  srgbContext(cropped).drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped.toDataURL("image/png");
}

function demoSource(colors: string[], turn: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  const ctx = srgbContext(canvas);
  ctx.translate(240, 240);
  ctx.rotate(turn * 0.27);
  colors.forEach((color, index) => {
    ctx.save();
    ctx.rotate((Math.PI * 2 * index) / colors.length);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, -106, 47 + turn * 3, 92, 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.fillStyle = colors[colors.length - 1];
  ctx.beginPath();
  ctx.arc(0, 0, 42, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

function seedMotifs(): Motif[] {
  const canvas = { width: EXPORT_SIZE, height: EXPORT_SIZE, dpi: DEFAULT_DPI };
  const demoMotifs = [
    ["Lollipop", "lollipop", 188, 329, 360, 360, 0.85, -18],
    ["Little ghost", "ghost", 419, 526, 500, 450, 0.95, 13],
    ["Boo lettering", "boo-lettering", 386, 280, 450, 240, 1.05, -17],
    ["Black cat", "black-cat", 407, 280, 585, 370, 1.1, 14],
    ["Pumpkins", "pumpkins", 316, 508, 460, 485, 1.05, -9],
    ["Zombie hand", "zombie-hand", 335, 433, 510, 525, 1.1, 24],
    ["Bat moon", "bat-moon", 514, 468, 405, 565, 1.05, 9],
    ["Spiders", "spiders", 344, 445, 400, 650, 0.9, -7],
    ["Haunted house", "haunted-house", 524, 551, 335, 450, 1.1, 8],
    ["Treat bag", "treat-bag", 321, 488, 610, 660, 1.1, -18],
    ["Happy Halloween", "happy-halloween", 445, 261, 665, 540, 1.05, 18],
    ["Green candy", "green-candy", 317, 205, 490, 750, 1.1, -28],
    ["Cauldron", "cauldron", 412, 504, 610, 375, 1.1, -13],
  ] as const;
  return demoMotifs.map(([name, file, sourceWidth, sourceHeight, x, y, scale, rotation], index) => ({
    id: `halloween-demo-${index}`,
    name,
    src: `${import.meta.env.BASE_URL}demo/halloween/${file}.webp?v=20261016b`,
    sourceWidth,
    sourceHeight,
    sourceDpi: DEFAULT_DPI,
    x,
    y,
    ...motifWorkingSize(sourceWidth, sourceHeight, canvas),
    scale,
    maxScale: MAX_PRINT_SAFE_SCALE,
    rotation,
    flipX: false,
    opacity: 100,
    lineColor: null,
  }));
}

function drawDemoWatermark(context: CanvasRenderingContext2D, width: number, height: number) {
  const size = Math.max(44, Math.round(Math.min(width, height) / 26));
  const radius = Math.ceil(Math.hypot(width, height));
  const label = "EASY PATTERN STUDIO • DEMO";
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(-Math.PI / 7);
  context.font = `700 ${size}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = Math.max(2, size / 22);
  context.strokeStyle = "rgba(255,255,255,.22)";
  context.fillStyle = "rgba(66,49,43,.18)";
  const rowGap = size * 4.2;
  const columnGap = context.measureText(label).width + size * 3.5;
  for (let y = -radius; y <= radius; y += rowGap) {
    const offset = Math.round(y / rowGap) % 2 ? columnGap / 2 : 0;
    for (let x = -radius; x <= radius; x += columnGap) {
      context.strokeText(label, x + offset, y);
      context.fillText(label, x + offset, y);
    }
  }
  context.restore();
}

export default function Home() {
  const [accessReady] = useState(true);
  const isUnlocked = true;
  const [patternName, setPatternName] = useState("Halloween Demo Pattern");
  const [motifs, setMotifs] = useState<Motif[]>(seedMotifs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectMotifsMode, setSelectMotifsMode] = useState(false);
  const [selectedMotifIds, setSelectedMotifIds] = useState<string[]>([]);
  const [selectedCopy, setSelectedCopy] = useState<SelectedCopy | null>(null);
  const [background, setBackground] = useState("#ffffff");
  const [backgroundBase, setBackgroundBase] = useState("#ffffff");
  const [backgroundBrightness, setBackgroundBrightness] = useState(0);
  const [backgroundMuted, setBackgroundMuted] = useState(0);
  const [backgroundTemperature, setBackgroundTemperature] = useState(0);
  const [backgroundHexInput, setBackgroundHexInput] = useState("#FFFFFF");
  const [backgroundHexFocused, setBackgroundHexFocused] = useState(false);
  const [backgroundHexInvalid, setBackgroundHexInvalid] = useState(false);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [editorViewport, setEditorViewport] = useState<CropViewport>({ zoom: 1, panX: 0, panY: 0 });
  const [verticalEdgeGestureActive, setVerticalEdgeGestureActive] = useState(false);
  // Keep the active gesture outside React's render cycle as well. A Pencil can
  // finish before the state update that began the gesture has rendered.
  const interactionRef = useRef<Interaction>(null);
  const editorPointerGestureRef = useRef<EditorPointerGesture | null>(null);
  const editorViewportRef = useRef<CropViewport>({ zoom: 1, panX: 0, panY: 0 });
  const editorViewportElementRef = useRef<HTMLDivElement>(null);
  const editorPinchRef = useRef<EditorTouchGesture | null>(null);
  const editorTouchNavigationRef = useRef(false);
  const [status, setStatus] = useState("Ready");
  const [guide, setGuide] = useState<GuideLayer | null>(null);
  const [workflow, setWorkflow] = useState<Workflow>("motifs");
  const [finishedPattern, setFinishedPattern] = useState<FinishedPattern | null>(null);
  const [seamlessPngFile, setSeamlessPngFile] = useState<File | null>(null);
  const [motifCanvas, setMotifCanvas] = useState<MotifCanvas>({ width: EXPORT_SIZE, height: EXPORT_SIZE, dpi: DEFAULT_DPI });
  const [customCanvasInput, setCustomCanvasInput] = useState("");
  const [customCanvasInvalid, setCustomCanvasInvalid] = useState(false);
  const [sourceDpi, setSourceDpi] = useState(DEFAULT_DPI);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("cm");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportBackground, setExportBackground] = useState<ExportBackground>("transparent");
  const [lineColorScope, setLineColorScope] = useState<LineColorScope>("selected");
  const [multiplyCount, setMultiplyCount] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewControlsVisible, setPreviewControlsVisible] = useState(true);
  const [cropSheet, setCropSheet] = useState<CropSheet | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropTool, setCropTool] = useState<CropTool>("lasso");
  const [autoSeparating, setAutoSeparating] = useState(false);
  const [autoReviewIds, setAutoReviewIds] = useState<string[] | null>(null);
  const [autoReviewKeptIds, setAutoReviewKeptIds] = useState<string[]>([]);
  const [reviewMerging, setReviewMerging] = useState(false);
  const [editingMotifId, setEditingMotifId] = useState<string | null>(null);
  const [lassoPoints, setLassoPoints] = useState<CropPoint[]>([]);
  const [eraserSize, setEraserSize] = useState(8);
  const [eraserCursor, setEraserCursor] = useState<CropPoint | null>(null);
  const [cropRevision, setCropRevision] = useState(0);
  const [croppedCount, setCroppedCount] = useState(0);
  const [cropUndoCount, setCropUndoCount] = useState(0);
  const [eraseUndoCount, setEraseUndoCount] = useState(0);
  const [cropViewport, setCropViewport] = useState<CropViewport>({ zoom: 1, panX: 0, panY: 0 });
  const [cropAdding, setCropAdding] = useState(false);
  const [cropMessage, setCropMessage] = useState("Draw around one or more parts · pinch with two fingers to zoom");
  const [historyState, setHistoryState] = useState({ revision: 0, canUndo: false, canRedo: false });
  const [recoveryCandidate, setRecoveryCandidate] = useState<RecoverySnapshot | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [freshConfirmOpen, setFreshConfirmOpen] = useState(false);
  const editorRef = useRef<HTMLCanvasElement>(null);
  const edgeRepeatRef = useRef<HTMLCanvasElement>(null);
  const repeatRef = useRef<HTMLCanvasElement>(null);
  const largeRepeatRef = useRef<HTMLCanvasElement>(null);
  const repeatViewportRef = useRef<RepeatViewport>({ zoom: 1, panX: 0, panY: 0 });
  const repeatTileCacheRef = useRef<{ draw: typeof drawTile; canvas: HTMLCanvasElement } | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropEditCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropDisplayRef = useRef<{ canvasWidth: number; canvasHeight: number; imageWidth: number; imageHeight: number; display: { x: number; y: number; width: number; height: number; scale: number } } | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropLassoMovedRef = useRef(false);
  const cropActivePointerRef = useRef<{ id: number; type: string } | null>(null);
  const eraserLastRef = useRef<CropPoint | null>(null);
  const cropUndoStackRef = useRef<CropRemoval[]>([]);
  const eraserUndoStackRef = useRef<EraserStroke[]>([]);
  const activeEraserStrokeRef = useRef<EraserStroke | null>(null);
  const cropDirtyRef = useRef(false);
  const cropViewportRef = useRef<CropViewport>({ zoom: 1, panX: 0, panY: 0 });
  const cropTouchPointsRef = useRef(new Map<number, CropPoint>());
  const cropTouchGestureRef = useRef<CropTouchGesture>(null);
  const cropTouchNavigationRef = useRef(false);
  const backgroundHexInputRef = useRef<HTMLInputElement>(null);
  const backgroundHexEditRememberedRef = useRef(false);
  const cache = useRef(new Map<string, HTMLImageElement>());
  const lineColorCache = useRef(new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>());
  const motifRasterCache = useRef(new MotifRasterCache<HTMLCanvasElement>(48, (canvas) => {
    canvas.width = 1;
    canvas.height = 1;
  }));
  const editorFrameRef = useRef<number | null>(null);
  const pendingEditorPointRef = useRef<CropPoint | null>(null);
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const recoverySaveTimerRef = useRef<number | null>(null);
  const imageLoadFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // iOS Safari can preserve a page-level pinch scale even after the canvas
    // gesture has ended. Reset and lock only phone-sized touch devices; iPads
    // and computers keep their existing viewport and zoom behavior.
    const isPhone = navigator.maxTouchPoints > 0
      && Math.min(window.screen.width, window.screen.height) <= 740;
    if (!isPhone) return;

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const previousViewport = viewport.content;
    viewport.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";

    const preventPageGesture = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener("gesturestart", preventPageGesture, { passive: false });
    document.addEventListener("gesturechange", preventPageGesture, { passive: false });
    document.addEventListener("gestureend", preventPageGesture, { passive: false });

    return () => {
      viewport.content = previousViewport;
      document.removeEventListener("gesturestart", preventPageGesture);
      document.removeEventListener("gesturechange", preventPageGesture);
      document.removeEventListener("gestureend", preventPageGesture);
    };
  }, []);

  useEffect(() => {
    if (!backgroundHexFocused) return;
    const keepFieldVisible = () => {
      backgroundHexInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    };
    const firstScroll = window.setTimeout(keepFieldVisible, 100);
    const keyboardScroll = window.setTimeout(keepFieldVisible, 420);
    window.visualViewport?.addEventListener("resize", keepFieldVisible);
    return () => {
      window.clearTimeout(firstScroll);
      window.clearTimeout(keyboardScroll);
      window.visualViewport?.removeEventListener("resize", keepFieldVisible);
    };
  }, [backgroundHexFocused]);

  const refreshHistoryState = useCallback(() => {
    setHistoryState((current) => ({
      revision: current.revision + 1,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    }));
  }, []);

  const canvasWidthPx = workflow === "finished" && finishedPattern ? finishedPattern.width : motifCanvas.width;
  const canvasHeightPx = workflow === "finished" && finishedPattern ? finishedPattern.height : motifCanvas.height;
  const activeDpi = workflow === "finished" ? sourceDpi : motifCanvas.dpi;
  const editorHeight = Math.max(1, Math.round(TILE * canvasHeightPx / canvasWidthPx));
  const edgePreviewPaddingX = 500 / canvasWidthPx * TILE;
  const edgePreviewPaddingY = 750 / canvasHeightPx * editorHeight;
  const edgePreviewWidth = TILE + edgePreviewPaddingX * 2;
  const edgePreviewHeight = editorHeight + edgePreviewPaddingY * 2;

  const currentSnapshot = useCallback((): EditorSnapshot => ({
    motifs: motifs.map((motif) => ({ ...motif })),
    selectedId,
    background,
    guide: guide ? { ...guide } : null,
    workflow,
    finishedPattern,
    sourceDpi,
    motifCanvas: { ...motifCanvas },
  }), [background, finishedPattern, guide, motifCanvas, motifs, selectedId, sourceDpi, workflow]);

  const restoreSnapshot = useCallback((snapshot: EditorSnapshot) => {
    setSelectMotifsMode(false);
    setSelectedMotifIds([]);
    setMotifs(snapshot.motifs.map((motif) => {
      const nativeSize = motif.sourceWidth && motif.sourceHeight
        ? motifWorkingSize(motif.sourceWidth, motif.sourceHeight, snapshot.motifCanvas)
        : {};
      return {
        ...motif,
        ...nativeSize,
        scale: motif.sourceWidth && motif.sourceHeight ? Math.min(1, motif.scale) : motif.scale,
        maxScale: motif.sourceWidth && motif.sourceHeight ? 1 : motif.maxScale,
        opacity: motifOpacity(motif),
      };
    }));
    setSelectedId(snapshot.selectedId);
    setSelectedCopy(null);
    setBackground(snapshot.background);
    setBackgroundBase(snapshot.background);
    setBackgroundBrightness(0);
    setBackgroundMuted(0);
    setBackgroundTemperature(0);
    setGuide(snapshot.guide ? { ...snapshot.guide } : null);
    setWorkflow(snapshot.workflow);
    setFinishedPattern(snapshot.finishedPattern);
    setSourceDpi(snapshot.sourceDpi);
    setMotifCanvas({ ...snapshot.motifCanvas });
    setCustomCanvasInput(isCanvasPreset(snapshot.motifCanvas.width) ? "" : String(snapshot.motifCanvas.width));
    setCustomCanvasInvalid(false);
    interactionRef.current = null;
    setInteraction(null);
  }, []);

  const hasRecoverableArtwork = motifs.length > 0 || Boolean(guide) || Boolean(finishedPattern);

  const makeRecoverySnapshot = useCallback((): RecoverySnapshot => ({
    ...currentSnapshot(),
    motifs: motifs.map(withoutOriginalFile),
    finishedPattern: finishedPattern ? withoutOriginalFile(finishedPattern) : null,
    version: 1,
    patternName,
    measurementUnit,
    exportFormat,
    exportBackground,
    savedAt: Date.now(),
  }), [currentSnapshot, exportBackground, exportFormat, finishedPattern, measurementUnit, motifs, patternName]);

  useEffect(() => {
    let cancelled = false;
    readLastPattern<RecoverySnapshot>().then((saved) => {
      if (cancelled) return;
      const valid = saved?.version === 1 && (saved.motifs?.length > 0 || Boolean(saved.guide) || Boolean(saved.finishedPattern));
      if (valid) {
        setRecoveryCandidate(saved);
        return;
      }
      setRecoveryReady(true);
    }).catch(() => {
      if (!cancelled) setRecoveryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!recoveryReady) return;
    if (recoverySaveTimerRef.current !== null) window.clearTimeout(recoverySaveTimerRef.current);
    if (!hasRecoverableArtwork) {
      void clearLastPattern().then(() => setRecoveryStatus("")).catch(() => undefined);
      return;
    }
    recoverySaveTimerRef.current = window.setTimeout(() => {
      saveLastPattern(makeRecoverySnapshot()).then(() => {
        setRecoveryStatus("Saved on this device");
      }).catch(() => {
        setRecoveryStatus("Device saving unavailable");
      });
      recoverySaveTimerRef.current = null;
    }, 1500);
    return () => {
      if (recoverySaveTimerRef.current !== null) window.clearTimeout(recoverySaveTimerRef.current);
    };
  }, [hasRecoverableArtwork, makeRecoverySnapshot, recoveryReady]);

  useEffect(() => {
    if (!recoveryReady || !hasRecoverableArtwork) return;
    const saveNow = () => void saveLastPattern(makeRecoverySnapshot()).catch(() => undefined);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [hasRecoverableArtwork, makeRecoverySnapshot, recoveryReady]);

  const rememberSnapshot = useCallback((snapshot: EditorSnapshot) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    refreshHistoryState();
  }, [refreshHistoryState]);

  const rememberChange = useCallback(() => {
    rememberSnapshot(currentSnapshot());
  }, [currentSnapshot, rememberSnapshot]);

  const undo = () => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(currentSnapshot());
    restoreSnapshot(snapshot);
    refreshHistoryState();
    setStatus("Undone");
  };

  const redo = () => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push(currentSnapshot());
    restoreSnapshot(snapshot);
    refreshHistoryState();
    setStatus("Redone");
  };

  const loadImage = useCallback((src: string) => {
    let image = cache.current.get(src);
    if (!image) {
      image = new Image();
      image.onload = () => {
        // A recovered sheet can contain many images. Draw once per frame as
        // they decode instead of redrawing every canvas for each image.
        if (imageLoadFrameRef.current !== null) return;
        imageLoadFrameRef.current = requestAnimationFrame(() => {
          imageLoadFrameRef.current = null;
          setMotifs((current) => [...current]);
        });
      };
      cache.current.set(src, image);
      image.src = src;
    }
    return image;
  }, []);

  const colorizedImage = useCallback((image: HTMLImageElement, color: string | null) => {
    if (!color || !image.complete || !image.naturalWidth) return image;
    let colors = lineColorCache.current.get(image);
    if (!colors) {
      colors = new Map();
      lineColorCache.current.set(image, colors);
    }
    const cached = colors.get(color);
    if (cached) return cached;
    if (colors.size > 20) colors.clear();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = srgbContext(canvas);
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    colors.set(color, canvas);
    return canvas;
  }, []);

  const rasterizeMotif = useCallback((motif: Motif, artwork: CanvasImageSource, targetWidth: number, targetHeight: number) => {
    const width = Math.max(1, Math.round(targetWidth));
    const height = Math.max(1, Math.round(targetHeight));
    const rotation = normalizeAngle(motif.rotation);
    const radians = rotation * Math.PI / 180;
    // A fixed square surface avoids allocating a new GPU-backed canvas for
    // every tiny Pencil angle. It is large enough for every rotation.
    const rasterExtent = Math.max(1, Math.ceil(Math.hypot(width, height)) + 2);
    const signature = [motif.lineColor || "original", motif.scale.toFixed(4), rotation.toFixed(2), motif.flipX ? 1 : 0].join("|");
    const variant = width + "x" + height;
    const cached = motifRasterCache.current.get(motif.id, signature, variant);
    if (cached) return cached;

    const raster = motifRasterCache.current.reusable(motif.id, variant) || document.createElement("canvas");
    if (raster.width !== rasterExtent || raster.height !== rasterExtent) {
      raster.width = rasterExtent;
      raster.height = rasterExtent;
    }
    const context = srgbContext(raster);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, raster.width, raster.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.translate(raster.width / 2, raster.height / 2);
    context.rotate(radians);
    context.scale(motif.flipX ? -1 : 1, 1);
    context.drawImage(artwork, -width / 2, -height / 2, width, height);
    motifRasterCache.current.set(motif.id, signature, variant, raster);
    return raster;
  }, []);

  const drawTile = useCallback((ctx: CanvasRenderingContext2D, size: number, ox = 0, oy = 0, selection = false, showGuide = false, includeBackground = true, tileHeight = size) => {
    const ratio = size / TILE;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(ox, oy);
    ctx.clearRect(0, 0, size, tileHeight);
    if (workflow === "finished" && finishedPattern) {
      const image = loadImage(finishedPattern.previewSrc);
      if (image.complete && image.naturalWidth) ctx.drawImage(image, 0, 0, size, tileHeight);
      ctx.restore();
      return;
    }
    if (includeBackground) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, tileHeight);
    }
    ctx.beginPath();
    ctx.rect(0, 0, size, tileHeight);
    ctx.clip();
    if (showGuide && guide?.visible) {
      const guideImage = loadImage(guide.src);
      if (guideImage.complete && guideImage.naturalWidth) {
        const width = guide.width * guide.scale * ratio;
        const height = guide.height * guide.scale * ratio;
        ctx.save();
        ctx.globalAlpha = guide.opacity / 100;
        ctx.drawImage(guideImage, guide.x * ratio - width / 2, guide.y * ratio - height / 2, width, height);
        ctx.restore();
      }
    }
    const movingId = interaction?.kind === "move" ? interaction.id : null;
    for (const motif of motifs) {
      const image = loadImage(motif.src);
      if (!image.complete) continue;
      const artwork = colorizedImage(image, motif.lineColor);
      const isMoving = motif.id === movingId;
      const baseX = isMoving ? motif.x : wrap(motif.x);
      const baseY = isMoving ? motif.y : wrap(motif.y, editorHeight);
      for (let xo = -2; xo <= 2; xo++) for (let yo = -2; yo <= 2; yo++) {
        const { width, height } = roundedMotifSize(motif.width, motif.height, motif.scale, ratio);
        const centerX = (baseX + xo * TILE) * ratio;
        const centerY = (baseY + yo * editorHeight) * ratio;
        const unrotated = Math.abs(normalizeAngle(motif.rotation)) < .0001;
        ctx.save();
        ctx.globalAlpha = motifOpacity(motif) / 100;
        if (unrotated) {
          const placement = pixelAlignedTopLeft(centerX, centerY, width, height);
          if (motif.flipX) {
            ctx.translate(placement.x + width, placement.y);
            ctx.scale(-1, 1);
            ctx.drawImage(artwork, 0, 0, width, height);
          } else {
            // Draw the untouched source directly. At 100% export size this is
            // a one-source-pixel-to-one-output-pixel copy with no intermediate resampling.
            ctx.drawImage(artwork, placement.x, placement.y, width, height);
          }
        } else {
          const raster = rasterizeMotif(motif, artwork, width, height);
          const placement = pixelAlignedTopLeft(centerX, centerY, raster.width, raster.height);
          ctx.drawImage(raster, placement.x, placement.y);
        }
        ctx.restore();
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((motif.rotation * Math.PI) / 180);
        const selectedOffsetX = selectedCopy?.id === motif.id ? selectedCopy.offsetX : 0;
        const selectedOffsetY = selectedCopy?.id === motif.id ? selectedCopy.offsetY : 0;
        if (selection && (motif.id === selectedId || selectedMotifIds.includes(motif.id)) && xo === selectedOffsetX && yo === selectedOffsetY) {
          const padding = 10 * ratio;
          const halfWidth = width / 2 + padding;
          const halfHeight = height / 2 + padding;
          const rotationStem = 50 * ratio;
          const handleRadius = 13 * ratio;
          ctx.strokeStyle = "#243a3a";
          ctx.lineWidth = 2.5 * ratio;
          ctx.setLineDash([8 * ratio, 7 * ratio]);
          ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.moveTo(0, -halfHeight);
          ctx.lineTo(0, -halfHeight - rotationStem);
          ctx.stroke();

          const drawHandle = (x: number, y: number, rotation = false) => {
            ctx.beginPath();
            ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = rotation ? "#c96f55" : "#fffefa";
            ctx.fill();
            ctx.strokeStyle = "#243a3a";
            ctx.lineWidth = 2.5 * ratio;
            ctx.stroke();
            if (rotation) {
              ctx.beginPath();
              ctx.arc(x, y, handleRadius * .48, -.35 * Math.PI, 1.15 * Math.PI);
              ctx.strokeStyle = "#fffefa";
              ctx.lineWidth = 2.2 * ratio;
              ctx.stroke();
            }
          };

          if (!selectMotifsMode) {
            drawHandle(-halfWidth, -halfHeight);
            drawHandle(halfWidth, -halfHeight);
            drawHandle(halfWidth, halfHeight);
            drawHandle(-halfWidth, halfHeight);
            drawHandle(0, -halfHeight - rotationStem, true);
          }
        }
        ctx.restore();
      }
    }
    const movingMotif = movingId ? motifs.find((motif) => motif.id === movingId) : null;
    if (selection && movingMotif) {
      const snappedX = Math.abs(movingMotif.x - Math.round(movingMotif.x / TILE) * TILE) < .5;
      const snappedY = Math.abs(movingMotif.y - Math.round(movingMotif.y / editorHeight) * editorHeight) < .5;
      if (snappedX || snappedY) {
        ctx.save();
        ctx.strokeStyle = "#c96f55";
        ctx.lineWidth = Math.max(2, 3 * ratio);
        ctx.setLineDash([10 * ratio, 8 * ratio]);
        if (snappedX) {
          ctx.beginPath();
          ctx.moveTo(2 * ratio, 0);
          ctx.lineTo(2 * ratio, tileHeight);
          ctx.moveTo(size - 2 * ratio, 0);
          ctx.lineTo(size - 2 * ratio, tileHeight);
          ctx.stroke();
        }
        if (snappedY) {
          ctx.beginPath();
          ctx.moveTo(0, 2 * ratio);
          ctx.lineTo(size, 2 * ratio);
          ctx.moveTo(0, tileHeight - 2 * ratio);
          ctx.lineTo(size, tileHeight - 2 * ratio);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    const cornerMotif = selection ? motifs.find((motif) => motif.id === selectedId) : null;
    const cornerCentered = cornerMotif && (Math.min(wrap(cornerMotif.x), TILE - wrap(cornerMotif.x)) < .5) && (Math.min(wrap(cornerMotif.y, editorHeight), editorHeight - wrap(cornerMotif.y, editorHeight)) < .5);
    if (cornerCentered) {
      const guideLength = 62 * ratio;
      const inset = 2 * ratio;
      ctx.save();
      ctx.strokeStyle = "#c96f55";
      ctx.lineWidth = Math.max(2, 3 * ratio);
      ctx.setLineDash([8 * ratio, 6 * ratio]);
      const corners = [
        { x: inset, y: inset, dx: 1, dy: 1 },
        { x: size - inset, y: inset, dx: -1, dy: 1 },
        { x: inset, y: tileHeight - inset, dx: 1, dy: -1 },
        { x: size - inset, y: tileHeight - inset, dx: -1, dy: -1 },
      ];
      for (const corner of corners) {
        ctx.beginPath();
        ctx.moveTo(corner.x + corner.dx * guideLength, corner.y);
        ctx.lineTo(corner.x, corner.y);
        ctx.lineTo(corner.x, corner.y + corner.dy * guideLength);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, 13 * ratio, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }, [background, colorizedImage, editorHeight, finishedPattern, guide, interaction, loadImage, motifs, rasterizeMotif, selectMotifsMode, selectedCopy, selectedId, selectedMotifIds, workflow]);

  const drawEditorCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    // Bounds include the CSS zoom. Re-render from source at that displayed
    // resolution instead of stretching the previous preview bitmap.
    const { width, height } = editorPreviewSize(bounds.width, bounds.height, window.devicePixelRatio || 1);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = srgbContext(canvas);
    context.clearRect(0, 0, width, height);
    drawTile(context, width, 0, 0, true, true, true, height);
  }, [drawTile]);

  const drawRepeatGrid = useCallback((canvas: HTMLCanvasElement, viewport: RepeatViewport = { zoom: 1, panX: 0, panY: 0 }, fillView = false) => {
    const context = srgbContext(canvas);
    const aspect = editorHeight / TILE;
    const cellWidth = Math.min(canvas.width / 2, canvas.height / (2 * aspect));
    const cellHeight = cellWidth * aspect;
    const gridWidth = cellWidth * 2;
    const gridHeight = cellHeight * 2;
    const startX = (canvas.width - gridWidth) / 2;
    const startY = (canvas.height - gridHeight) / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const bounds = canvas.getBoundingClientRect();
    const density = canvas.width / Math.max(1, bounds.width);
    if (fillView) {
      // Render once at enough resolution for maximum phone zoom. Integer
      // source bounds and one repeated fill avoid per-tile clipping seams.
      const maxWidth = Math.min(4096, Math.sqrt(16_000_000 / aspect));
      const sourceWidth = Math.max(1, Math.floor(Math.min(maxWidth, Math.max(2000, cellWidth * 6))));
      const sourceHeight = Math.max(1, Math.round(sourceWidth * aspect));
      let cached = repeatTileCacheRef.current;
      if (!cached || cached.draw !== drawTile || cached.canvas.width !== sourceWidth || cached.canvas.height !== sourceHeight) {
        const tile = document.createElement("canvas");
        tile.width = sourceWidth;
        tile.height = sourceHeight;
        drawTile(srgbContext(tile), sourceWidth, 0, 0, false, false, true, sourceHeight);
        cached = { draw: drawTile, canvas: tile };
        repeatTileCacheRef.current = cached;
      }
      const originX = canvas.width / 2 + viewport.panX * density + (startX - canvas.width / 2) * viewport.zoom;
      const originY = canvas.height / 2 + viewport.panY * density + (startY - canvas.height / 2) * viewport.zoom;
      fillRepeatPattern(context, cached.canvas, canvas.width, canvas.height, cellWidth * viewport.zoom, cellHeight * viewport.zoom, originX, originY);
      return;
    }
    const tiles = { firstColumn: 0, endColumn: 2, firstRow: 0, endRow: 2 };
    context.save();
    context.translate(canvas.width / 2 + viewport.panX * density, canvas.height / 2 + viewport.panY * density);
    context.scale(viewport.zoom, viewport.zoom);
    context.translate(-canvas.width / 2, -canvas.height / 2);
    for (let row = tiles.firstRow; row < tiles.endRow; row++) {
      for (let col = tiles.firstColumn; col < tiles.endColumn; col++) drawTile(context, cellWidth, startX + col * cellWidth, startY + row * cellHeight, false, false, true, cellHeight);
    }
    context.restore();
  }, [background, drawTile, editorHeight]);

  const drawExpandedEdgePreview = useCallback((canvas: HTMLCanvasElement) => {
    const width = Math.max(1, Math.round(edgePreviewWidth));
    const height = Math.max(1, Math.round(edgePreviewHeight));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = srgbContext(canvas);
    context.clearRect(0, 0, width, height);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        drawTile(
          context,
          TILE,
          edgePreviewPaddingX + col * TILE,
          edgePreviewPaddingY + row * editorHeight,
          false,
          false,
          true,
          editorHeight,
        );
      }
    }
  }, [background, drawTile, edgePreviewHeight, edgePreviewPaddingX, edgePreviewPaddingY, edgePreviewWidth, editorHeight]);

  const drawFullscreenRepeat = useCallback((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * density));
    const height = Math.max(1, Math.round(bounds.height * density));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    repeatViewportRef.current = clampRepeatViewport(repeatViewportRef.current, bounds.width, bounds.height, editorHeight / TILE);
    drawRepeatGrid(canvas, repeatViewportRef.current, true);
  }, [drawRepeatGrid, editorHeight]);

  const changeRepeatZoom = (factor: number) => {
    const canvas = largeRepeatRef.current;
    if (!canvas) return;
    repeatViewportRef.current = factor === 0 ? { zoom: 1, panX: 0, panY: 0 } : zoomRepeatAt(repeatViewportRef.current, repeatViewportRef.current.zoom * factor, { x: 0, y: 0 });
    drawFullscreenRepeat(canvas);
  };

  const connectFullscreenCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    largeRepeatRef.current = canvas;
    if (canvas) requestAnimationFrame(() => drawFullscreenRepeat(canvas));
  }, [drawFullscreenRepeat]);

  useEffect(() => {
    // CSS transforms do not trigger ResizeObserver. Wait for the zoomed
    // layout to commit, then redraw once; pan alone needs no new pixels.
    const frame = requestAnimationFrame(() => {
      if (editorRef.current) drawEditorCanvas(editorRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [editorViewport.zoom, drawEditorCanvas]);

  useEffect(() => {
    const editor = editorRef.current;
    const edgeRepeat = edgeRepeatRef.current;
    const repeat = repeatRef.current;
    if (!editor || !repeat) return;
    drawEditorCanvas(editor);
    if (edgeRepeat) drawExpandedEdgePreview(edgeRepeat);
    drawRepeatGrid(repeat);
    if (largeRepeatRef.current) drawFullscreenRepeat(largeRepeatRef.current);
  }, [drawEditorCanvas, drawExpandedEdgePreview, drawFullscreenRepeat, drawRepeatGrid, previewOpen]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const redraw = () => requestAnimationFrame(() => drawEditorCanvas(editor));
    const observer = new ResizeObserver(redraw);
    observer.observe(editor);
    window.addEventListener("orientationchange", redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", redraw);
    };
  }, [drawEditorCanvas]);

  useEffect(() => {
    let frame: number | null = null;
    const redrawAfterResume = () => {
      if (document.visibilityState !== "visible" || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (editorRef.current) drawEditorCanvas(editorRef.current);
        if (edgeRepeatRef.current) drawExpandedEdgePreview(edgeRepeatRef.current);
        if (repeatRef.current) drawRepeatGrid(repeatRef.current);
        if (largeRepeatRef.current) drawFullscreenRepeat(largeRepeatRef.current);
      });
    };
    window.addEventListener("pageshow", redrawAfterResume);
    document.addEventListener("visibilitychange", redrawAfterResume);
    return () => {
      window.removeEventListener("pageshow", redrawAfterResume);
      document.removeEventListener("visibilitychange", redrawAfterResume);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [drawEditorCanvas, drawExpandedEdgePreview, drawFullscreenRepeat, drawRepeatGrid]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const preventPageScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    editor.addEventListener("touchstart", preventPageScroll, { passive: false });
    editor.addEventListener("touchmove", preventPageScroll, { passive: false });
    return () => {
      editor.removeEventListener("touchstart", preventPageScroll);
      editor.removeEventListener("touchmove", preventPageScroll);
    };
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    const canvas = largeRepeatRef.current;
    if (!canvas) return;
    const redraw = () => drawFullscreenRepeat(canvas);
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    const frame = requestAnimationFrame(redraw);
    window.addEventListener("orientationchange", redraw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("orientationchange", redraw);
    };
  }, [drawFullscreenRepeat, previewOpen]);

  useEffect(() => {
    const canvas = largeRepeatRef.current;
    if (!previewOpen || !canvas) return;
    const points = new Map<number, { x: number; y: number }>();
    let navigationStarted = false;
    let tapStart: { x: number; y: number } | null = null;
    let gesture: { viewport: RepeatViewport; center: { x: number; y: number }; distance: number } | null = null;
    let frame: number | null = null;
    const geometry = () => {
      const [a, b] = [...points.values()];
      if (!a) return null;
      return { center: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a, distance: b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 0 };
    };
    const begin = () => {
      const current = geometry();
      gesture = current ? { ...current, viewport: { ...repeatViewportRef.current } } : null;
    };
    const point = (event: globalThis.PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
    };
    const down = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      if (points.size === 0) { navigationStarted = false; tapStart = point(event); }
      points.set(event.pointerId, point(event));
      if (points.size > 1) { navigationStarted = true; setPreviewControlsVisible(false); }
      begin();
    };
    const move = (event: globalThis.PointerEvent) => {
      if (!points.has(event.pointerId) || !gesture) return;
      event.preventDefault();
      points.set(event.pointerId, point(event));
      const latest = point(event);
      if (!navigationStarted && tapStart && Math.hypot(latest.x - tapStart.x, latest.y - tapStart.y) > 5) {
        navigationStarted = true;
        setPreviewControlsVisible(false);
      }
      const current = geometry();
      if (!current) return;
      const zoom = gesture.distance && current.distance ? gesture.viewport.zoom * current.distance / gesture.distance : gesture.viewport.zoom;
      const bounds = canvas.getBoundingClientRect();
      repeatViewportRef.current = clampRepeatViewport(zoomRepeatAt(gesture.viewport, zoom, gesture.center, current.center), bounds.width, bounds.height, editorHeight / TILE);
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; drawFullscreenRepeat(canvas); });
    };
    const up = (event: globalThis.PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      points.delete(event.pointerId);
      if (points.size === 0 && !navigationStarted && event.type === "pointerup") setPreviewControlsVisible((visible) => !visible);
      if (event.type !== "pointerup") navigationStarted = true;
      begin();
    };
    const preventPageTouch = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up);
    canvas.addEventListener("touchmove", preventPageTouch, { passive: false });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      canvas.removeEventListener("touchmove", preventPageTouch);
    };
  }, [drawFullscreenRepeat, editorHeight, previewOpen]);

  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewOpen]);

  const cropDisplayBounds = useCallback((canvas: HTMLCanvasElement, image: HTMLImageElement) => {
    const bounds = canvas.getBoundingClientRect();
    const locked = cropDisplayRef.current;
    const applyViewport = (base: { x: number; y: number; width: number; height: number; scale: number }) => ({
      x: base.x + (base.width - base.width * cropViewport.zoom) / 2 + cropViewport.panX,
      y: base.y + (base.height - base.height * cropViewport.zoom) / 2 + cropViewport.panY,
      width: base.width * cropViewport.zoom,
      height: base.height * cropViewport.zoom,
      scale: base.scale * cropViewport.zoom,
    });
    if (locked && locked.imageWidth === image.naturalWidth && locked.imageHeight === image.naturalHeight) {
      const widthChange = Math.abs(bounds.width - locked.canvasWidth) / Math.max(1, locked.canvasWidth);
      const heightChange = Math.abs(bounds.height - locked.canvasHeight) / Math.max(1, locked.canvasHeight);
      if (widthChange < .25 && heightChange < .35) return applyViewport(locked.display);
    }
    const padding = Math.min(34, Math.max(12, bounds.width * .025));
    const scale = Math.min((bounds.width - padding * 2) / image.naturalWidth, (bounds.height - padding * 2) / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const display = { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height, scale };
    cropDisplayRef.current = { canvasWidth: bounds.width, canvasHeight: bounds.height, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, display };
    return applyViewport(display);
  }, [cropViewport]);

  const drawCropWorkspace = useCallback(() => {
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    const edited = cropEditCanvasRef.current;
    if (!canvas || !image?.naturalWidth) return;
    const client = canvas.getBoundingClientRect();
    if (!client.width || !client.height) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(client.width * density));
    const height = Math.max(1, Math.round(client.height * density));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = srgbContext(canvas);
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, client.width, client.height);
    const display = cropDisplayBounds(canvas, image);
    if (cropTool === "move") {
      context.globalAlpha = .28;
      context.drawImage(edited || image, display.x, display.y, display.width, display.height);
      context.globalAlpha = 1;
      return;
    }
    context.save();
    context.globalAlpha = .24;
    for (const removal of cropUndoStackRef.current) {
      context.drawImage(removal.patch, display.x + removal.x * display.scale, display.y + removal.y * display.scale,
        removal.width * display.scale, removal.height * display.scale);
    }
    context.restore();
    context.drawImage(edited || image, display.x, display.y, display.width, display.height);
    if (cropTool === "eraser" && eraserCursor) {
      const cursorX = display.x + eraserCursor.x * display.scale;
      const cursorY = display.y + eraserCursor.y * display.scale;
      context.beginPath();
      context.arc(cursorX, cursorY, Math.max(4, eraserSize * display.scale / 2), 0, Math.PI * 2);
      context.strokeStyle = "#243a3a";
      context.lineWidth = 1.5;
      context.stroke();
    }
    if (cropTool === "lasso" && !cropRect && lassoPoints.length > 1) {
      context.beginPath();
      context.moveTo(display.x + lassoPoints[0].x * display.scale, display.y + lassoPoints[0].y * display.scale);
      for (const point of lassoPoints.slice(1)) context.lineTo(display.x + point.x * display.scale, display.y + point.y * display.scale);
      context.strokeStyle = "#c96f55";
      context.lineWidth = 1.5;
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
      return;
    }
    if (!cropRect || cropRect.width < 1 || cropRect.height < 1 || cropTool === "eraser") return;
    const left = display.x + cropRect.x * display.scale;
    const top = display.y + cropRect.y * display.scale;
    const selectionWidth = cropRect.width * display.scale;
    const selectionHeight = cropRect.height * display.scale;
    context.fillStyle = "rgba(25, 39, 39, .5)";
    if (cropTool === "lasso" && lassoPoints.length > 2) {
      context.beginPath();
      context.rect(display.x, display.y, display.width, display.height);
      context.moveTo(display.x + lassoPoints[0].x * display.scale, display.y + lassoPoints[0].y * display.scale);
      for (const point of lassoPoints.slice(1)) context.lineTo(display.x + point.x * display.scale, display.y + point.y * display.scale);
      context.closePath();
      context.fill("evenodd");
    } else {
      context.fillRect(display.x, display.y, display.width, Math.max(0, top - display.y));
      context.fillRect(display.x, top + selectionHeight, display.width, Math.max(0, display.y + display.height - top - selectionHeight));
      context.fillRect(display.x, top, Math.max(0, left - display.x), selectionHeight);
      context.fillRect(left + selectionWidth, top, Math.max(0, display.x + display.width - left - selectionWidth), selectionHeight);
    }
    context.strokeStyle = "#c96f55";
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    if (cropTool === "lasso" && lassoPoints.length > 2) {
      context.beginPath();
      context.moveTo(display.x + lassoPoints[0].x * display.scale, display.y + lassoPoints[0].y * display.scale);
      for (const point of lassoPoints.slice(1)) context.lineTo(display.x + point.x * display.scale, display.y + point.y * display.scale);
      context.closePath();
      context.stroke();
    } else {
      context.strokeRect(left, top, selectionWidth, selectionHeight);
    }
    context.setLineDash([]);
    const label = Math.round(cropRect.width) + " × " + Math.round(cropRect.height) + " px";
    context.font = "700 13px Arial";
    const labelWidth = context.measureText(label).width + 18;
    const labelY = top > 38 ? top - 32 : top + 8;
    context.fillStyle = "#c96f55";
    context.fillRect(left, labelY, labelWidth, 26);
    context.fillStyle = "white";
    context.fillText(label, left + 9, labelY + 17);
  }, [cropDisplayBounds, cropRect, cropRevision, cropTool, eraserCursor, eraserSize, lassoPoints]);

  useEffect(() => {
    if (!cropSheet) return;
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const redraw = () => requestAnimationFrame(drawCropWorkspace);
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    redraw();
    return () => observer.disconnect();
  }, [cropSheet, drawCropWorkspace]);

  useEffect(() => {
    if (!cropSheet) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCropWorkspace();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  // Closing reads the latest crop count; the listener is refreshed with it.
  }, [cropSheet, croppedCount]);

  const cropSourcePoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const image = cropImageRef.current;
    if (!image) return null;
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    const display = cropDisplayBounds(event.currentTarget, image);
    const x = Math.max(0, Math.min(image.naturalWidth, (event.clientX - canvasBounds.left - display.x) / display.scale));
    const y = Math.max(0, Math.min(image.naturalHeight, (event.clientY - canvasBounds.top - display.y) / display.scale));
    return { x, y };
  };

  const boundsForPoints = (points: CropPoint[]): CropRect | null => {
    if (points.length < 3) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  };

  const eraseCropLine = (from: CropPoint, to: CropPoint, size = eraserSize) => {
    const edited = cropEditCanvasRef.current;
    if (!edited) return;
    const context = srgbContext(edited);
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.lineWidth = size;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (Math.hypot(to.x - from.x, to.y - from.y) < .1) {
      context.beginPath();
      context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();
  };

  const rebuildCropEdits = () => {
    const image = cropImageRef.current;
    const edited = cropEditCanvasRef.current;
    if (!image || !edited) return;
    const context = srgbContext(edited);
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, edited.width, edited.height);
    context.drawImage(image, 0, 0);
    for (const stroke of eraserUndoStackRef.current) {
      for (let index = 0; index < stroke.points.length; index += 1) {
        eraseCropLine(stroke.points[Math.max(0, index - 1)], stroke.points[index], stroke.size);
      }
    }
    for (const removal of cropUndoStackRef.current) removeCropArea(context, removal);
  };

  const updateCropViewport = (next: CropViewport) => {
    cropViewportRef.current = next;
    setCropViewport(next);
  };

  const clampCropPan = (zoom: number, panX: number, panY: number) => {
    const base = cropDisplayRef.current?.display;
    if (!base) return { panX, panY };
    const maxPanX = base.width * Math.max(0, zoom - 1) / 2;
    const maxPanY = base.height * Math.max(0, zoom - 1) / 2;
    return {
      panX: Math.max(-maxPanX, Math.min(maxPanX, panX)),
      panY: Math.max(-maxPanY, Math.min(maxPanY, panY)),
    };
  };

  const beginCropTouchGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    cropTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(cropTouchPointsRef.current.entries());
    if (points.length >= 2) {
      const first = points[0][1];
      const second = points[1][1];
      cropTouchGestureRef.current = {
        kind: "pinch",
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startZoom: cropViewportRef.current.zoom,
        startCenterX: (first.x + second.x) / 2,
        startCenterY: (first.y + second.y) / 2,
        startPanX: cropViewportRef.current.panX,
        startPanY: cropViewportRef.current.panY,
      };
      return;
    }
    cropTouchGestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: cropViewportRef.current.panX,
      startPanY: cropViewportRef.current.panY,
    };
  };

  const moveCropTouchGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!cropTouchPointsRef.current.has(event.pointerId)) return;
    cropTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(cropTouchPointsRef.current.values());
    const gesture = cropTouchGestureRef.current;
    if (points.length >= 2) {
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      if (!gesture || gesture.kind !== "pinch") {
        cropTouchGestureRef.current = {
          kind: "pinch",
          startDistance: distance,
          startZoom: cropViewportRef.current.zoom,
          startCenterX: centerX,
          startCenterY: centerY,
          startPanX: cropViewportRef.current.panX,
          startPanY: cropViewportRef.current.panY,
        };
        return;
      }
      const zoom = Math.max(1, Math.min(6, gesture.startZoom * distance / gesture.startDistance));
      const panX = gesture.startPanX + centerX - gesture.startCenterX;
      const panY = gesture.startPanY + centerY - gesture.startCenterY;
      const clamped = clampCropPan(zoom, panX, panY);
      updateCropViewport({ zoom, ...clamped });
      return;
    }
    if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId && cropViewportRef.current.zoom > 1) {
      const panX = gesture.startPanX + event.clientX - gesture.startX;
      const panY = gesture.startPanY + event.clientY - gesture.startY;
      const clamped = clampCropPan(cropViewportRef.current.zoom, panX, panY);
      updateCropViewport({ zoom: cropViewportRef.current.zoom, ...clamped });
    }
  };

  const finishCropTouchGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    cropTouchPointsRef.current.delete(event.pointerId);
    const remaining = Array.from(cropTouchPointsRef.current.entries());
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0];
      cropTouchGestureRef.current = {
        kind: "pan",
        pointerId,
        startX: point.x,
        startY: point.y,
        startPanX: cropViewportRef.current.panX,
        startPanY: cropViewportRef.current.panY,
      };
    } else if (!remaining.length) {
      cropTouchGestureRef.current = null;
    }
  };

  const chooseCropTool = (tool: CropTool) => {
    if (tool !== "move") updateEditorViewport({ zoom: 1, panX: 0, panY: 0 });
    setCropTool(tool);
    setCropRect(null);
    setLassoPoints([]);
    cropStartRef.current = null;
    cropLassoMovedRef.current = false;
    cropActivePointerRef.current = null;
    eraserLastRef.current = null;
    setCropMessage(cropToolInstruction(tool));
  };

  const resetCropEdits = () => {
    eraserUndoStackRef.current = [];
    activeEraserStrokeRef.current = null;
    setEraseUndoCount(0);
    rebuildCropEdits();
    setCropRevision((value) => value + 1);
    setCropMessage("Erasing reset — added motifs remain removed");
  };

  const undoLastErase = () => {
    const stroke = eraserUndoStackRef.current.pop();
    if (!stroke) return;
    activeEraserStrokeRef.current = null;
    eraserLastRef.current = null;
    rebuildCropEdits();
    setEraseUndoCount(eraserUndoStackRef.current.length);
    setCropRevision((value) => value + 1);
    setCropMessage("Last erasing stroke undone");
  };

  const discardActiveCropDrawing = () => {
    const hadUncommittedErase = Boolean(activeEraserStrokeRef.current);
    activeEraserStrokeRef.current = null;
    eraserLastRef.current = null;
    cropStartRef.current = null;
    cropLassoMovedRef.current = false;
    cropActivePointerRef.current = null;
    setCropRect(null);
    setLassoPoints([]);
    setEraserCursor(null);
    if (hadUncommittedErase) {
      rebuildCropEdits();
      setCropRevision((value) => value + 1);
    }
  };

  const cropPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    // Ignore a palm or stray touch while the Pencil is drawing a lasso.
    if (cropActivePointerRef.current && cropActivePointerRef.current.id !== event.pointerId && cropActivePointerRef.current.type === "pen") return;
    if (event.pointerType === "touch") {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      beginCropTouchGesture(event);
      if (cropTouchIntent(cropTool, cropTouchPointsRef.current.size, cropTouchNavigationRef.current) === "navigate") {
        cropTouchNavigationRef.current = true;
        discardActiveCropDrawing();
        setCropMessage("Pinch and move with two fingers · lift both fingers to draw again");
        return;
      }
    }
    const point = cropSourcePoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropActivePointerRef.current = { id: event.pointerId, type: event.pointerType };
    if (cropTool === "eraser") {
      setCropRect(null);
      setLassoPoints([]);
      eraserLastRef.current = point;
      activeEraserStrokeRef.current = { points: [point], size: eraserSize };
      setEraserCursor(point);
      eraseCropLine(point, point, eraserSize);
      setCropMessage("Erasing — use a smaller tip for delicate edges");
      return;
    }
    cropStartRef.current = point;
    if (cropTool === "lasso") {
      setCropRect(null);
      cropLassoMovedRef.current = false;
      setLassoPoints([point]);
      return;
    }
    setLassoPoints([]);
    setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
    setCropMessage("Release when the motif is inside the box");
  };

  const cropPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (cropActivePointerRef.current && cropActivePointerRef.current.id !== event.pointerId) return;
    if (event.pointerType === "touch" && cropTouchIntent(cropTool, cropTouchPointsRef.current.size, cropTouchNavigationRef.current) === "navigate") {
      event.preventDefault();
      moveCropTouchGesture(event);
      return;
    }
    const point = cropSourcePoint(event);
    if (!point) return;
    if (cropTool === "eraser") {
      setEraserCursor(point);
      const previous = eraserLastRef.current;
      if (previous) {
        event.preventDefault();
        eraseCropLine(previous, point, activeEraserStrokeRef.current?.size ?? eraserSize);
        activeEraserStrokeRef.current?.points.push(point);
        eraserLastRef.current = point;
      }
      return;
    }
    const start = cropStartRef.current;
    if (!start) return;
    event.preventDefault();
    if (cropTool === "lasso") {
      const display = cropDisplayBounds(event.currentTarget, cropImageRef.current!);
      const firstMove = !cropLassoMovedRef.current;
      cropLassoMovedRef.current = true;
      setLassoPoints((current) => {
        const previous = current[current.length - 1];
        if (!previous) return [point];
        const distance = Math.hypot(point.x - previous.x, point.y - previous.y) * display.scale;
        // Safari can report an offset contact sample before the first Pencil
        // movement. Skip that sample if it is too far from the stroke.
        if (firstMove && distance > 18) return [point];
        if (distance < 1) return current;
        return [...current, point];
      });
      return;
    }
    setCropRect({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const finishCropSelection = (event: PointerEvent<HTMLCanvasElement>) => {
    const trackedTouch = event.pointerType === "touch" && cropTouchPointsRef.current.has(event.pointerId);
    if (cropActivePointerRef.current && cropActivePointerRef.current.id !== event.pointerId) return;
    if (!cropActivePointerRef.current && !trackedTouch) return;
    const cancelled = event.type !== "pointerup";
    cropActivePointerRef.current = null;
    if (event.pointerType === "touch") {
      const wasNavigation = cropTouchNavigationRef.current;
      finishCropTouchGesture(event);
      if (!cropTouchPointsRef.current.size) cropTouchNavigationRef.current = false;
      if (wasNavigation) {
        if (!cropTouchPointsRef.current.size) {
          setCropMessage(cropToolInstruction(cropTool));
        }
        return;
      }
    }
    if (cancelled) {
      discardActiveCropDrawing();
      setCropMessage(cropToolInstruction(cropTool));
      return;
    }
    if (cropTool === "eraser") {
      if (activeEraserStrokeRef.current) {
        eraserUndoStackRef.current.push(activeEraserStrokeRef.current);
        cropDirtyRef.current = true;
        setEraseUndoCount(eraserUndoStackRef.current.length);
        activeEraserStrokeRef.current = null;
      }
      eraserLastRef.current = null;
      if (event.pointerType === "touch") setEraserCursor(null);
      setCropMessage("Clean-up applied — choose Lasso to crop");
      return;
    }
    const start = cropStartRef.current;
    const point = cropSourcePoint(event);
    cropStartRef.current = null;
    cropLassoMovedRef.current = false;
    if (cropTool === "lasso") {
      const points = point ? [...lassoPoints, point] : lassoPoints;
      const bounds = boundsForPoints(points);
      if (!bounds || bounds.width < 12 || bounds.height < 12) {
        setCropRect(null);
        setLassoPoints([]);
        setCropMessage("Selection cleared — draw again around the motif");
        return;
      }
      setLassoPoints(points);
      setCropRect(bounds);
      setCropMessage("Press Add motif, then select the next one");
      return;
    }
    if (!start || !point || Math.abs(point.x - start.x) < 12 || Math.abs(point.y - start.y) < 12) {
      setCropRect(null);
      setCropMessage("Selection cleared — drag again around the motif");
      return;
    }
    setCropRect({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
    setCropMessage("Press Add motif, then select the next one");
  };

  const restartCropSelection = () => {
    cropStartRef.current = null;
    cropActivePointerRef.current = null;
    setCropRect(null);
    setLassoPoints([]);
    setCropMessage("Drag again around the motif");
  };

  const eventPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * TILE, y: ((event.clientY - rect.top) / rect.height) * editorHeight };
  };

  const hitTest = (x: number, y: number, allowTinyTarget = false) => {
    const selectedMotif = motifs.find((motif) => motif.id === selectedId);
    const ordered = !allowTinyTarget && selectedMotif && Math.min(selectedMotif.width * selectedMotif.scale, selectedMotif.height * selectedMotif.scale) < 36
      ? [selectedMotif, ...motifs.slice().reverse().filter((motif) => motif.id !== selectedId)]
      : motifs.slice().reverse();
    for (const motif of ordered) {
      const copyX = nearestWrappedCopy(motif.x, x, TILE);
      const copyY = nearestWrappedCopy(motif.y, y, editorHeight);
      const dx = x - copyX.center;
      const dy = y - copyY.center;
      const angle = (-motif.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
      const extra = allowTinyTarget || motif.id === selectedId ? 18 : 0;
      if (Math.abs(lx) <= Math.max(motif.width * motif.scale / 2, extra) && Math.abs(ly) <= Math.max(motif.height * motif.scale / 2, extra)) {
        return { motif, offsetX: copyX.offset, offsetY: copyY.offset, centerX: copyX.center, centerY: copyY.center };
      }
    }
    return null;
  };

  const captureEditorPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The permanent window release listener still ends Pencil gestures when
      // Safari declines pointer capture at a canvas edge.
    }
  };

  const applyEditorPoint = useCallback((point: CropPoint) => {
    const activeInteraction = interactionRef.current;
    if (!activeInteraction) return;
    if (activeInteraction.kind === "move") {
      let x = point.x - activeInteraction.dx - activeInteraction.copyX * TILE;
      let y = point.y - activeInteraction.dy - activeInteraction.copyY * editorHeight;
      const snapDistance = 22;
      const nearestVerticalEdge = Math.round(x / TILE) * TILE;
      const nearestHorizontalEdge = Math.round(y / editorHeight) * editorHeight;
      if (Math.abs(x - nearestVerticalEdge) <= snapDistance) x = nearestVerticalEdge;
      if (Math.abs(y - nearestHorizontalEdge) <= snapDistance) y = nearestHorizontalEdge;
      const movingMotif = motifs.find((motif) => motif.id === activeInteraction.id);
      if (movingMotif) {
        const radians = movingMotif.rotation * Math.PI / 180;
        const halfWidth = movingMotif.width * movingMotif.scale / 2;
        const halfHeight = movingMotif.height * movingMotif.scale / 2;
        const extentY = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
        const wrappedY = wrap(y, editorHeight);
        if (wrappedY <= extentY || editorHeight - wrappedY <= extentY) setVerticalEdgeGestureActive(true);
      }
      const shiftX = Math.floor(x / TILE);
      const shiftY = Math.floor(y / editorHeight);
      setSelectedCopy({ id: activeInteraction.id, offsetX: activeInteraction.copyX + shiftX, offsetY: activeInteraction.copyY + shiftY });
      setMotifs((current) => current.map((motif) => motif.id === activeInteraction.id
        ? { ...motif, x: wrap(x), y: wrap(y, editorHeight) }
        : motif));
      return;
    }
    setMotifs((current) => current.map((motif) => {
      if (motif.id !== activeInteraction.id) return motif;
      const centerX = wrap(motif.x) + activeInteraction.copyX * TILE;
      const centerY = wrap(motif.y, editorHeight) + activeInteraction.copyY * editorHeight;
      if (activeInteraction.kind === "resize") {
        const distance = Math.hypot(point.x - centerX, point.y - centerY);
        return { ...motif, scale: Math.max(.2, Math.min(motif.maxScale ?? 2.5, activeInteraction.startScale * distance / activeInteraction.startDistance)) };
      }
      const pointerAngle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
      return { ...motif, rotation: normalizeAngle(pointerAngle + activeInteraction.angleOffset) };
    }));
  }, [editorHeight, motifs]);

  const endEditorInteraction = useCallback(() => {
    if (editorFrameRef.current !== null) {
      cancelAnimationFrame(editorFrameRef.current);
      editorFrameRef.current = null;
    }
    pendingEditorPointRef.current = null;
    const activeInteraction = interactionRef.current;
    interactionRef.current = null;
    if (activeInteraction?.kind === "move") {
      if (!activeInteraction.historyRecorded) {
        setMotifs((current) => current.map((motif) => motif.id === activeInteraction.id
          ? { ...motif, x: activeInteraction.originX, y: activeInteraction.originY }
          : motif));
        setSelectedCopy({ id: activeInteraction.id, offsetX: activeInteraction.copyX, offsetY: activeInteraction.copyY });
      } else {
        setMotifs((current) => current.map((motif) => motif.id === activeInteraction.id
          ? { ...motif, x: wrap(motif.x), y: wrap(motif.y, editorHeight) }
          : motif));
      }
    }
    setVerticalEdgeGestureActive(false);
    setInteraction(null);
  }, [editorHeight]);

  const updateEditorViewport = (next: CropViewport) => {
    editorViewportRef.current = next;
    setEditorViewport(next);
  };

  const clampEditorPan = (zoom: number, panX: number, panY: number, frame: HTMLElement) => {
    const maxX = frame.clientWidth * (zoom - 1) / 2;
    const maxY = frame.clientHeight * (zoom - 1) / 2;
    return { panX: Math.max(-maxX, Math.min(maxX, panX)), panY: Math.max(-maxY, Math.min(maxY, panY)) };
  };

  const startEditorPinch = (frame: HTMLDivElement, first: Touch, second: Touch) => {
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    const bounds = frame.getBoundingClientRect();
    const viewport = editorViewportRef.current;
    editorPinchRef.current = {
      startDistance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
      startZoom: viewport.zoom,
      anchorX: (centerX - bounds.left - bounds.width / 2 - viewport.panX) / viewport.zoom,
      anchorY: (centerY - bounds.top - bounds.height / 2 - viewport.panY) / viewport.zoom,
    };
    editorTouchNavigationRef.current = true;
    editorPointerGestureRef.current = null;
    endEditorInteraction();
  };

  useEffect(() => {
    const frame = editorViewportElementRef.current;
    if (!accessReady || !isUnlocked || !frame || workflow !== "motifs" || (cropSheet && cropTool !== "move")) return;
    const canvasArea = frame.closest<HTMLElement>(".canvas-area");
    const inFrame = (touch: Touch) => {
      const bounds = frame.getBoundingClientRect();
      return touch.clientX >= bounds.left && touch.clientX <= bounds.right && touch.clientY >= bounds.top && touch.clientY <= bounds.bottom;
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const [first, second] = [event.touches[0], event.touches[1]];
      // Never allow a two-finger gesture that begins around the canvas (for
      // example on a ruler) to shrink the whole Safari page. Only begin canvas
      // navigation once both fingers are inside the canvas viewport.
      if (event.cancelable) event.preventDefault();
      if (!inFrame(first) || !inFrame(second)) return;
      startEditorPinch(frame, first, second);
    };
    const touchMove = (event: TouchEvent) => {
      if (!editorTouchNavigationRef.current) return;
      if (event.cancelable) event.preventDefault();
      const pinch = editorPinchRef.current;
      if (!pinch || event.touches.length < 2) return;
      const [first, second] = [event.touches[0], event.touches[1]];
      const zoom = Math.max(1, Math.min(6, pinch.startZoom * Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) / pinch.startDistance));
      const bounds = frame.getBoundingClientRect();
      const centerX = (first.clientX + second.clientX) / 2 - bounds.left - bounds.width / 2;
      const centerY = (first.clientY + second.clientY) / 2 - bounds.top - bounds.height / 2;
      updateEditorViewport({ zoom, ...clampEditorPan(zoom, centerX - pinch.anchorX * zoom, centerY - pinch.anchorY * zoom, frame) });
    };
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) editorPinchRef.current = null;
      if (!event.touches.length) editorTouchNavigationRef.current = false;
    };
    type TrackpadGesture = Event & { scale: number; clientX: number; clientY: number };
    let trackpadGesture: { zoom: number; scale: number; x: number; y: number } | null = null;
    const applyTrackpadZoom = (zoom: number, clientX: number, clientY: number) => {
      const bounds = frame.getBoundingClientRect();
      updateEditorViewport(zoomCanvasAt(editorViewportRef.current, zoom,
        clientX - bounds.left - bounds.width / 2,
        clientY - bounds.top - bounds.height / 2,
        frame.clientWidth, frame.clientHeight));
    };
    const wheel = (event: WheelEvent) => {
      if (editorTouchNavigationRef.current) return;
      const current = editorViewportRef.current;
      // At Fit, normal scroll stays with the page. Once zoomed, two-finger
      // trackpad scroll navigates the canvas in both axes.
      if (!event.ctrlKey && current.zoom <= 1) return;
      if (event.cancelable) event.preventDefault();
      if (trackpadGesture) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
      if (!event.ctrlKey) {
        if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) return;
        endEditorInteraction();
        updateEditorViewport(panCanvasBy(current, event.deltaX * unit, event.deltaY * unit, frame.clientWidth, frame.clientHeight));
        return;
      }
      // Trackpad pinch is represented as Ctrl+wheel in Chromium and Firefox.
      const delta = event.deltaY * unit;
      if (!Number.isFinite(delta)) return;
      endEditorInteraction();
      applyTrackpadZoom(editorViewportRef.current.zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * .01), event.clientX, event.clientY);
    };
    const gestureStart = (event: Event) => {
      if (!(editorTouchNavigationRef.current || canvasArea?.contains(event.target as Node))) return;
      if (event.cancelable) event.preventDefault();
      // Touch pinch already has its own handler on iPad; never apply it twice.
      if (editorTouchNavigationRef.current || !frame.contains(event.target as Node)) return;
      const gesture = event as TrackpadGesture;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      endEditorInteraction();
      trackpadGesture = { zoom: editorViewportRef.current.zoom, scale: gesture.scale, x: gesture.clientX, y: gesture.clientY };
    };
    const gestureChange = (event: Event) => {
      if (!(editorTouchNavigationRef.current || trackpadGesture || canvasArea?.contains(event.target as Node))) return;
      if (event.cancelable) event.preventDefault();
      if (editorTouchNavigationRef.current || !trackpadGesture) return;
      const gesture = event as TrackpadGesture;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      applyTrackpadZoom(trackpadGesture.zoom * gesture.scale / trackpadGesture.scale, trackpadGesture.x, trackpadGesture.y);
    };
    const gestureEnd = () => { trackpadGesture = null; };
    (canvasArea || frame).addEventListener("touchstart", touchStart, { passive: false });
    document.addEventListener("touchmove", touchMove, { passive: false, capture: true });
    document.addEventListener("touchend", touchEnd, { capture: true });
    document.addEventListener("touchcancel", touchEnd, { capture: true });
    frame.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("gesturestart", gestureStart, { passive: false, capture: true });
    document.addEventListener("gesturechange", gestureChange, { passive: false, capture: true });
    document.addEventListener("gestureend", gestureEnd, { capture: true });
    return () => {
      (canvasArea || frame).removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove, true);
      document.removeEventListener("touchend", touchEnd, true);
      document.removeEventListener("touchcancel", touchEnd, true);
      frame.removeEventListener("wheel", wheel);
      document.removeEventListener("gesturestart", gestureStart, true);
      document.removeEventListener("gesturechange", gestureChange, true);
      document.removeEventListener("gestureend", gestureEnd, true);
      editorPinchRef.current = null;
      editorTouchNavigationRef.current = false;
    };
  }, [accessReady, isUnlocked, workflow, cropSheet, cropTool, endEditorInteraction]);

  const zoomEditor = (factor: number) => {
    const frame = editorRef.current?.parentElement?.parentElement;
    if (!frame) return;
    const current = editorViewportRef.current;
    const zoom = Math.max(1, Math.min(6, Math.round(current.zoom * factor * 100) / 100));
    const ratio = zoom / current.zoom;
    updateEditorViewport({ zoom, ...clampEditorPan(zoom, current.panX * ratio, current.panY * ratio, frame) });
  };

  const clearEditor = useCallback(async () => {
    endEditorInteraction();
    editorViewportRef.current = { zoom: 1, panX: 0, panY: 0 };
    setEditorViewport(editorViewportRef.current);
    if (recoverySaveTimerRef.current !== null) {
      window.clearTimeout(recoverySaveTimerRef.current);
      recoverySaveTimerRef.current = null;
    }
    setPatternName("Halloween Demo Pattern");
    setMotifs(seedMotifs());
    setSelectedId(null);
    setSelectedCopy(null);
    setBackground("#ffffff");
    setBackgroundBase("#ffffff");
    setBackgroundBrightness(0);
    setBackgroundMuted(0);
    setBackgroundTemperature(0);
    setGuide(null);
    setWorkflow("motifs");
    setFinishedPattern(null);
    setSourceDpi(DEFAULT_DPI);
    setExportFormat("png");
    setExportBackground("transparent");
    setLineColorScope("selected");
    setMultiplyCount(1);
    setCropSheet(null);
    setEditingMotifId(null);
    setCropRect(null);
    setLassoPoints([]);
    setEraserCursor(null);
    setPreviewOpen(false);
    cropImageRef.current = null;
    cropEditCanvasRef.current = null;
    cropDisplayRef.current = null;
    cropActivePointerRef.current = null;
    cropUndoStackRef.current = [];
    setCropUndoCount(0);
    eraserUndoStackRef.current = [];
    activeEraserStrokeRef.current = null;
    setEraseUndoCount(0);
    cropTouchPointsRef.current.clear();
    cropTouchGestureRef.current = null;
    cropTouchNavigationRef.current = false;
    updateCropViewport({ zoom: 1, panX: 0, panY: 0 });
    undoStack.current = [];
    redoStack.current = [];
    refreshHistoryState();
    motifRasterCache.current.clear();
    cache.current.clear();
    setRecoveryCandidate(null);
    setRecoveryStatus("");
    try {
      await clearLastPattern();
    } catch {
      // The editor still starts fresh if private browser storage is unavailable.
    }
    setStatus("Fresh pattern ready");
    window.setTimeout(() => setStatus("Ready"), 1800);
  }, [endEditorInteraction, refreshHistoryState]);

  const continueLastPattern = () => {
    if (!recoveryCandidate) return;
    restoreSnapshot(recoveryCandidate);
    setPatternName(recoveryCandidate.patternName || "Untitled pattern");
    setMeasurementUnit(recoveryCandidate.measurementUnit || "cm");
    setExportFormat(recoveryCandidate.exportFormat || "png");
    setExportBackground(recoveryCandidate.exportBackground || "transparent");
    undoStack.current = [];
    redoStack.current = [];
    refreshHistoryState();
    setRecoveryStatus("Saved on this device");
    setRecoveryCandidate(null);
    setStatus("Last pattern restored");
    window.setTimeout(() => setRecoveryReady(true), 0);
    window.setTimeout(() => setStatus("Ready"), 1800);
  };

  const startFresh = async () => {
    setFreshConfirmOpen(false);
    await clearEditor();
    setRecoveryReady(true);
  };

  const chooseBackgroundColor = (color: string) => {
    setBackgroundBase(color);
    setBackgroundBrightness(0);
    setBackgroundMuted(0);
    setBackgroundTemperature(0);
    setBackground(color);
  };

  const changeBackgroundHex = (rawValue: string) => {
    const compact = rawValue.replace(/\s+/g, "").toUpperCase();
    const nextValue = compact.startsWith("#") ? compact.slice(0, 7) : compact.slice(0, 6);
    const normalized = normalizeHexColor(nextValue);
    setBackgroundHexInput(nextValue);
    setBackgroundHexInvalid(!normalized && nextValue.replace(/^#/, "").length >= 6);
    if (!normalized) return;
    if (!backgroundHexEditRememberedRef.current && (normalized !== background.toLowerCase() || backgroundBrightness !== 0 || backgroundMuted !== 0 || backgroundTemperature !== 0)) {
      rememberChange();
      backgroundHexEditRememberedRef.current = true;
    }
    chooseBackgroundColor(normalized);
    setBackgroundHexInput(normalized.toUpperCase());
    setBackgroundHexInvalid(false);
  };

  const changeBackgroundBrightness = (value: number) => {
    setBackgroundBrightness(value);
    setBackground(adjustBackgroundColor(backgroundBase, value, backgroundMuted, backgroundTemperature));
  };

  const changeBackgroundMuted = (value: number) => {
    setBackgroundMuted(value);
    setBackground(adjustBackgroundColor(backgroundBase, backgroundBrightness, value, backgroundTemperature));
  };

  const changeBackgroundTemperature = (value: number) => {
    setBackgroundTemperature(value);
    setBackground(adjustBackgroundColor(backgroundBase, backgroundBrightness, backgroundMuted, value));
  };

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (workflow !== "motifs") return;
    event.stopPropagation();
    if (event.pointerType === "touch" && (!event.isPrimary || editorTouchNavigationRef.current)) return;
    editorPointerGestureRef.current = null;
    if (interactionRef.current) endEditorInteraction();
    setVerticalEdgeGestureActive(false);
    const point = eventPoint(event);
    const hit = hitTest(point.x, point.y, selectMotifsMode);
    if (selectMotifsMode) {
      event.preventDefault();
      if (hit) setSelectedMotifIds((current) => current.includes(hit.motif.id) ? current.filter((id) => id !== hit.motif.id) : [...current, hit.motif.id]);
      return;
    }
    const currentSelection = motifs.find((motif) => motif.id === selectedId) || null;
    const currentCopy = selectedCopy?.id === currentSelection?.id ? selectedCopy : null;
    const currentCopyX = currentCopy?.offsetX ?? 0;
    const currentCopyY = currentCopy?.offsetY ?? 0;
    // Selection handles take priority over other motifs, including a full-tile
    // background. A touch on the selected artwork itself still drags the art.
    if (currentSelection) {
      const geometry = selectionGeometry(currentSelection, editorHeight, currentCopyX, currentCopyY);
      const distanceTo = (target: { x: number; y: number }) => Math.hypot(point.x - target.x, point.y - target.y);
      if (hit?.motif.id !== currentSelection.id && distanceTo(geometry.rotation) <= 32) {
        rememberChange();
        event.preventDefault();
        captureEditorPointer(event);
        const pointerAngle = Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x) * 180 / Math.PI;
        const nextInteraction: Interaction = { kind: "rotate", id: currentSelection.id, angleOffset: currentSelection.rotation - pointerAngle, copyX: currentCopyX, copyY: currentCopyY };
        interactionRef.current = nextInteraction;
        setInteraction(nextInteraction);
        return;
      }
      if (hit?.motif.id !== currentSelection.id && geometry.corners.some((corner) => distanceTo(corner) <= 32)) {
        rememberChange();
        event.preventDefault();
        captureEditorPointer(event);
        const nextInteraction: Interaction = {
          kind: "resize",
          id: currentSelection.id,
          startDistance: Math.max(1, Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y)),
          startScale: currentSelection.scale,
          copyX: currentCopyX,
          copyY: currentCopyY,
        };
        interactionRef.current = nextInteraction;
        setInteraction(nextInteraction);
        return;
      }
    }
    if (shouldDeselectCanvasOnPointerDown(event.pointerType, Boolean(hit))) {
      setSelectedId(null);
      setSelectedCopy(null);
    }
    editorPointerGestureRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startedAt: performance.now(),
      startPoint: point,
      hit,
      mode: "pending",
    };
  };

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" && editorTouchNavigationRef.current) return;
    const gesture = editorPointerGestureRef.current;
    let activeInteraction = interactionRef.current;
    if (!activeInteraction && (!gesture || gesture.pointerId !== event.pointerId)) return;
    if (activeInteraction) event.preventDefault();
    if (!activeInteraction && gesture) {
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
      const clientDx = event.clientX - gesture.startClientX;
      const clientDy = event.clientY - gesture.startClientY;
      const absDx = Math.abs(clientDx);
      const absDy = Math.abs(clientDy);
      const distance = Math.hypot(clientDx, clientDy);
      const elapsed = performance.now() - gesture.startedAt;
      const isTouch = gesture.pointerType === "touch";
      const dragThreshold = motifDragThreshold(gesture.pointerType);
      const verticalIntent = absDy > absDx * QUICK_SCROLL_AXIS_RATIO;
      const quickVerticalScroll = isTouch
        && verticalIntent
        && absDy >= QUICK_SCROLL_THRESHOLD_PX
        && !gesture.hit;

      if (quickVerticalScroll) {
        gesture.mode = "ignored";
        return;
      }
      if (gesture.mode !== "pending") return;
      if (distance < dragThreshold) return;
      if (isTouch && !gesture.hit && verticalIntent && elapsed <= QUICK_SCROLL_WINDOW_MS && absDy < QUICK_SCROLL_THRESHOLD_PX) return;
      if (!gesture.hit) {
        gesture.mode = "ignored";
        return;
      }

      const { hit } = gesture;
      event.preventDefault();
      captureEditorPointer(event);
      setSelectedId(hit.motif.id);
      setSelectedCopy({ id: hit.motif.id, offsetX: hit.offsetX, offsetY: hit.offsetY });
      const nextInteraction: Interaction = {
        kind: "move",
        id: hit.motif.id,
        dx: gesture.startPoint.x - hit.centerX,
        dy: gesture.startPoint.y - hit.centerY,
        copyX: hit.offsetX,
        copyY: hit.offsetY,
        startClientX: gesture.startClientX,
        startClientY: gesture.startClientY,
        centerX: hit.centerX,
        centerY: hit.centerY,
        originX: hit.motif.x,
        originY: hit.motif.y,
        pointerType: gesture.pointerType,
        activated: true,
        historyRecorded: false,
        startSnapshot: currentSnapshot(),
      };
      gesture.mode = "drag";
      interactionRef.current = nextInteraction;
      setInteraction(nextInteraction);
      activeInteraction = nextInteraction;
    }
    if (!activeInteraction) return;
    const point = eventPoint(event);
    if (activeInteraction.kind === "move") {
      const distance = Math.hypot(event.clientX - activeInteraction.startClientX, event.clientY - activeInteraction.startClientY);
      if (!activeInteraction.activated) {
        if (distance < motifDragThreshold(activeInteraction.pointerType)) return;
        activeInteraction.dx = point.x - activeInteraction.centerX;
        activeInteraction.dy = point.y - activeInteraction.centerY;
        activeInteraction.activated = true;
      }
      if (!activeInteraction.historyRecorded && shouldCommitMotifDrag(activeInteraction.pointerType, distance)) {
        rememberSnapshot(activeInteraction.startSnapshot);
        activeInteraction.historyRecorded = true;
      }
    }
    pendingEditorPointRef.current = point;
    if (editorFrameRef.current !== null) return;
    editorFrameRef.current = requestAnimationFrame(() => {
      editorFrameRef.current = null;
      const point = pendingEditorPointRef.current;
      pendingEditorPointRef.current = null;
      if (point) applyEditorPoint(point);
    });
  };

  const finishEditorInteraction = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (event?.pointerType === "touch" && editorTouchNavigationRef.current) return;
    const gesture = editorPointerGestureRef.current;
    if (gesture && (!event || gesture.pointerId === event.pointerId)) {
      if (gesture.mode === "pending") {
        const distance = Math.hypot(gesture.lastClientX - gesture.startClientX, gesture.lastClientY - gesture.startClientY);
        if (distance < motifDragThreshold(gesture.pointerType)) {
          setSelectedId(gesture.hit?.motif.id || null);
          setSelectedCopy(gesture.hit ? { id: gesture.hit.motif.id, offsetX: gesture.hit.offsetX, offsetY: gesture.hit.offsetY } : null);
        }
      }
      editorPointerGestureRef.current = null;
    }
    endEditorInteraction();
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The interaction has already been ended even if Safari dropped capture.
      }
    }
  };

  useEffect(() => {
    const releaseInterruptedGesture = (event: Event) => {
      if (event.type === "blur") {
        editorPinchRef.current = null;
        editorTouchNavigationRef.current = false;
      }
      editorPointerGestureRef.current = null;
      endEditorInteraction();
    };
    window.addEventListener("pointerup", releaseInterruptedGesture);
    window.addEventListener("pointercancel", releaseInterruptedGesture);
    window.addEventListener("blur", releaseInterruptedGesture);
    return () => {
      window.removeEventListener("pointerup", releaseInterruptedGesture);
      window.removeEventListener("pointercancel", releaseInterruptedGesture);
      window.removeEventListener("blur", releaseInterruptedGesture);
      if (editorFrameRef.current !== null) cancelAnimationFrame(editorFrameRef.current);
    };
  }, [endEditorInteraction]);

  const selected = motifs.find((motif) => motif.id === selectedId) || null;
  const reviewPieces = autoReviewIds?.map((id) => motifs.find((motif) => motif.id === id)).filter((motif): motif is Motif => Boolean(motif)) || [];
  const focusedReviewPiece = reviewPieces.find((motif) => motif.id === selectedId) || reviewPieces[0];
  const listedMotifs = autoReviewIds === null ? motifs : motifs.filter((motif) => !autoReviewIds.includes(motif.id));

  const toggleMotifSelection = (id: string) => {
    setSelectedMotifIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const mergeSelectedMotifs = async () => {
    const chosen = motifs.filter((motif) => selectedMotifIds.includes(motif.id));
    if (chosen.length < 2) return;
    if (autoReviewIds !== null) setReviewMerging(true);
    try {
      const images = await Promise.all(chosen.map(async (motif) => {
        const image = new Image();
        image.src = motif.src;
        await image.decode();
        return colorizedImage(image, motif.lineColor);
      }));
      const ratio = motifCanvas.width / TILE;
      const anchor = chosen[0];
      const placement = chosen.map((motif, index) => {
        // Keep wrapped copies together when the selected pieces straddle a tile edge.
        const centerX = nearestWrappedCopy(motif.x, anchor.x, TILE).center * ratio;
        const centerY = nearestWrappedCopy(motif.y, anchor.y, editorHeight).center * ratio;
        const width = motif.width * motif.scale * ratio;
        const height = motif.height * motif.scale * ratio;
        const angle = motif.rotation * Math.PI / 180;
        const extentX = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
        const extentY = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
        return { motif, image: images[index], centerX, centerY, width, height, extentX, extentY };
      });
      const left = Math.floor(Math.min(...placement.map((part) => part.centerX - part.extentX)));
      const top = Math.floor(Math.min(...placement.map((part) => part.centerY - part.extentY)));
      const right = Math.ceil(Math.max(...placement.map((part) => part.centerX + part.extentX)));
      const bottom = Math.ceil(Math.max(...placement.map((part) => part.centerY + part.extentY)));
      const canvas = document.createElement("canvas");
      canvas.width = right - left;
      canvas.height = bottom - top;
      if (!canvas.width || !canvas.height || canvas.width > 8192 || canvas.height > 8192) throw new Error("Selection is too large");
      const context = srgbContext(canvas);
      for (const part of placement) {
        context.save();
        context.globalAlpha = motifOpacity(part.motif) / 100;
        if (Math.abs(normalizeAngle(part.motif.rotation)) < .0001 && !part.motif.flipX) {
          const size = roundedMotifSize(part.motif.width, part.motif.height, part.motif.scale, ratio);
          const position = pixelAlignedTopLeft(part.centerX - left, part.centerY - top, size.width, size.height);
          context.drawImage(part.image, position.x, position.y, size.width, size.height);
        } else {
          context.translate(part.centerX - left, part.centerY - top);
          context.rotate(part.motif.rotation * Math.PI / 180);
          context.scale(part.motif.flipX ? -1 : 1, 1);
          context.drawImage(part.image, -part.width / 2, -part.height / 2, part.width, part.height);
        }
        context.restore();
      }
      const size = motifWorkingSize(canvas.width, canvas.height, motifCanvas);
      const merged: Motif = {
        id: createId(), name: `Merged motif (${chosen.length} pieces)`, src: canvas.toDataURL("image/png"),
        sourceWidth: canvas.width, sourceHeight: canvas.height, sourceDpi: motifCanvas.dpi,
        mergeParts: placement.map((part) => ({
          motif: withoutOriginalFile(part.motif),
          offsetX: (part.centerX - left - canvas.width / 2) / canvas.width,
          offsetY: (part.centerY - top - canvas.height / 2) / canvas.height,
        })),
        x: wrap((left + canvas.width / 2) / ratio), y: wrap((top + canvas.height / 2) / ratio, editorHeight),
        width: size.width, height: size.height, scale: 1, maxScale: 1,
        rotation: 0, flipX: false, opacity: 100, lineColor: null,
      };
      rememberChange();
      const ids = new Set(chosen.map((motif) => motif.id));
      const last = Math.max(...motifs.map((motif, index) => ids.has(motif.id) ? index : -1));
      cropUndoStackRef.current = cropUndoStackRef.current.filter((removal) => !ids.has(removal.motifId));
      setCropUndoCount(cropUndoStackRef.current.length);
      setMotifs((current) => current.flatMap((motif, index) => index === last ? [merged] : ids.has(motif.id) ? [] : [motif]));
      if (autoReviewIds !== null) {
        setAutoReviewIds((current) => current ? [...current.filter((id) => !ids.has(id)), merged.id] : null);
        setAutoReviewKeptIds((current) => current.filter((id) => !ids.has(id)));
        setCroppedCount((count) => Math.max(0, count - chosen.length + 1));
      }
      setSelectedId(merged.id);
      setSelectedCopy(null);
      setSelectedMotifIds([]);
      setSelectMotifsMode(false);
      setStatus(`${chosen.length} motifs merged into one movable motif`);
    } catch {
      setStatus("Could not merge these motifs. Your original pieces are unchanged.");
    } finally {
      setReviewMerging(false);
    }
  };

  const unmergeSelectedMotif = () => {
    if (!selected?.mergeParts?.length) return;
    const parts = selected.mergeParts.map(({ motif, offsetX, offsetY }) => ({
      ...motif,
      id: createId(),
      ...motifWorkingSize(motif.sourceWidth || Math.round(motif.width * motifCanvas.width / TILE), motif.sourceHeight || Math.round(motif.height * motifCanvas.width / TILE), motifCanvas),
      ...positionUnmergedPart(selected, { offsetX, offsetY, rotation: motif.rotation, scale: motif.scale, flipX: motif.flipX, opacity: motifOpacity(motif) }, TILE, editorHeight),
      lineColor: selected.lineColor || motif.lineColor,
    }));
    rememberChange();
    setMotifs((current) => current.flatMap((motif) => motif.id === selected.id ? parts : [motif]));
    setSelectedId(parts[0]?.id || null);
    setSelectedCopy(null);
    setStatus(`${parts.length} motifs separated again`);
  };

  const deselectFromBackground = (event: ReactMouseEvent<HTMLElement>) => {
    if (workflow !== "motifs" || !selectedId) return;
    const target = event.target as HTMLElement;
    if (target.closest(".canvas-viewport, button, input, textarea, select, label, summary, [role='button'], [role='slider'], [role='radio'], [role='switch'], [role='tab']")) return;
    setSelectedId(null);
    setSelectedCopy(null);
  };
  const selectedLayerIndex = selected ? motifs.findIndex((motif) => motif.id === selected.id) : -1;
  const canMoveForward = selectedLayerIndex >= 0 && selectedLayerIndex < motifs.length - 1;
  const canMoveBackward = selectedLayerIndex > 0;
  const update = (changes: Partial<Motif>, remember = true) => {
    if (remember) rememberChange();
    setMotifs((current) => current.map((motif) => motif.id === selectedId ? { ...motif, ...changes } : motif));
  };

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type === "image/png");
    if (!files.length) {
      setStatus("Please upload PNG artwork with a transparent background");
      return;
    }
    rememberChange();
    setStatus("Adding artwork…");
    const loaded = await Promise.all(files.map(async (file): Promise<Motif> => {
      const [originalSrc, sourceDpi] = await Promise.all([fileToDataUrl(file), pngDpi(file)]);
      const trimmed = await trimTransparentImage(originalSrc);
      const workingSize = motifWorkingSize(trimmed.width, trimmed.height, motifCanvas);
      return {
        id: createId(),
        name: file.name,
        src: trimmed.src,
        originalFile: file,
        sourceWidth: trimmed.width,
        sourceHeight: trimmed.height,
        sourceDpi,
        x: TILE / 2,
        y: editorHeight / 2,
        width: workingSize.width,
        height: workingSize.height,
        scale: 1,
        maxScale: 1,
        rotation: 0,
        flipX: false,
        opacity: 100,
        lineColor: null,
      };
    }));
    const additions = spreadUploadedMotifs(loaded, motifs, TILE, editorHeight);
    setMotifs((current) => [...current, ...additions]);
    setSelectedId(additions[additions.length - 1]?.id || null);
    setStatus("Artwork added at its original pixel size");
    window.setTimeout(() => setStatus("Ready"), 2500);
    event.target.value = "";
  };

  const importSeamlessPng = (tile: ImportedSeamlessPng) => {
    rememberChange();
    const toMotif = (piece: ImportedSeamlessPiece, name: string): Motif => ({
      id: createId(), name, src: piece.src,
      sourceWidth: piece.width, sourceHeight: piece.height, sourceDpi: tile.dpi,
      x: piece.x / tile.size * TILE, y: piece.y / tile.size * TILE,
      width: piece.width / tile.size * TILE, height: piece.height / tile.size * TILE,
      scale: 1, maxScale: 1, rotation: 0, flipX: false, opacity: 100, lineColor: null,
      ...(piece.parts ? { mergeParts: piece.parts.map((part, index) => ({
        motif: toMotif(part, `${name} part ${index + 1}`),
        offsetX: (nearestWrappedCopy(part.x, piece.x, tile.size).center - piece.x) / piece.width,
        offsetY: (nearestWrappedCopy(part.y, piece.y, tile.size).center - piece.y) / piece.height,
      })) } : {}),
    });
    const recovered = tile.pieces.map((piece, index) => toMotif(piece, `${tile.name} motif ${index + 1}`));
    setInteraction(null); interactionRef.current = null;
    setWorkflow("motifs"); setFinishedPattern(null); setGuide(null);
    setMotifs(recovered); setSelectedId(null); setSelectedCopy(null); setSelectedMotifIds([]); setSelectMotifsMode(false);
    setMotifCanvas({ width: tile.size, height: tile.size, dpi: tile.dpi }); setSourceDpi(tile.dpi);
    setPatternName(tile.name); setCustomCanvasInput(String(tile.size)); setCustomCanvasInvalid(false);
    updateEditorViewport({ zoom: 1, panX: 0, panY: 0 }); setSeamlessPngFile(null);
    setStatus(`${recovered.length} editable pieces imported at their original positions. Edge and corner pieces are connected.`);
  };

  const uploadClipartSheet = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.type !== "image/png") {
      setStatus("Please upload a PNG clipart sheet with a transparent background");
      return;
    }
    setStatus("Opening clipart sheet…");
    const [src, dpi] = await Promise.all([fileToDataUrl(file), pngDpi(file)]);
    const image = new Image();
    image.src = src;
    await image.decode();
    cropImageRef.current = image;
    cropDisplayRef.current = null;
    const edited = document.createElement("canvas");
    edited.width = image.naturalWidth;
    edited.height = image.naturalHeight;
    srgbContext(edited).drawImage(image, 0, 0);
    cropEditCanvasRef.current = edited;
    cropDirtyRef.current = false;
    setEditingMotifId(null);
    setAutoReviewIds(null);
    setAutoReviewKeptIds([]);
    setCropSheet({ id: createId(), src, name: file.name, width: image.naturalWidth, height: image.naturalHeight, dpi });
    setCropRect(null);
    setCropTool("lasso");
    setLassoPoints([]);
    setEraserCursor(null);
    setCropRevision(0);
    setCroppedCount(0);
    cropUndoStackRef.current = [];
    cropActivePointerRef.current = null;
    setCropUndoCount(0);
    eraserUndoStackRef.current = [];
    activeEraserStrokeRef.current = null;
    setEraseUndoCount(0);
    cropTouchPointsRef.current.clear();
    cropTouchGestureRef.current = null;
    cropTouchNavigationRef.current = false;
    updateCropViewport({ zoom: 1, panX: 0, panY: 0 });
    setCropMessage("Draw around one or more parts · pinch with two fingers to zoom");
    setStatus("Ready to crop motifs");
    event.target.value = "";
  };

  const sheetPointOnTile = (sourceX: number, sourceY: number, sourceWidth: number, sourceHeight: number) => {
    const layout = cropDisplayRef.current;
    if (layout && layout.imageWidth === sourceWidth && layout.imageHeight === sourceHeight) {
      return {
        x: wrap((layout.display.x + sourceX * layout.display.scale) / layout.canvasWidth * TILE),
        y: wrap((layout.display.y + sourceY * layout.display.scale) / layout.canvasHeight * editorHeight, editorHeight),
      };
    }
    return { x: wrap(sourceX / sourceWidth * TILE), y: wrap(sourceY / sourceHeight * editorHeight, editorHeight) };
  };

  const addCroppedMotif = () => {
    const image = cropImageRef.current;
    const edited = cropEditCanvasRef.current;
    if (!image || !cropSheet || !cropRect || cropRect.width < 3 || cropRect.height < 3 || cropAdding) return false;
    setCropAdding(true);
    setCropMessage("Cropping motif…");
    const x = Math.max(0, Math.floor(cropRect.x));
    const y = Math.max(0, Math.floor(cropRect.y));
    const right = Math.min(image.naturalWidth, Math.ceil(cropRect.x + cropRect.width));
    const bottom = Math.min(image.naturalHeight, Math.ceil(cropRect.y + cropRect.height));
    const cropWidth = Math.max(1, right - x);
    const cropHeight = Math.max(1, bottom - y);
    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const cropContext = srgbContext(canvas);
    if (cropTool === "lasso" && lassoPoints.length > 2) {
      cropContext.beginPath();
      cropContext.moveTo(lassoPoints[0].x - x, lassoPoints[0].y - y);
      for (const point of lassoPoints.slice(1)) cropContext.lineTo(point.x - x, point.y - y);
      cropContext.closePath();
      cropContext.clip();
    }
    // Crop only what remains on the sheet. A later lasso may cross an earlier
    // crop's bounds, but that must never remove its motif from the canvas.
    cropContext.drawImage(edited || image, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const { canvas: trimmedCanvas, x: trimX, y: trimY, empty } = trimTransparentCanvasWithBounds(canvas);
    if (empty) {
      setCropAdding(false);
      setCropMessage("This area is empty or was already cropped. Select another part of the sheet.");
      return false;
    }
    const src = trimmedCanvas.toDataURL("image/png");
    const workingSize = motifWorkingSize(trimmedCanvas.width, trimmedCanvas.height, motifCanvas);
    const nextNumber = croppedCount + 1;
    const placement = sheetPointOnTile(x + trimX + trimmedCanvas.width / 2, y + trimY + trimmedCanvas.height / 2, image.naturalWidth, image.naturalHeight);
    const motif: Motif = {
      id: createId(),
      name: cropSheet.name.replace(/\.[^.]+$/, "") + " motif " + nextNumber,
      src,
      sourceWidth: trimmedCanvas.width,
      sourceHeight: trimmedCanvas.height,
      sourceDpi: cropSheet.dpi,
      sheetId: cropSheet.id,
      sheetBounds: { x, y, width: cropWidth, height: cropHeight },
      x: placement.x,
      y: placement.y,
      width: workingSize.width,
      height: workingSize.height,
      scale: 1,
      maxScale: 1,
      rotation: 0,
      flipX: false,
      opacity: 100,
      lineColor: null,
    };
    const removal: CropRemoval = {
      motifId: motif.id,
      x,
      y,
      width: cropWidth,
      height: cropHeight,
      patch: canvas,
      lasso: cropTool === "lasso" ? lassoPoints.map((point) => ({ ...point })) : null,
    };
    if (edited) {
      removeCropArea(srgbContext(edited), removal);
      cropUndoStackRef.current.push(removal);
      setCropUndoCount(cropUndoStackRef.current.length);
      setCropRevision((value) => value + 1);
      cropDirtyRef.current = true;
    }
    rememberChange();
    setMotifs((current) => [...current, motif]);
    setSelectedId(motif.id);
    setCroppedCount(nextNumber);
    setCropRect(null);
    setLassoPoints([]);
    setCropAdding(false);
    setCropMessage("Motif added — draw around the next motif, or choose Move to arrange it");
    setStatus("Motif " + nextNumber + " added from clipart sheet");
    return true;
  };

  const autoSeparateSheet = async () => {
    const edited = cropEditCanvasRef.current;
    if (!edited || !cropSheet || autoSeparating || cropAdding) return;
    setAutoSeparating(true);
    setCropMessage("Finding separate pieces…");
    try {
      // Yield once so the progress state paints before scanning a large PNG.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const context = srgbContext(edited);
      const frame = context.getImageData(0, 0, edited.width, edited.height);
      const alphaCheck = inspectAlphaSheet(frame.data, edited.width, edited.height);
      if (alphaCheck.likelyOpaqueBackground) {
        setCropMessage("This PNG has a visible background, so the motifs cannot be separated safely. Remove the background and upload the transparent PNG again.");
        setStatus("Transparent background required");
        return;
      }
      const components = findAlphaComponents(frame.data, edited.width, edited.height);
      if (!components.length) {
        setCropMessage("No separate artwork found. Use the lasso to select a motif.");
        return;
      }
      const added: Motif[] = [];
      const removals: CropRemoval[] = [];
      const sourceName = cropSheet.name.replace(/\.[^.]+$/, "");
      for (const component of components) {
        const fragment = document.createElement("canvas");
        fragment.width = component.width;
        fragment.height = component.height;
        const fragmentContext = srgbContext(fragment);
        const pixels = fragmentContext.createImageData(component.width, component.height);
        for (const index of component.pixels) {
          const x = index % edited.width - component.x;
          const y = Math.floor(index / edited.width) - component.y;
          const target = (y * component.width + x) * 4;
          const source = index * 4;
          for (let channel = 0; channel < 4; channel++) pixels.data[target + channel] = frame.data[source + channel];
          // Remove only this island, even if its rectangle overlaps another.
          frame.data[source + 3] = 0;
        }
        fragmentContext.putImageData(pixels, 0, 0);
        const size = motifWorkingSize(component.width, component.height, motifCanvas);
        added.push({
          id: createId(), name: `${sourceName} motif ${croppedCount + added.length + 1}`,
          src: fragment.toDataURL("image/png"), sourceWidth: component.width, sourceHeight: component.height,
          sourceDpi: cropSheet.dpi,
          sheetId: cropSheet.id,
          sheetBounds: { x: component.x, y: component.y, width: component.width, height: component.height },
          ...sheetPointOnTile(component.x + component.width / 2, component.y + component.height / 2, edited.width, edited.height),
          width: size.width, height: size.height, scale: 1, maxScale: 1,
          rotation: 0, flipX: false, opacity: 100, lineColor: null,
        });
        removals.push({ motifId: added[added.length - 1].id, x: component.x, y: component.y,
          width: component.width, height: component.height, patch: fragment,
          lasso: null, pixels: component.pixels });
      }
      rememberChange();
      context.putImageData(frame, 0, 0);
      cropUndoStackRef.current.push(...removals);
      setCropUndoCount(cropUndoStackRef.current.length);
      setCropRevision((value) => value + 1);
      setMotifs((current) => [...current, ...added]);
      setSelectedId(added[added.length - 1].id);
      setCroppedCount((value) => value + added.length);
      setCropRect(null);
      setLassoPoints([]);
      setCropTool("move");
      setAutoReviewIds(added.map((motif) => motif.id));
      setAutoReviewKeptIds([]);
      setSelectedMotifIds([]);
      setSelectMotifsMode(false);
      setCropMessage(`Review ${added.length} detected pieces below. Select details to attach, keep, or remove.`);
      setStatus(`${added.length} pieces ready for review`);
    } catch {
      setCropMessage("Could not separate this sheet. Use the lasso instead.");
    } finally {
      setAutoSeparating(false);
    }
  };

  const undoLastCrop = () => {
    const edited = cropEditCanvasRef.current;
    const removal = cropUndoStackRef.current.pop();
    if (!edited || !removal) return;
    const context = srgbContext(edited);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.drawImage(removal.patch, removal.x, removal.y);
    context.restore();
    setMotifs((current) => current.filter((motif) => motif.id !== removal.motifId));
    setAutoReviewIds((current) => current?.filter((id) => id !== removal.motifId) ?? null);
    setSelectedMotifIds((current) => current.filter((id) => id !== removal.motifId));
    setSelectedId((current) => current === removal.motifId ? null : current);
    setCroppedCount((value) => Math.max(0, value - 1));
    setCropUndoCount(cropUndoStackRef.current.length);
    setCropRect(null);
    setLassoPoints([]);
    setCropRevision((value) => value + 1);
    setCropMessage("Last crop undone — the motif is back on the sheet");
    setStatus("Last cropped motif removed");
  };

  const closeCropWorkspace = (addedPending = 0) => {
    if (cropAdding) return;
    if (editingMotifId && cropDirtyRef.current && cropEditCanvasRef.current) {
      const src = cropEditCanvasRef.current.toDataURL("image/png");
      rememberChange();
      setMotifs((current) => current.map((motif) => motif.id === editingMotifId
        ? { ...motif, src, originalFile: undefined, mergeParts: undefined }
        : motif));
      motifRasterCache.current.clear();
    }
    cropDirtyRef.current = false;
    setEditingMotifId(null);
    setCropSheet(null);
    setAutoReviewIds(null);
    setAutoReviewKeptIds([]);
    setSelectedMotifIds([]);
    setCropRect(null);
    cropImageRef.current = null;
    cropEditCanvasRef.current = null;
    cropDisplayRef.current = null;
    cropStartRef.current = null;
    cropActivePointerRef.current = null;
    eraserLastRef.current = null;
    cropUndoStackRef.current = [];
    setCropUndoCount(0);
    eraserUndoStackRef.current = [];
    activeEraserStrokeRef.current = null;
    setEraseUndoCount(0);
    cropTouchPointsRef.current.clear();
    cropTouchGestureRef.current = null;
    cropTouchNavigationRef.current = false;
    updateCropViewport({ zoom: 1, panX: 0, panY: 0 });
    setLassoPoints([]);
    setEraserCursor(null);
    const total = croppedCount + addedPending;
    setStatus(total ? total + (total === 1 ? " motif added" : " motifs added") : "Ready");
  };

  const cancelAutoReview = () => {
    if (autoReviewIds === null) { closeCropWorkspace(); return; }
    const pending = new Set(autoReviewIds);
    setMotifs((current) => current.filter((motif) => !pending.has(motif.id)));
    cropUndoStackRef.current = cropUndoStackRef.current.filter((removal) => !pending.has(removal.motifId));
    setCropUndoCount(cropUndoStackRef.current.length);
    closeCropWorkspace();
    setStatus("Auto separate preview discarded");
  };

  const keepReviewSelection = () => {
    setAutoReviewKeptIds((current) => [...new Set([...current, ...selectedMotifIds])]);
    setSelectedMotifIds([]);
    setStatus("Selected pieces kept separate");
  };

  const removeReviewSelection = () => {
    if (!selectedMotifIds.length) return;
    const removed = new Set(selectedMotifIds);
    rememberChange();
    setMotifs((current) => current.filter((motif) => !removed.has(motif.id)));
    setAutoReviewIds((current) => current?.filter((id) => !removed.has(id)) ?? null);
    setAutoReviewKeptIds((current) => current.filter((id) => !removed.has(id)));
    cropUndoStackRef.current = cropUndoStackRef.current.filter((removal) => !removed.has(removal.motifId));
    setCropUndoCount(cropUndoStackRef.current.length);
    setCroppedCount((count) => Math.max(0, count - removed.size));
    setSelectedId(null);
    setSelectedMotifIds([]);
    setStatus(`${removed.size} ${removed.size === 1 ? "piece" : "pieces"} removed`);
  };

  const finishCropWorkspace = () => {
    if (cropAdding) return;
    if (cropRect && !editingMotifId) {
      // Done also commits the last visible selection, so it cannot vanish.
      if (!addCroppedMotif()) return;
      closeCropWorkspace(1);
      return;
    }
    closeCropWorkspace();
  };

  const editSelectedMotif = async () => {
    if (!selected || cropSheet) return;
    const image = new Image();
    image.src = selected.src;
    await image.decode();
    const edited = document.createElement("canvas");
    edited.width = image.naturalWidth;
    edited.height = image.naturalHeight;
    srgbContext(edited).drawImage(image, 0, 0);
    cropImageRef.current = image;
    cropEditCanvasRef.current = edited;
    cropDisplayRef.current = null;
    cropUndoStackRef.current = [];
    eraserUndoStackRef.current = [];
    cropDirtyRef.current = false;
    setCropUndoCount(0);
    setEraseUndoCount(0);
    setCropRevision(0);
    setCroppedCount(0);
    setCropRect(null);
    setLassoPoints([]);
    setEditingMotifId(selected.id);
    setCropTool("eraser");
    updateCropViewport({ zoom: 1, panX: 0, panY: 0 });
    setCropSheet({ id: createId(), src: selected.src, name: selected.name, width: image.naturalWidth,
      height: image.naturalHeight, dpi: selected.sourceDpi || DEFAULT_DPI });
    setCropMessage("Erase with one finger, Apple Pencil, or mouse—or use Lasso to separate part of this motif.");
  };

  const changeWorkflow = (next: Workflow) => {
    if (next === workflow) return;
    rememberChange();
    setWorkflow(next);
    setSelectedId(null);
    setSelectedCopy(null);
    interactionRef.current = null;
    setInteraction(null);
  };

  const updateGuide = (changes: Partial<GuideLayer>, remember = true) => {
    if (!guide) return;
    if (remember) rememberChange();
    setGuide((current) => current ? { ...current, ...changes } : current);
  };

  const chooseLibraryGuide = (template: typeof LIBRARY_TEMPLATES[number]) => {
    rememberChange();
    setGuide({ ...DEFAULT_GUIDE, id: template.id, name: template.name, src: template.src });
    setStatus("Template added as a reference only");
    window.setTimeout(() => setStatus("Ready"), 2000);
  };

  const chooseCanvasSize = (size: number) => {
    if (size === motifCanvas.width && size === motifCanvas.height) return;
    rememberChange();
    const nextCanvas = { width: size, height: size, dpi: motifCanvas.dpi };
    const physicalScale = motifCanvas.width / size;
    setMotifs((current) => current.map((motif) => {
      if (motif.sourceWidth && motif.sourceHeight) {
        return { ...motif, ...motifWorkingSize(motif.sourceWidth, motif.sourceHeight, nextCanvas), maxScale: 1, scale: Math.min(1, motif.scale) };
      }
      return { ...motif, width: motif.width * physicalScale, height: motif.height * physicalScale };
    }));
    setMotifCanvas(nextCanvas);
    setStatus(size + " × " + size + " px canvas · original motif pixels preserved");
    window.setTimeout(() => setStatus("Ready"), 2400);
  };

  const applyCustomCanvasSize = () => {
    const size = parseSquareCanvasSize(customCanvasInput);
    if (size === null) {
      setCustomCanvasInvalid(true);
      setStatus(`Enter a whole number from ${MIN_CUSTOM_CANVAS_SIZE} to ${MAX_CUSTOM_CANVAS_SIZE} px`);
      return;
    }
    setCustomCanvasInvalid(false);
    chooseCanvasSize(size);
  };

  const uploadGuide = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setStatus("Adding template…");
    const src = await fileToDataUrl(file);
    const image = new Image();
    image.src = src;
    await image.decode();
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const canvasAspect = TILE / editorHeight;
    const fittedWidth = imageAspect >= canvasAspect ? TILE : editorHeight * imageAspect;
    const fittedHeight = imageAspect >= canvasAspect ? TILE / imageAspect : editorHeight;
    rememberChange();
    setGuide({
      src,
      name: file.name,
      kind: "uploaded",
      x: 500,
      y: editorHeight / 2,
      width: fittedWidth,
      height: fittedHeight,
      scale: 1,
      opacity: 22,
      visible: true,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
    });
    setStatus("Template fitted to the canvas as a reference only");
    window.setTimeout(() => setStatus("Ready"), 2200);
    event.target.value = "";
  };

  const removeGuide = () => {
    if (!guide) return;
    rememberChange();
    setGuide(null);
  };

  const uploadFinishedPattern = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !["image/png", "image/jpeg"].includes(file.type)) return;
    setStatus("Reading original pattern…");
    const src = await fileToDataUrl(file);
    const image = new Image();
    image.src = src;
    await image.decode();
    const normalized = document.createElement("canvas");
    normalized.width = image.naturalWidth;
    normalized.height = image.naturalHeight;
    srgbContext(normalized).drawImage(image, 0, 0);
    const workingSrc = normalized.toDataURL("image/png");
    const previewSrc = await makePreviewCopy(workingSrc, "image/png");
    rememberChange();
    setFinishedPattern({ name: file.name, src: workingSrc, previewSrc, width: image.naturalWidth, height: image.naturalHeight, mime: file.type, originalFile: file });
    setWorkflow("finished");
    setSelectedId(null);
    setSelectedCopy(null);
    if (file.type === "image/jpeg") {
      setExportFormat("jpeg");
      setExportBackground("included");
    } else {
      setExportFormat("png");
      setExportBackground("transparent");
    }
    setStatus("Original dimensions preserved");
    window.setTimeout(() => setStatus("Ready"), 2600);
    event.target.value = "";
  };

  const duplicate = () => {
    if (!selected) return;
    rememberChange();
    const copy = { ...selected, id: createId(), name: selected.name + " copy", x: wrap(selected.x + 70), y: wrap(selected.y + 70, editorHeight) };
    setMotifs((current) => [...current, copy]);
    setSelectedId(copy.id);
  };

  const moveSelectedLayer = (move: LayerMove) => {
    if (!selected) return;
    const canMove = move === "front" || move === "forward" ? canMoveForward : canMoveBackward;
    if (!canMove) return;

    rememberChange();
    setMotifs((current) => reorderMotifLayer(current, selected.id, move));
    setSelectedCopy(null);
    const messages: Record<LayerMove, string> = {
      front: "Motif brought to front",
      forward: "Motif moved forward",
      backward: "Motif moved backward",
      back: "Motif sent to back",
    };
    setStatus(messages[move]);
    window.setTimeout(() => setStatus("Ready"), 1600);
  };

  const changeLineColor = (color: string | null) => {
    if (!selected) return;
    rememberChange();
    setMotifs((current) => current.map((motif) => lineColorScope === "all" || motif.id === selected.id ? { ...motif, lineColor: color } : motif));
    const target = lineColorScope === "all" ? "all motifs" : "this motif";
    setStatus(color ? "Line color applied to " + target : "Original color restored for " + target);
    window.setTimeout(() => setStatus("Ready"), 1800);
  };

  const centerInFourCorners = () => {
    if (!selected) return;
    update({ x: 0, y: 0 });
    setStatus("Motif centered equally in all 4 corners");
    window.setTimeout(() => setStatus("Ready"), 2600);
  };

  const placeTopAndBottom = () => {
    if (!selected) return;
    update({ x: TILE / 2, y: 0 });
    setSelectedCopy(null);
    setStatus("Motif placed on the top and bottom edges");
    window.setTimeout(() => setStatus("Ready"), 2400);
  };

  const placeLeftAndRight = () => {
    if (!selected) return;
    update({ x: 0, y: editorHeight / 2 });
    setSelectedCopy(null);
    setStatus("Motif placed on the left and right edges");
    window.setTimeout(() => setStatus("Ready"), 2400);
  };

  const placeInCentre = () => {
    if (!selected) return;
    update({ x: TILE / 2, y: editorHeight / 2 });
    setSelectedCopy(null);
    setStatus("Motif placed in the centre");
    window.setTimeout(() => setStatus("Ready"), 2200);
  };

  const multiply = () => {
    if (!selected) return;
    rememberChange();
    const copies = Array.from({ length: multiplyCount }, (_, index) => {
      const step = index + 1;
      const angle = step * 0.9;
      const distance = 65 + step * 13;
      return {
        ...selected,
        id: createId(),
        name: selected.name + " copy " + step,
        x: wrap(selected.x + Math.cos(angle) * distance),
        y: wrap(selected.y + Math.sin(angle) * distance, editorHeight),
      };
    });
    setMotifs((current) => [...current, ...copies]);
    setSelectedId(copies[copies.length - 1].id);
    setStatus(multiplyCount === 1 ? "1 copy created" : multiplyCount + " copies created");
    window.setTimeout(() => setStatus("Ready"), 2200);
  };

  const remove = () => {
    if (!selected) return;
    rememberChange();
    setMotifs((current) => current.filter((motif) => motif.id !== selected.id));
    setSelectedId(null);
    setSelectedCopy(null);
  };

  const toPhysical = (pixels: number) => measurementUnit === "cm" ? pixels / activeDpi * 2.54 : pixels / activeDpi;
  const formatPhysical = (pixels: number) => {
    const value = toPhysical(pixels);
    return (value < 10 ? value.toFixed(1) : value.toFixed(0)) + " " + measurementUnit;
  };
  const rulerTicks = (pixels: number) => {
    const total = toPhysical(pixels);
    const step = measurementUnit === "cm" ? 1 : .5;
    const count = Math.floor(total / step);
    const values = Array.from({ length: count + 1 }, (_, index) => index * step);
    if (Math.abs(values[values.length - 1] - total) > .05) values.push(total);
    return values.map((value) => ({
      value,
      position: value / total * 100,
      major: measurementUnit === "cm" ? Math.abs(value / 5 - Math.round(value / 5)) < .01 : Math.abs(value - Math.round(value)) < .01,
    }));
  };
  const horizontalTicks = rulerTicks(canvasWidthPx);
  const verticalTicks = rulerTicks(canvasHeightPx);
  const selectedPrintWidth = selected ? selected.width * selected.scale / TILE * canvasWidthPx : 0;
  const selectedPrintHeight = selected ? selected.height * selected.scale / TILE * canvasWidthPx : 0;
  const movingMotif = interaction?.kind === "move" ? motifs.find((motif) => motif.id === interaction.id) || null : null;
  const movingEdgeState = movingMotif ? (() => {
    const radians = movingMotif.rotation * Math.PI / 180;
    const halfWidth = movingMotif.width * movingMotif.scale / 2;
    const halfHeight = movingMotif.height * movingMotif.scale / 2;
    const extentX = Math.abs(Math.cos(radians)) * halfWidth + Math.abs(Math.sin(radians)) * halfHeight;
    const extentY = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
    const x = wrap(movingMotif.x);
    const y = wrap(movingMotif.y, editorHeight);
    const horizontal = x <= extentX || TILE - x <= extentX;
    const vertical = y <= extentY || editorHeight - y <= extentY;
    return { any: horizontal || vertical, vertical };
  })() : { any: false, vertical: false };
  const liveEdgeRepeat = movingEdgeState.any || verticalEdgeGestureActive;
  const liveVerticalEdgeRepeat = movingEdgeState.vertical || verticalEdgeGestureActive;

  const exportArtwork = async () => {
    if (workflow === "finished" && !finishedPattern) {
      setStatus("Upload a finished pattern first");
      return;
    }
    const transparent = exportBackground === "transparent" && exportFormat !== "jpeg";
    setStatus("Rendering " + exportFormat.toUpperCase() + "…");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const srgbProfile = await loadSrgbProfile();
    let blob: Blob;
    let extension: string;
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidthPx;
    canvas.height = canvasHeightPx;
    const context = srgbContext(canvas);
    if (workflow === "finished" && finishedPattern) {
      if (!transparent) {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const original = new Image();
      original.src = finishedPattern.src;
      await original.decode();
      context.drawImage(original, 0, 0, canvas.width, canvas.height);
    } else {
      drawTile(context, canvas.width, 0, 0, false, false, !transparent, canvas.height);
    }
    drawDemoWatermark(context, canvas.width, canvas.height);
    if (exportFormat === "tiff") {
      const rgba = srgbContext(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data;
      blob = encodeTiffPixels(canvas.width, canvas.height, rgba, transparent, activeDpi, srgbProfile);
      extension = "tiff";
    } else if (exportFormat === "jpeg") {
      const raw = await new Promise<Blob>((resolve, reject) => canvas.toBlob((file) => file ? resolve(file) : reject(new Error("Export failed")), "image/jpeg", .96));
      blob = await withJpegMetadata(raw, activeDpi, srgbProfile);
      extension = "jpg";
    } else {
      const raw = await new Promise<Blob>((resolve, reject) => canvas.toBlob((file) => file ? resolve(file) : reject(new Error("Export failed")), "image/png"));
      blob = await withPngMetadata(raw, activeDpi, srgbProfile);
      extension = "png";
    }
    motifRasterCache.current.clear();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pattern-tile-" + canvasWidthPx + "x" + canvasHeightPx + "px-" + activeDpi + "dpi." + extension;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Safari can start the download asynchronously. Revoking immediately after
    // click can invalidate the file before the browser has claimed it.
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(exportFormat.toUpperCase() + " demo exported with watermark at " + canvasWidthPx + " × " + canvasHeightPx + " px");
    window.setTimeout(() => setStatus("Ready"), 2500);
  };

  return (
    <main className="app-shell" onClick={deselectFromBackground}>
      <header className="topbar">
        <div className="brand-mark">P</div>
        <div className="brand-copy">
          <div className="brand-title-line"><strong>Easy Pattern Studio</strong><small>by Vanya Illustrations</small><span className="demo-badge">Public demo</span></div>
          <input aria-label="Pattern name" value={patternName} onChange={(event) => setPatternName(event.target.value)} />
        </div>
        <div className="history-controls" data-history-revision={historyState.revision}>
          <button disabled={!historyState.canUndo} onClick={undo} aria-label="Undo" title="Undo"><Undo2 size={18} /></button>
          <button disabled={!historyState.canRedo} onClick={redo} aria-label="Redo" title="Redo"><Redo2 size={18} /></button>
          <PencilButton type="button" className="start-fresh-button" onActivate={() => setFreshConfirmOpen(true)} title="Start a new pattern"><FilePlus2 size={17} /><span>Start fresh</span></PencilButton>
        </div>
        <div className={"recovery-status" + (recoveryStatus === "Device saving unavailable" ? " unavailable" : "")} aria-live="polite">
          {recoveryStatus ? <><Check size={14} />{recoveryStatus}</> : <span />}
        </div>
        <button className="export-button" aria-label={`Export ${exportFormat.toUpperCase()}`} disabled={workflow === "finished" && !finishedPattern} onClick={exportArtwork}><Download size={17} /><span>Export {exportFormat.toUpperCase()}</span></button>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <>
            <div className="panel-section">
              <p className="eyebrow">Try the studio</p>
              <div className="demo-intro">
                <strong>Move a motif across any edge and watch the repeat appear instantly.</strong>
                <p>These watermarked Halloween motifs are ready to move, resize, rotate and duplicate against any background.</p>
                <a href="https://vanyaillustrations.etsy.com" target="_blank" rel="noreferrer">Get the full version on Etsy</a>
              </div>
            </div>
            <div className="panel-section library-section">
              <div className="section-heading"><p className="eyebrow">Motifs</p><span>{listedMotifs.length}</span></div>
              {listedMotifs.length > 1 && <p className="motif-layer-note">Top motif appears in front.</p>}
              {listedMotifs.length > 1 && autoReviewIds === null && <div className="motif-merge-actions">
                <PencilButton type="button" aria-pressed={selectMotifsMode} onActivate={() => { setSelectMotifsMode(!selectMotifsMode); setSelectedMotifIds([]); setSelectedId(null); setSelectedCopy(null); }}>{selectMotifsMode ? "Cancel selection" : "Select motifs"}</PencilButton>
                {selectMotifsMode && <PencilButton type="button" disabled={selectedMotifIds.length < 2} onActivate={() => void mergeSelectedMotifs()}>Merge {selectedMotifIds.length > 0 ? `${selectedMotifIds.length} selected` : "selected"}</PencilButton>}
              </div>}
              {selectMotifsMode && <p className="motif-layer-note">Tap pieces on the canvas or in this list, then Merge. Tiny pieces can be selected here.</p>}
              <div className="motif-list">
                {[...listedMotifs].reverse().map((motif) => <PencilButton type="button" key={motif.id} aria-pressed={selectMotifsMode ? selectedMotifIds.includes(motif.id) : selectedId === motif.id} className={(selectMotifsMode ? selectedMotifIds.includes(motif.id) : selectedId === motif.id) ? "motif-row selected" : "motif-row"} onActivate={() => { if (selectMotifsMode) toggleMotifSelection(motif.id); else { setSelectedId(motif.id); setSelectedCopy(null); } }}><img src={motif.src} alt="" /><span>{motif.name}</span></PencilButton>)}
              </div>
            </div>
            <div className="panel-section template-section">
              <p className="eyebrow">Use templates</p>
              <p className="helper">Choose a reference and arrange the Halloween motifs over it. Templates stay out of the repeat preview and downloads.</p>
              {guide && <div className="guide-controls">
                <div className="guide-toggle"><span>Show template</span><Switch checked={guide.visible} onCheckedChange={(checked) => updateGuide({ visible: checked })} aria-label="Show template" /></div>
                <label><span>Opacity</span><output>{guide.opacity}%</output><Slider value={[guide.opacity]} min={5} max={60} step={1} disabled={!guide.visible} onPointerDown={rememberChange} onValueChange={(value) => updateGuide({ opacity: value[0] }, false)} aria-label="Template opacity" /></label>
                <PencilButton type="button" className="remove-reference" onActivate={removeGuide}><Trash2 size={15} />Remove template</PencilButton>
              </div>}
              <div className="template-library-grid" aria-label="Demo templates">
                {LIBRARY_TEMPLATES.map((template) => (
                  <PencilButton type="button" key={template.id} aria-pressed={guide?.kind === "library" && guide.id === template.id} className={guide?.kind === "library" && guide.id === template.id ? "real-template active" : "real-template"} onActivate={() => chooseLibraryGuide(template)}>
                    <img src={template.src} alt="" loading="lazy" />
                    <span><strong>{template.name}</strong><small>Use as a reference</small></span>
                  </PencilButton>
                ))}
              </div>
            </div>
          </>
        </aside>

        <div className="editor-column">
        <section className={"canvas-area" + (interaction ? " editor-locked" : "") + (liveVerticalEdgeRepeat ? " edge-preview-active" : "")} style={{ "--edge-preview-space": edgePreviewPaddingY / editorHeight * 100 + "%" } as CSSProperties}>
          <div className="canvas-heading">
            <div><p className="eyebrow">{workflow === "motifs" ? "Tile editor" : "Source pattern"}</p><span>{workflow === "motifs" ? "Drag a motif across any edge—the opposite copy stays connected." : "Previewed smaller when needed; exported at its original dimensions."}</span></div>
            <div className="canvas-size">{canvasWidthPx} × {canvasHeightPx} px · {activeDpi} DPI</div>
          </div>
          <div className="measurement-bar">
            <div className="canvas-presets" aria-label="Canvas size">
              <span>Canvas</span>
              {CANVAS_PRESETS.map((size) => <button key={size} type="button" className={motifCanvas.width === size && motifCanvas.height === size ? "active" : ""} onClick={() => { setCustomCanvasInput(""); setCustomCanvasInvalid(false); chooseCanvasSize(size); }}>{size}</button>)}
              <form className={"custom-canvas-size" + (!isCanvasPreset(motifCanvas.width) ? " active" : "") + (customCanvasInvalid ? " invalid" : "")} onSubmit={(event) => { event.preventDefault(); applyCustomCanvasSize(); }}>
                <input
                  aria-label="Custom square canvas size in pixels"
                  aria-invalid={customCanvasInvalid}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Custom px"
                  title={`Enter ${MIN_CUSTOM_CANVAS_SIZE}–${MAX_CUSTOM_CANVAS_SIZE} px`}
                  value={customCanvasInput}
                  onChange={(event) => { setCustomCanvasInput(event.target.value.replace(/\D/g, "").slice(0, 4)); setCustomCanvasInvalid(false); }}
                />
                <button type="submit">Apply</button>
              </form>
            </div>
            <span className="print-size-label">Print size {formatPhysical(canvasWidthPx)} × {formatPhysical(canvasHeightPx)}</span>
            <div className="unit-switch" aria-label="Measurement unit"><button className={measurementUnit === "cm" ? "active" : ""} onClick={() => setMeasurementUnit("cm")}>cm</button><button className={measurementUnit === "in" ? "active" : ""} onClick={() => setMeasurementUnit("in")}>inches</button></div>
          </div>
          {workflow === "motifs" && (!cropSheet || cropTool === "move") && <div className="editor-zoom-controls" aria-label="Canvas zoom">
            <span>Canvas view</span>
            <button type="button" aria-label="Zoom out" disabled={editorViewport.zoom <= 1} onClick={() => zoomEditor(1 / 1.5)}>−</button>
            <output>{Math.round(editorViewport.zoom * 100)}%</output>
            <button type="button" aria-label="Zoom in" disabled={editorViewport.zoom >= 6} onClick={() => zoomEditor(1.5)}>+</button>
            <button type="button" disabled={editorViewport.zoom === 1} onClick={() => updateEditorViewport({ zoom: 1, panX: 0, panY: 0 })}>Fit</button>
            <small>Pinch with two fingers to zoom and move the view</small>
          </div>}
          {cropSheet && <div className="canvas-crop-controls" aria-label="Prepare motifs from clipart sheet">
          <header className="cropper-header">
            <div>
              <strong>{editingMotifId ? "Edit motif on the canvas" : "Prepare motifs on the canvas"}</strong>
              <span>{cropSheet.name} · {cropSheet.width} × {cropSheet.height} px</span>
            </div>
            <div className="cropper-count">{autoReviewIds !== null ? `${reviewPieces.length} detected` : `${croppedCount} ${croppedCount === 1 ? "motif" : "motifs"} added`}</div>
            <PencilButton type="button" className="cropper-close" disabled={reviewMerging} onActivate={autoReviewIds !== null ? cancelAutoReview : closeCropWorkspace} aria-label={autoReviewIds !== null ? "Discard auto separate preview" : "Close clipart cropper"}><X size={24} /></PencilButton>
          </header>
          <div className="cropper-tool-row" role="toolbar" aria-label="Crop and clean-up tools">
            <div className="cropper-tools">
              {!editingMotifId && <PencilButton type="button" className={cropTool === "move" ? "active" : ""} onActivate={() => chooseCropTool("move")} aria-pressed={cropTool === "move"}><MousePointer2 size={17} />Move</PencilButton>}
              {autoReviewIds === null && <PencilButton type="button" className={cropTool === "lasso" ? "active" : ""} onActivate={() => chooseCropTool("lasso")} aria-pressed={cropTool === "lasso"}><LassoSelect size={17} />Lasso</PencilButton>}
              {autoReviewIds === null && <PencilButton type="button" className={cropTool === "eraser" ? "active" : ""} onActivate={() => chooseCropTool("eraser")} aria-pressed={cropTool === "eraser"}><Eraser size={17} />Precision eraser</PencilButton>}
            </div>
            {!editingMotifId && autoReviewIds === null && <PencilButton type="button" className="auto-separate" disabled={autoSeparating || cropAdding} onActivate={() => void autoSeparateSheet()}>{autoSeparating ? "Separating…" : "Auto-separate"}</PencilButton>}
            {cropTool === "eraser" && <div className="eraser-options">
              <label htmlFor="eraser-size">Tip <output>{eraserSize} px</output></label>
              <input id="eraser-size" type="range" min="2" max="40" step="1" value={eraserSize} onChange={(event) => setEraserSize(Number(event.target.value))} />
              <PencilButton type="button" disabled={!eraseUndoCount} onActivate={undoLastErase}><Undo2 size={15} />Undo erase</PencilButton>
              <PencilButton type="button" onActivate={resetCropEdits}><RotateCcw size={15} />Restore sheet</PencilButton>
            </div>}
          </div>
          {!editingMotifId && autoReviewIds === null && <p className="auto-separate-note">Check the results. Close or connected parts may need a quick lasso adjustment.</p>}
          {autoReviewIds !== null && <section className="auto-review" aria-label="Review auto separated pieces">
            <div className="auto-review-heading"><strong>Review detected pieces</strong><span>Tap previews to select details. Move pieces on the canvas. Nothing is attached automatically.</span></div>
            {focusedReviewPiece && <div className="auto-review-focus"><img src={focusedReviewPiece.src} alt="Enlarged view of the focused piece" /><span>{focusedReviewPiece.name}<small>{focusedReviewPiece.sourceWidth} × {focusedReviewPiece.sourceHeight} px · enlarged preview on transparency</small></span></div>}
            <div className="auto-review-list">
              {reviewPieces.map((motif, index) => <PencilButton type="button" key={motif.id} className={selectedMotifIds.includes(motif.id) ? "auto-review-piece selected" : "auto-review-piece"} aria-pressed={selectedMotifIds.includes(motif.id)} onActivate={() => { toggleMotifSelection(motif.id); setSelectedId(motif.id); setSelectedCopy(null); }}>
                <img src={motif.src} alt="" /><span>Piece {index + 1}</span><small>{autoReviewKeptIds.includes(motif.id) ? "Keep separate" : `${motif.sourceWidth} × ${motif.sourceHeight} px`}</small>
              </PencilButton>)}
            </div>
            <div className="auto-review-actions">
              <span>{selectedMotifIds.length ? `${selectedMotifIds.length} selected · tap pieces to add or remove` : "Select a dot and the flower to attach them. Other pieces stay separate."}</span>
              <PencilButton type="button" disabled={reviewMerging || selectedMotifIds.length < 2} onActivate={() => void mergeSelectedMotifs()}>{reviewMerging ? "Attaching…" : "Attach selected"}</PencilButton>
              <PencilButton type="button" disabled={reviewMerging || !selectedMotifIds.length} onActivate={keepReviewSelection}>Keep separate</PencilButton>
              <PencilButton type="button" disabled={reviewMerging || !selectedMotifIds.length} onActivate={removeReviewSelection}>Remove selected</PencilButton>
            </div>
          </section>}
          <footer className="cropper-footer">
            <span>{cropMessage}</span>
            <div>
              <PencilButton type="button" className="cropper-undo" disabled={!cropUndoCount || reviewMerging} onActivate={undoLastCrop}><Undo2 size={16} />Undo last crop</PencilButton>
              {autoReviewIds === null && <PencilButton type="button" className="cropper-restart" disabled={!cropRect} onActivate={restartCropSelection}>Start again</PencilButton>}
              <PencilButton type="button" className="cropper-done" disabled={cropAdding || reviewMerging} onActivate={finishCropWorkspace}>{autoReviewIds !== null ? "Add reviewed motifs" : "Done"}</PencilButton>
              {autoReviewIds === null && <PencilButton type="button" className="cropper-add" disabled={!cropRect || cropRect.width < 3 || cropRect.height < 3 || cropAdding} onActivate={addCroppedMotif}><Scissors size={17} />{cropAdding ? "Adding…" : "Add motif"}</PencilButton>}
            </div>
          </footer>
          </div>}

          {workflow === "motifs" && (!cropSheet || cropTool === "move") && !selectMotifsMode && <div className="canvas-quick-actions" role="group" aria-label="Selected motif quick actions">
            <PencilButton type="button" disabled={!historyState.canUndo} aria-label="Undo last change" onActivate={undo}><Undo2 size={17} /><span>Undo</span></PencilButton>
            <PencilButton type="button" disabled={!selected} aria-label="Flip selected motif" onActivate={() => { if (selected) update({ flipX: !selected.flipX }); }}><FlipHorizontal2 size={17} /><span>Flip</span></PencilButton>
            <PencilButton type="button" disabled={!selected} aria-label="Duplicate selected motif" onActivate={duplicate}><Copy size={17} /><span>Duplicate</span></PencilButton>
            <PencilButton type="button" className="danger" disabled={!selected} aria-label="Delete selected motif" onActivate={remove}><Trash2 size={17} /><span>Delete</span></PencilButton>
          </div>}

          <div className={"canvas-measured" + (workflow === "motifs" && (!cropSheet || cropTool === "move") && editorViewport.zoom > 1 ? " zoomed" : "")}>
            <div className="ruler-corner">{measurementUnit}</div>
            <div className="ruler ruler-top">{horizontalTicks.map((tick, index) => <i key={index} className={tick.major ? "major" : ""} style={{ left: tick.position + "%" }}>{tick.major && <span>{Number(tick.value.toFixed(1))}</span>}</i>)}</div>
            <div className="ruler ruler-left">{verticalTicks.map((tick, index) => <i key={index} className={tick.major ? "major" : ""} style={{ top: tick.position + "%" }}>{tick.major && <span>{Number(tick.value.toFixed(1))}</span>}</i>)}</div>
            <div ref={editorViewportElementRef} className={"canvas-viewport" + (workflow === "motifs" && (!cropSheet || cropTool === "move") && editorViewport.zoom > 1 ? " zoomed" : "")}>
            <div className={"canvas-frame" + (liveEdgeRepeat ? " show-edge-preview" : "")} style={{ aspectRatio: canvasWidthPx + " / " + canvasHeightPx, transform: workflow === "motifs" && (!cropSheet || cropTool === "move") ? `translate(${editorViewport.panX}px, ${editorViewport.panY}px) scale(${editorViewport.zoom})` : undefined }}>
              <canvas
                ref={edgeRepeatRef}
                className="edge-repeat-layer"
                width={Math.round(edgePreviewWidth)}
                height={Math.round(edgePreviewHeight)}
                style={{
                  width: edgePreviewWidth / TILE * 100 + "%",
                  height: edgePreviewHeight / editorHeight * 100 + "%",
                  transform: "translate(" + (-edgePreviewPaddingX / edgePreviewWidth * 100) + "%," + (-edgePreviewPaddingY / edgePreviewHeight * 100) + "%)",
                }}
                aria-hidden="true"
              />
              {cropSheet && <div className={"cropper-stage canvas-crop-stage" + (cropTool === "move" ? " move-mode" : "") + (editingMotifId ? " editing-motif" : "")}>
            <canvas
              className={`crop-tool-${cropTool}`}
              ref={cropCanvasRef}
              onPointerDown={cropPointerDown}
              onPointerMove={cropPointerMove}
              onPointerUp={finishCropSelection}
              onPointerCancel={finishCropSelection}
              onLostPointerCapture={finishCropSelection}
              onPointerLeave={() => setEraserCursor(null)}
              onContextMenu={(event) => event.preventDefault()}
              aria-label={cropTool === "eraser" ? "Clipart sheet. Draw over details to erase them." : "Clipart sheet. Draw freely around one or more parts."}
            />
          </div>}
              <canvas className="editor-canvas" style={cropSheet ? { opacity: editingMotifId ? 0 : cropTool === "move" ? 1 : .45, pointerEvents: cropTool === "move" && !editingMotifId ? "auto" : "none" } : undefined} ref={editorRef} width={TILE} height={editorHeight} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishEditorInteraction} onPointerCancel={finishEditorInteraction} onLostPointerCapture={finishEditorInteraction} onContextMenu={(event) => event.preventDefault()} aria-label="Seamless pattern tile editor" />
            </div>
            </div>
          </div>
          <div className="statusbar"><span><i className="status-dot" />{status}</span><span>{workflow === "motifs" ? "Template excluded from preview and export" : "Original dimensions preserved"}</span></div>
        </section>

        <aside className="panel right-panel">
          <div className="right-panel-stack preview-stack">
          <div className="panel-section preview-panel">
            <p className="eyebrow">Repeat preview</p>
            <button className="repeat-frame" type="button" aria-label="Open repeat preview full screen" onClick={() => { repeatViewportRef.current = { zoom: 1, panX: 0, panY: 0 }; setPreviewControlsVisible(true); setPreviewOpen(true); }}>
              <canvas ref={repeatRef} width={600} height={600} />
              <span className="preview-expand"><Maximize2 size={15} />View large</span>
            </button>
            {previewOpen && typeof document !== "undefined" && createPortal(
              <div className="fullscreen-preview-overlay" role="dialog" aria-modal="true" aria-label="Full-screen repeat preview">
                <canvas ref={connectFullscreenCanvas} />
                {previewControlsVisible && <div className="repeat-zoom-controls" aria-label="Repeat preview zoom">
                  <button type="button" onClick={() => changeRepeatZoom(1 / 1.25)} aria-label="Zoom out">−</button>
                  <button type="button" onClick={() => changeRepeatZoom(0)}>Reset</button>
                  <button type="button" onClick={() => changeRepeatZoom(1.25)} aria-label="Zoom in">+</button>
                  <span>Pinch to zoom · Tap to hide controls</span>
                </div>}
                {previewControlsVisible && <button type="button" className="fullscreen-close" onClick={() => setPreviewOpen(false)} aria-label="Close full-screen preview"><X size={25} /></button>}
              </div>,
              document.body,
            )}
            <span className="preview-label">2 × 2 live repeat · Tap to enlarge</span>
          </div>
          <div className="panel-section export-panel">
            <p className="eyebrow">Export artwork</p>
            <fieldset className="export-field">
              <legend>File format</legend>
              <RadioGroup className="export-options format-options" value={exportFormat} onValueChange={(value) => {
                const format = value as ExportFormat;
                const wasJpeg = exportFormat === "jpeg";
                setExportFormat(format);
                if (format === "jpeg") setExportBackground("included");
                else if (wasJpeg) setExportBackground("transparent");
              }}>
                {(["png", "jpeg", "tiff"] as ExportFormat[]).map((format) => <div className="export-choice" key={format}><RadioGroupItem id={"format-" + format} value={format} /><label htmlFor={"format-" + format}>{format.toUpperCase()}</label></div>)}
              </RadioGroup>
            </fieldset>
            <fieldset className="export-field">
              <legend>Background</legend>
              <RadioGroup className="export-options background-options" disabled={exportFormat === "jpeg"} value={exportBackground} onValueChange={(value) => setExportBackground(value as ExportBackground)}>
                <div className="export-choice"><RadioGroupItem id="background-transparent" value="transparent" /><label htmlFor="background-transparent">Transparent</label></div>
                <div className="export-choice"><RadioGroupItem id="background-included" value="included" /><label htmlFor="background-included">Canvas color</label></div>
              </RadioGroup>
            </fieldset>
            {exportFormat === "jpeg" && <p className="format-note">JPEG always saves with the canvas color.</p>}
            <button className="panel-export-button" disabled={workflow === "finished" && !finishedPattern} onClick={exportArtwork}><Download size={17} />Save {exportFormat.toUpperCase()}</button>
            <p className="demo-watermark-note">Every demo motif carries a Vanya Illustrations watermark. Downloads keep the selected resolution and add a tile watermark.</p>
            <p className="helper">{canvasWidthPx} × {canvasHeightPx} px · {activeDpi} DPI · sRGB IEC61966-2.1{exportFormat === "tiff" ? " · TIFF files can be large" : ""}</p>
          </div>
          </div>
          <div className="right-panel-stack controls-stack">
          <div className="panel-section controls">
            <div className="section-heading"><p className="eyebrow">{workflow === "motifs" ? "Selected motif" : "Original pattern"}</p>{workflow === "motifs" && selected && <span>{selected.name}</span>}</div>
            {workflow === "motifs" && selected ? <>
              <div className="motif-print-size">W {formatPhysical(selectedPrintWidth)} × H {formatPhysical(selectedPrintHeight)}</div>
              <label>Size <output>{Math.round(selected.scale * 100)}%</output><input type="range" min=".2" max={selected.maxScale ?? 2.5} step=".01" value={Math.min(selected.scale, selected.maxScale ?? 2.5)} onPointerDown={rememberChange} onChange={(event) => update({ scale: Number(event.target.value) }, false)} /></label>
              {selected.maxScale !== undefined && <p className="size-quality-note">{selected.maxScale <= 1.001 ? "This artwork is already at its largest safe size" : `Quality protected · enlarge up to ${Math.round(selected.maxScale * 100)}%`}</p>}
              <label>Rotation <output>{Math.round(selected.rotation)}°</output><input type="range" min="-180" max="180" step="1" value={selected.rotation} onPointerDown={rememberChange} onChange={(event) => update({ rotation: Number(event.target.value) }, false)} /></label>
              <label>Motif opacity <output>{motifOpacity(selected)}%</output><input type="range" min="0" max="100" step="1" value={motifOpacity(selected)} onPointerDown={rememberChange} onChange={(event) => update({ opacity: Number(event.target.value) }, false)} /></label>
              {motifOpacity(selected) < 100 && <p className="opacity-export-note">This opacity will appear in your export.</p>}
              {motifs.length > 1 && <div className="layer-order-control">
                <div className="layer-order-heading"><strong>Layer order</strong><span>Choose what sits in front</span></div>
                <div className="layer-order-buttons">
                  <PencilButton type="button" disabled={!canMoveForward} onActivate={() => moveSelectedLayer("front")}><ChevronsUp size={17} />Bring to front</PencilButton>
                  <PencilButton type="button" disabled={!canMoveForward} onActivate={() => moveSelectedLayer("forward")}><ArrowUp size={17} />Move forward</PencilButton>
                  <PencilButton type="button" disabled={!canMoveBackward} onActivate={() => moveSelectedLayer("backward")}><ArrowDown size={17} />Move backward</PencilButton>
                  <PencilButton type="button" disabled={!canMoveBackward} onActivate={() => moveSelectedLayer("back")}><ChevronsDown size={17} />Send to back</PencilButton>
                </div>
              </div>}
              <div className="control-buttons">
                <div className="control-button-group"><strong>Edit motif</strong>
                  <button onClick={() => update({ flipX: !selected.flipX })}><FlipHorizontal2 size={17} />Flip</button>
                  <button onClick={() => update({ rotation: 0, scale: 1, flipX: false })}><RotateCcw size={17} />Reset</button>
                  <button onClick={duplicate}><Copy size={17} />Duplicate</button>
                  {selected.mergeParts?.length ? <button onClick={unmergeSelectedMotif}>Unmerge motifs</button> : null}
                  <button className="danger" onClick={remove}><Trash2 size={17} />Delete</button>
                </div>
                <div className="control-button-group"><strong>Place motif</strong>
                  <button className="placement-action" onClick={centerInFourCorners}><Crosshair size={17} />Center in 4 corners</button>
                  <button className="placement-action" onClick={placeInCentre}><Crosshair size={17} />Place in centre</button>
                  <button className="placement-action" onClick={placeTopAndBottom}><Crosshair size={17} />Place top &amp; bottom</button>
                  <button className="placement-action" onClick={placeLeftAndRight}><Crosshair size={17} />Place left &amp; right</button>
                </div>
              </div>
              <div className="multiply-control">
                <label><span>Additional copies</span><input type="number" min="1" max="20" value={multiplyCount} onChange={(event) => setMultiplyCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
                <button onClick={multiply}><Copy size={16} />Multiply</button>
              </div>
            </> : workflow === "motifs" ? <div className="empty-state">Select a motif on the tile or in the list.</div> : finishedPattern ? <div className="original-details"><strong>{finishedPattern.width} × {finishedPattern.height} px</strong><span>{formatPhysical(canvasWidthPx)} × {formatPhysical(canvasHeightPx)} at {activeDpi} DPI</span><small>Exports keep these pixel dimensions.</small></div> : <div className="empty-state">Upload a finished seamless pattern to begin.</div>}
          </div>
          <div className="panel-section color-section">
            <div className="background-color-heading">
              <div><p className="eyebrow">Background</p><span>{background.toUpperCase()}</span></div>
              <input aria-label="Background color" type="color" value={background} onPointerDown={rememberChange} onChange={(event) => chooseBackgroundColor(event.target.value)} />
            </div>
            <label className="background-hex-field" htmlFor="background-hex">
              <span>HEX color</span>
              <input
                ref={backgroundHexInputRef}
                id="background-hex"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                value={backgroundHexFocused ? backgroundHexInput : background.toUpperCase()}
                aria-invalid={backgroundHexInvalid}
                aria-describedby="background-hex-help"
                onFocus={(event) => {
                  const input = event.currentTarget;
                  backgroundHexEditRememberedRef.current = false;
                  setBackgroundHexInput(background.toUpperCase());
                  setBackgroundHexInvalid(false);
                  setBackgroundHexFocused(true);
                  input.select();
                  window.requestAnimationFrame(() => input.select());
                }}
                onChange={(event) => changeBackgroundHex(event.target.value)}
                onBlur={() => {
                  setBackgroundHexInput(background.toUpperCase());
                  setBackgroundHexInvalid(false);
                  setBackgroundHexFocused(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <small id="background-hex-help">Paste with or without #.</small>
            </label>
            <div className="background-adjustments">
              <label className="brightness-control">
                <span>Brightness</span>
                <output>{backgroundBrightness === 0 ? "Neutral" : `${Math.abs(backgroundBrightness)}% ${backgroundBrightness < 0 ? "darker" : "brighter"}`}</output>
                <Slider value={[backgroundBrightness]} min={-100} max={100} step={1} onPointerDown={rememberChange} onValueChange={(value) => changeBackgroundBrightness(value[0])} aria-label="Make background color darker or brighter" />
                <div className="adjustment-endpoints" aria-hidden="true"><span>Darker</span><span>Brighter</span></div>
              </label>
              <label>
                <span>Muted</span><output>{backgroundMuted}%</output>
                <Slider value={[backgroundMuted]} min={0} max={100} step={1} onPointerDown={rememberChange} onValueChange={(value) => changeBackgroundMuted(value[0])} aria-label="Make background color more muted" />
              </label>
              <label className="temperature-control">
                <span>Temperature</span>
                <output>{backgroundTemperature === 0 ? "Neutral" : `${Math.abs(backgroundTemperature)}% ${backgroundTemperature < 0 ? "cooler" : "warmer"}`}</output>
                <Slider value={[backgroundTemperature]} min={-100} max={100} step={1} onPointerDown={rememberChange} onValueChange={(value) => changeBackgroundTemperature(value[0])} aria-label="Make background color cooler or warmer" />
                <div className="adjustment-endpoints" aria-hidden="true"><span>Cooler</span><span>Warmer</span></div>
              </label>
            </div>
          </div>
          </div>
        </aside>
        </div>
      </section>
      {seamlessPngFile && <SeamlessPngDialog file={seamlessPngFile} hasArtwork={motifs.length > 0 || Boolean(finishedPattern)} onClose={() => setSeamlessPngFile(null)} onImport={importSeamlessPng} />}
      <AlertDialog open={freshConfirmOpen} onOpenChange={setFreshConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new pattern?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the current motifs and template from this device.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PencilDialogCancel onActivate={() => setFreshConfirmOpen(false)}>Cancel</PencilDialogCancel>
            <PencilDialogAction onActivate={() => void startFresh()}>Start fresh</PencilDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(recoveryCandidate)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Continue your last pattern?</AlertDialogTitle>
            <AlertDialogDescription>Your most recent artwork was saved on this device.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PencilDialogCancel onActivate={() => void startFresh()}>Start fresh</PencilDialogCancel>
            <PencilDialogAction onActivate={continueLastPattern}>Continue last pattern</PencilDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

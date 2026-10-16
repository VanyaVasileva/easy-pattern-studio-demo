'use client';
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { MAX_CUSTOM_CANVAS_SIZE, MIN_CUSTOM_CANVAS_SIZE } from './motif-rendering';
import { readPngDpi } from './png-resolution';
import { componentPixels, mergeWrappedComponents, type WrappedComponent } from './seamless-png';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/alert-dialog';
export type ImportedSeamlessPiece = { src: string; x: number; y: number; width: number; height: number; parts?: ImportedSeamlessPiece[] };
export type ImportedSeamlessPng = { name: string; size: number; dpi: number; pieces: ImportedSeamlessPiece[] };
type ReviewPiece = { id: number; part: WrappedComponent; src: string; children?: ReviewPiece[] };
function drawPart(data: Uint8ClampedArray, size: number, part: WrappedComponent) {
  const canvas = document.createElement('canvas'); canvas.width = part.width; canvas.height = part.height;
  canvas.getContext('2d')!.putImageData(new ImageData(componentPixels(data, size, size, part), part.width, part.height), 0, 0);
  return canvas.toDataURL('image/png');
}
function ImportAction({ onActivate, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onActivate: () => void }) {
  const activatedAt = useRef<number | null>(null);
  return <button {...props} onPointerDown={event => {
    if (event.pointerType === 'pen') { event.preventDefault(); event.stopPropagation(); }
  }} onPointerUp={event => {
    if (event.pointerType !== 'pen' || props.disabled) return;
    event.preventDefault(); event.stopPropagation(); activatedAt.current = performance.now(); onActivate();
  }} onClick={event => {
    if (props.disabled) return;
    if (activatedAt.current !== null && performance.now() - activatedAt.current < 600) { event.preventDefault(); activatedAt.current = null; return; }
    activatedAt.current = null; onActivate();
  }} />;
}
export function SeamlessPngDialog({ file, hasArtwork, onClose, onImport }: { file: File; hasArtwork: boolean; onClose: () => void; onImport: (tile: ImportedSeamlessPng) => void }) {
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ data: Uint8ClampedArray; size: number; dpi: number | null; src: string; parts: WrappedComponent[] } | null>(null);
  const [resolutionInput, setResolutionInput] = useState("300");
  const resolutionDpi = Number(resolutionInput);
  const validResolution = resolutionInput.trim() !== "" && Number.isInteger(resolutionDpi) && resolutionDpi >= 36 && resolutionDpi <= 2400;
  const [reviewing, setReviewing] = useState(false);
  const [reviewPieces, setReviewPieces] = useState<ReviewPiece[]>([]);
  const [reviewHistory, setReviewHistory] = useState<ReviewPiece[][]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [preparingReview, setPreparingReview] = useState(false);
  const nextId = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setReviewing(false); setReviewPieces([]); setReviewHistory([]); setSelected([]); setFocused(null);
    let active = true; let worker: Worker | undefined; let timeout: ReturnType<typeof setTimeout> | undefined; let url: string | undefined;
    setBusy(true); setError(''); setResult(null);
    const fail = (message: string) => { if (!active) return; setBusy(false); setError(message); worker?.terminate(); if (timeout) clearTimeout(timeout); };
    void (async () => {
      if (file.size > 40 * 1024 * 1024) throw new Error('Choose a transparent PNG smaller than 40 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) throw new Error('Only transparent PNG files are accepted. Remove the background beforehand and export your seamless tile as PNG.');
      const dpi = readPngDpi(bytes);
      const header = new DataView(bytes.buffer); const width = header.getUint32(16), height = header.getUint32(20);
      if (width !== height || width < MIN_CUSTOM_CANVAS_SIZE || width > MAX_CUSTOM_CANVAS_SIZE) throw new Error(`Choose an original square seamless PNG between ${MIN_CUSTOM_CANVAS_SIZE.toLocaleString('en-US')} and ${MAX_CUSTOM_CANVAS_SIZE.toLocaleString('en-US')} px.`);
      if (!active) return;
      const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
      url = URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' })); const image = new Image(); image.src = url; await image.decode();
      if (!active) return;
      const size = image.naturalWidth;
      if (size !== width || image.naturalHeight !== height) throw new Error('This PNG has inconsistent dimensions. Export a fresh copy and try again.');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!; ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, size, size).data;
      const src = canvas.toDataURL('image/png'); URL.revokeObjectURL(url); url = undefined;
      worker = new Worker(new URL('./seamless-png.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ error?: string; data: Uint8ClampedArray; parts: WrappedComponent[] }>) => {
        if (!active) return;
        if (event.data.error) { fail(event.data.error); return; }
        setResolutionInput(String(dpi ?? 300)); setResult({ data: event.data.data, size, dpi, src, parts: event.data.parts }); setBusy(false); worker?.terminate(); if (timeout) clearTimeout(timeout);
      };
      worker.onerror = () => fail('Could not reconnect the motifs on this device. Retry or use a smaller transparent tile.');
      timeout = setTimeout(() => fail('Reconnecting is taking too long. Retry or use a smaller transparent tile.'), 45000);
      // Transfer ownership so large PNGs are not copied between threads.
      worker.postMessage({ data, size }, [data.buffer]);
    })().catch(error => fail(error instanceof Error ? error.message : 'Could not read this transparent PNG.'));
    return () => { active = false; worker?.terminate(); if (timeout) clearTimeout(timeout); if (url) URL.revokeObjectURL(url); };
  }, [file, retry]);
  const openReview = async () => {
    if (!result || preparingReview) return;
    setPreparingReview(true); setError('');
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!alive.current) return;
      const pieces = result.parts.map(part => ({ id: nextId.current++, part, src: drawPart(result.data, result.size, part) }));
      setReviewPieces(pieces); setReviewHistory([]); setSelected([]); setFocused(pieces[0]?.id ?? null); setReviewing(true);
    } catch { setError('Could not prepare the review. Try a smaller transparent tile.'); }
    finally { if (alive.current) setPreparingReview(false); }
  };
  const changeReview = (pieces: ReviewPiece[]) => {
    setReviewHistory(history => [...history, reviewPieces]); setReviewPieces(pieces); setSelected([]);
    setFocused(pieces[0]?.id ?? null); setError('');
  };
  const attachSelected = () => {
    if (!result || selected.length < 2) return;
    try {
      const chosen = reviewPieces.filter(piece => selected.includes(piece.id));
      const part = mergeWrappedComponents(chosen.map(piece => piece.part), result.size, result.size);
      const merged: ReviewPiece = { id: nextId.current++, part, src: drawPart(result.data, result.size, part), children: chosen };
      const last = Math.max(...reviewPieces.map((piece, i) => selected.includes(piece.id) ? i : -1));
      changeReview(reviewPieces.flatMap((piece, i) => i === last ? [merged] : selected.includes(piece.id) ? [] : [piece]));
      setFocused(merged.id);
    } catch { setError('Could not attach these pieces. Your review is unchanged.'); }
  };
  const undoReview = () => {
    const previous = reviewHistory.at(-1); if (!previous) return;
    setReviewPieces(previous); setReviewHistory(history => history.slice(0, -1)); setSelected([]); setFocused(previous[0]?.id ?? null); setError('');
  };
  const apply = () => {
    if (!result || !validResolution || (reviewing && !reviewPieces.length)) return;
    try {
      const materialize = (piece: ReviewPiece): ImportedSeamlessPiece => ({
        src: piece.src, x: (piece.part.x + piece.part.width / 2) % result.size,
        y: (piece.part.y + piece.part.height / 2) % result.size, width: piece.part.width, height: piece.part.height,
        ...(piece.children ? { parts: piece.children.map(materialize) } : {}),
      });
      const pieces = reviewing ? reviewPieces.map(materialize) : result.parts.map(part => ({
        src: drawPart(result.data, result.size, part), x: (part.x + part.width / 2) % result.size,
        y: (part.y + part.height / 2) % result.size, width: part.width, height: part.height,
      }));
      onImport({ name: file.name.replace(/\.[^.]+$/, ''), size: result.size, dpi: resolutionDpi, pieces });
    } catch { setError('Could not prepare the editable motifs. Try a smaller transparent tile.'); }
  };
  const focusPiece = reviewPieces.find(piece => piece.id === focused) || reviewPieces[0];
  // Open once the complete preview is ready. Rendering a partial modal during
  // decoding made it look as though a second, older dialog opened first.
  if (!result && !error) return null;
  return <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}><AlertDialogContent className="seamless-import-dialog" style={{ maxWidth: reviewing ? 780 : 560, maxHeight: '90dvh', overflowY: 'auto' }}>
    <AlertDialogHeader><AlertDialogTitle>Import seamless pattern</AlertDialogTitle><AlertDialogDescription>Upload a seamless PNG with the background already removed. Motifs crossing edges and corners are reconnected automatically and keep their original positions and sizes.</AlertDialogDescription></AlertDialogHeader>
    {result && !reviewing && <><div style={{ backgroundColor: '#ddd', backgroundImage: 'conic-gradient(#fff 25%,transparent 0 50%,#fff 0 75%,transparent 0)', backgroundSize: '20px 20px' }}><img src={result.src} alt="Transparent seamless pattern ready to edit" style={{ width: '100%', maxHeight: '40dvh', objectFit: 'contain' }} /></div><p>{result.size} × {result.size} px · {result.parts.length} editable pieces</p><p className="helper">Use the pattern directly, or review whole motifs first to attach, keep or remove pieces.</p></>}
    {result && <div className="import-print-resolution">
      <label htmlFor="seamless-import-dpi">Print resolution (DPI)<input id="seamless-import-dpi" type="number" inputMode="numeric" min="36" max="2400" step="1" value={resolutionInput} aria-invalid={!validResolution} onChange={event => setResolutionInput(event.target.value)} /></label>
      <p className="helper">{result.dpi !== null ? `PNG resolution: ${result.dpi} DPI. Original pixels are preserved.` : 'No usable DPI metadata found. 300 DPI is the default; enter the original print resolution if known.'}</p>
      <p className="helper">{validResolution ? `Print size: ${(result.size / resolutionDpi * 2.54).toFixed(2)} × ${(result.size / resolutionDpi * 2.54).toFixed(2)} cm. DPI changes print size, not pixel detail.` : 'Enter a whole-number DPI from 36 to 2,400.'}</p>
    </div>}
    {result && reviewing && <section className="auto-review" aria-label="Review seamless pattern motifs">
      <div className="auto-review-heading"><strong>Review detected pieces</strong><span>Border motifs appear whole here. Positions and sizes stay unchanged on the pattern.</span></div>
      {focusPiece && <div className="auto-review-focus"><img src={focusPiece.src} alt="Complete selected motif, including reconnected border pieces" /><span>Piece {reviewPieces.indexOf(focusPiece) + 1}<small>{focusPiece.part.width} × {focusPiece.part.height} px</small></span></div>}
      <div className="auto-review-list">{reviewPieces.map((piece, index) => <ImportAction key={piece.id} type="button" className={selected.includes(piece.id) ? 'auto-review-piece selected' : 'auto-review-piece'} aria-pressed={selected.includes(piece.id)} onActivate={() => {
        setSelected(current => current.includes(piece.id) ? current.filter(id => id !== piece.id) : [...current, piece.id]); setFocused(piece.id);
      }}><img src={piece.src} alt="" /><span>Piece {index + 1}</span><small>{piece.children ? `${piece.children.length} pieces attached` : `${piece.part.width} × ${piece.part.height} px`}</small></ImportAction>)}</div>
      <div className="auto-review-actions"><span>{selected.length ? `${selected.length} selected · tap pieces to add or remove` : 'Select pieces to attach, keep only selected, or remove.'}</span>
        <ImportAction type="button" disabled={selected.length < 2} onActivate={attachSelected}>Attach selected</ImportAction>
        <ImportAction type="button" disabled={!selected.length} onActivate={() => changeReview(reviewPieces.filter(piece => selected.includes(piece.id)))}>Keep selected</ImportAction>
        <ImportAction type="button" disabled={!selected.length} onActivate={() => changeReview(reviewPieces.filter(piece => !selected.includes(piece.id)))}>Remove selected</ImportAction>
        <ImportAction type="button" disabled={!reviewHistory.length} onActivate={undoReview}>Undo review change</ImportAction>
      </div><p className="helper">Keep selected keeps only the chosen motifs. Undo restores the previous preview.</p><p className="helper">{reviewPieces.length} {reviewPieces.length === 1 ? 'motif' : 'motifs'} will be added in the original layout. Attached pieces move as one motif.</p>
    </section>}
    <p role="status" aria-live="polite">{busy ? 'Connecting motifs across the borders…' : result ? 'Ready to open on the editing canvas.' : ''}</p>
    {error && <p role="alert">{error}</p>}
    {hasArtwork && <p>This opens a new pattern in place of the current artwork. Undo restores your previous canvas.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><ImportAction type="button" className="upload-button" onActivate={onClose}>Cancel</ImportAction>{error && <ImportAction type="button" className="upload-button" disabled={busy} onActivate={() => setRetry(value => value + 1)}>Retry</ImportAction>}{!reviewing && <ImportAction type="button" className="upload-button" disabled={!result || busy || preparingReview} onActivate={() => void openReview()}>{preparingReview ? 'Preparing review…' : 'Review motifs'}</ImportAction>}<ImportAction type="button" className="upload-button" disabled={!result || !validResolution || busy || preparingReview || (reviewing && !reviewPieces.length)} onActivate={apply}>{reviewing ? 'Add reviewed motifs' : 'Use editable pattern'}</ImportAction></div>
  </AlertDialogContent></AlertDialog>;
}

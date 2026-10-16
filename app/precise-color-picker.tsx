import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampUnit, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type Hsv, type Rgb } from "./color-model";

type Props = { value: string; onChange: (hex: string) => void; onBegin: () => void };

export function PreciseColorPicker({ value, onChange, onBegin }: Props) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value)));
  const [editing, setEditing] = useState<keyof Rgb | null>(null);
  const [draft, setDraft] = useState("");
  const lastEmitted = useRef(value.toLowerCase());
  const fieldRemembered = useRef(false);
  const id = useId();
  const rgb = hexToRgb(value);

  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current) return;
    const next = rgbToHsv(hexToRgb(value));
    setHsv(current => ({ ...next, h: next.s === 0 ? current.h : next.h }));
    lastEmitted.current = value.toLowerCase();
  }, [value]);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next));
    lastEmitted.current = hex;
    onChange(hex);
  };
  const selectAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    emit({ ...hsv, s: clampUnit((event.clientX - rect.left) / rect.width), v: 1 - clampUnit((event.clientY - rect.top) / rect.height) });
  };
  const selectWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? .1 : .01;
    const next = { ...hsv };
    if (event.key === "ArrowRight") next.s = clampUnit(next.s + step);
    else if (event.key === "ArrowLeft") next.s = clampUnit(next.s - step);
    else if (event.key === "ArrowUp") next.v = clampUnit(next.v + step);
    else if (event.key === "ArrowDown") next.v = clampUnit(next.v - step);
    else if (event.key === "Home") next.s = 0;
    else if (event.key === "End") next.s = 1;
    else return;
    event.preventDefault(); onBegin(); emit(next);
  };

  return <div className="precise-color-picker">
    <button type="button" className="precise-color-trigger" aria-label="Background color picker" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <i style={{ backgroundColor: value }} aria-hidden="true" />
      <span>{open ? "Close color picker" : "Choose a color"}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div id={id} className="precise-color-controls" role="group" aria-label="Precise background color picker">
      <div className="precise-color-area" role="slider" tabIndex={0} aria-label="Color selection area" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s*100)} aria-valuetext={`${Math.round(hsv.s*100)}% saturation, ${Math.round(hsv.v*100)}% brightness`} aria-describedby={id+"-hint"}
        style={{ backgroundColor: `hsl(${hsv.h},100%,50%)` }}
        onPointerDown={event => { if (event.button !== 0 && event.pointerType === "mouse") return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); onBegin(); selectAt(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) selectAt(event); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={selectWithKeys}>
        <i className="precise-color-cursor" style={{ left: `${hsv.s*100}%`, top: `${(1-hsv.v)*100}%`, backgroundColor: value }} />
      </div>
      <p id={id+"-hint"} className="precise-color-hint">Drag to choose a shade. Arrow keys fine-tune it.</p>
      <label className="precise-hue-label"><span>Hue</span><output>{Math.round(hsv.h)}°</output>
        <input aria-label="Color hue" className="precise-hue-slider" type="range" min="0" max="360" step="1" value={hsv.h} onPointerDown={onBegin} onKeyDown={event => { if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(event.key)) onBegin(); }} onChange={event => emit({ ...hsv, h: Number(event.target.value) })} />
      </label>
      <div className="precise-rgb-fields" role="group" aria-label="RGB color values">
        {(["r","g","b"] as const).map(channel => <label key={channel}><span>{channel.toUpperCase()}</span>
          <input aria-label={{r:"Red",g:"Green",b:"Blue"}[channel]} type="number" inputMode="numeric" min="0" max="255" step="1" value={editing === channel ? draft : rgb[channel]}
            onFocus={event => { setEditing(channel); setDraft(String(rgb[channel])); fieldRemembered.current = false; event.currentTarget.select(); }}
            onChange={event => { const raw = event.target.value; setDraft(raw); if (!/^\d{1,3}$/.test(raw) || Number(raw)>255) return; const next = { ...rgb, [channel]: Number(raw) }; if (!fieldRemembered.current) { onBegin(); fieldRemembered.current = true; } const converted = rgbToHsv(next); const hex = rgbToHex(next); setHsv({ ...converted, h: converted.s === 0 ? hsv.h : converted.h }); lastEmitted.current = hex; onChange(hex); }}
            onBlur={() => setEditing(null)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>)}
      </div>
      <button type="button" className="precise-color-done" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </div>;
}

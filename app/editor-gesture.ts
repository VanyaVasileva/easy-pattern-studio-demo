const MOTIF_DRAG_THRESHOLD_PX = 7;
const PENCIL_DRAG_THRESHOLD_PX = 2;
const PENCIL_DRAG_COMMIT_THRESHOLD_PX = 6;

export function motifDragThreshold(pointerType: string) {
  return pointerType === "pen" ? PENCIL_DRAG_THRESHOLD_PX : MOTIF_DRAG_THRESHOLD_PX;
}

export function motifDragCommitThreshold(pointerType: string) {
  return pointerType === "pen" ? PENCIL_DRAG_COMMIT_THRESHOLD_PX : MOTIF_DRAG_THRESHOLD_PX;
}

export function shouldCommitMotifDrag(pointerType: string, distance: number) {
  return distance >= motifDragCommitThreshold(pointerType);
}

export function shouldDeselectCanvasOnPointerDown(pointerType: string, hasMotifHit: boolean) {
  return !hasMotifHit && pointerType !== "touch";
}

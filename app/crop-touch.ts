export type CropTouchTool = "move" | "lasso" | "eraser";
export type CropTouchIntent = "draw" | "navigate";

export function cropTouchIntent(
  tool: CropTouchTool,
  activeTouches: number,
  navigationActive: boolean,
): CropTouchIntent {
  if (navigationActive || activeTouches >= 2 || tool === "move") return "navigate";
  return "draw";
}

export function cropToolInstruction(tool: CropTouchTool) {
  if (tool === "move") return "Move motifs on this canvas · choose Lasso to select more pieces";
  if (tool === "eraser") return "Erase with one finger, Apple Pencil, or mouse · pinch with two fingers to zoom";
  return "Draw around one or more parts · pinch with two fingers to zoom";
}

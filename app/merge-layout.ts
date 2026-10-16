export type MergedTransform = {
  x: number; y: number; width: number; height: number; scale: number;
  rotation: number; flipX: boolean; opacity: number;
};

export function positionUnmergedPart(
  merged: MergedTransform,
  part: { offsetX: number; offsetY: number; rotation: number; scale: number; flipX: boolean; opacity: number },
  tileWidth: number,
  tileHeight: number,
) {
  const radians = merged.rotation * Math.PI / 180;
  const dx = part.offsetX * merged.width * merged.scale * (merged.flipX ? -1 : 1);
  const dy = part.offsetY * merged.height * merged.scale;
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  return {
    x: wrap(merged.x + dx * Math.cos(radians) - dy * Math.sin(radians), tileWidth),
    y: wrap(merged.y + dx * Math.sin(radians) + dy * Math.cos(radians), tileHeight),
    rotation: ((merged.rotation + (merged.flipX ? -part.rotation : part.rotation) + 540) % 360) - 180,
    flipX: merged.flipX !== part.flipX,
    scale: part.scale * merged.scale,
    opacity: Math.max(0, Math.min(100, part.opacity * merged.opacity / 100)),
  };
}

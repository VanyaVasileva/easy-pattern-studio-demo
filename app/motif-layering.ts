export type LayerMove = "forward" | "backward" | "front" | "back";

export function reorderMotifLayer<T extends { id: string }>(items: T[], id: string, move: LayerMove): T[] {
  const currentIndex = items.findIndex((item) => item.id === id);
  if (currentIndex < 0) return items;

  const lastIndex = items.length - 1;
  const targetIndex = move === "front"
    ? lastIndex
    : move === "back"
      ? 0
      : move === "forward"
        ? Math.min(lastIndex, currentIndex + 1)
        : Math.max(0, currentIndex - 1);

  if (targetIndex === currentIndex) return items;

  const reordered = [...items];
  const [motif] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, motif);
  return reordered;
}

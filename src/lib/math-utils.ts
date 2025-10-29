export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function percentage(value: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.round((value / total) * 100));
}

export function bounded(
  value: number,
  constraint: { min?: number; max?: number },
): number {
  const { min = -Infinity, max = Infinity } = constraint;
  return clamp(value, min, max);
}

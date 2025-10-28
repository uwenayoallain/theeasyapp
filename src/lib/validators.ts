export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed);
}

export function isValidNumber(value: string | number): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const normalized = value.replace(/[,_\s]/g, "");
  if (!normalized) return false;
  const num = Number(normalized);
  return Number.isFinite(num);
}

export function parseNumber(value: string): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[,_\s]/g, "");
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function isExcelFile(filename: string): boolean {
  if (!filename || typeof filename !== "string") return false;
  const ext = filename.toLowerCase().split(".").pop();
  return ext === "xlsx" || ext === "xls";
}

export function isCSVFile(filename: string): boolean {
  if (!filename || typeof filename !== "string") return false;
  const ext = filename.toLowerCase().split(".").pop();
  return ext === "csv" || ext === "tsv";
}

export function isSupportedFile(filename: string): boolean {
  return isCSVFile(filename) || isExcelFile(filename);
}

export function caseInsensitiveIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function normalizeWhitespace(str: string): string {
  return str.trim().replace(/\s+/g, " ");
}

export function stripQuotes(value: string): string {
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return inner.replace(/\\(["'\\])/g, "$1");
  }
  return value;
}

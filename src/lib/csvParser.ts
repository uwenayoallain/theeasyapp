import type { ColumnDef } from "./csv";

export interface ParsedCSV {
  columns: ColumnDef[];
  rows: string[][];
}

export function parseCSV(text: string): ParsedCSV {
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const row: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    row.push(current);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  const columns: ColumnDef[] = headers.map((name) => ({
    name: name.trim(),
    width: 160,
  }));

  return { columns, rows };
}

export async function fetchAndParseCSV(url: string): Promise<ParsedCSV> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.statusText}`);
  }

  const text = await response.text();
  return parseCSV(text);
}

export async function parseCSVFile(file: File): Promise<ParsedCSV> {
  const text = await file.text();
  return parseCSV(text);
}

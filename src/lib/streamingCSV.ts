export type CSVBatch = string[][];

export interface StreamProgress {
  loaded: number;
  total?: number;
}

export interface ParseStreamOptions {
  batchSize?: number;
  totalBytes?: number;
  onColumns?: (cols: string[]) => void;
  onRows?: (rows: CSVBatch) => void;
  onProgress?: (p: StreamProgress) => void;
}

export async function parseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: ParseStreamOptions
) {
  const decoder = new TextDecoder();
  const batchSize = options.batchSize ?? 2000;
  let loaded = 0;

  let carry = ""; // leftover from previous chunk
  let inQuotes = false;
  let headerParsed = false;
  let columns: string[] = [];
  const batch: string[][] = [];

  const flushBatch = () => {
    if (batch.length > 0) {
      options.onRows?.(batch.splice(0, batch.length));
    }
  };

  const emitProgress = () => {
    options.onProgress?.({ loaded, total: options.totalBytes });
  };

  const parseLine = (line: string): string[] => {
    const row: string[] = [];
    let field = "";
    let i = 0;
    inQuotes = false;

    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    return row;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    emitProgress();

    const chunkText = decoder.decode(value, { stream: true });
    let text = carry + chunkText;
    carry = "";

    // Split into lines but preserve trailing partial
    const lines = text.split(/\r?\n/);
    if (lines.length > 0) {
      carry = lines.pop() ?? "";
    }

    for (const rawLine of lines) {
      if (!headerParsed) {
        columns = parseLine(rawLine);
        headerParsed = true;
        options.onColumns?.(columns);
        continue;
      }
      if (!rawLine) continue;
      batch.push(parseLine(rawLine));
      if (batch.length >= batchSize) flushBatch();
    }
  }

  // Finalize any remaining decoded text
  if (carry) {
    if (!headerParsed) {
      const header = parseLine(carry);
      options.onColumns?.(header);
    } else if (!inQuotes) {
      batch.push(parseLine(carry));
    }
  }

  flushBatch();
  options.onProgress?.({ loaded, total: options.totalBytes });
}

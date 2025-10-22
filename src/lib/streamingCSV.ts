export type CSVBatch = string[][];

export interface StreamProgress {
  loaded: number;
  total?: number;
}

export interface ParseStreamOptions {
  batchSize?: number;
  totalBytes?: number;
  onColumns?: (cols: string[]) => void;
  onRows?: (rows: CSVBatch) => void | Promise<void>;
  onProgress?: (p: StreamProgress) => void;
  signal?: AbortSignal;
}

export async function parseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: ParseStreamOptions,
) {
  const decoder = new TextDecoder();
  const batchSize = options.batchSize ?? 2000;
  let loaded = 0;

  let carry = "";
  let inQuotes = false;
  let headerParsed = false;
  let columns: string[] = [];
  const batch: string[][] = [];

  const throwIfAborted = () => {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  };

  const flushBatch = async () => {
    if (batch.length > 0) {
      throwIfAborted();
      const rowsToSend = batch.splice(0, batch.length);
      await options.onRows?.(rowsToSend);
    }
  };

  const emitProgress = () => {
    options.onProgress?.({ loaded, total: options.totalBytes });
  };

  const parseLine = (line: string): string[] => {
    const row: string[] = [];
    let field = "";
    let i = 0;
    let q = false;

    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        q = !q;
        i++;
        continue;
      }
      if (ch === "," && !q) {
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

  let doneReading = false;
  while (!doneReading) {
    throwIfAborted();
    const { value, done } = await reader.read();
    if (done) {
      doneReading = true;
      continue;
    }
    loaded += value.byteLength;
    emitProgress();

    const text = decoder.decode(value, { stream: true });
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      carry += ch;
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          carry += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === "\n") {
        const record = carry.endsWith("\r\n")
          ? carry.slice(0, -2)
          : carry.slice(0, -1);
        if (record.length > 0 || headerParsed) {
          if (!headerParsed) {
            columns = parseLine(record);
            headerParsed = true;
            options.onColumns?.(columns);
          } else {
            batch.push(parseLine(record));
            if (batch.length >= batchSize) await flushBatch();
          }
        }
        carry = "";
      }
    }
  }

  if (carry && !inQuotes) {
    if (!headerParsed) {
      const header = parseLine(carry);
      options.onColumns?.(header);
    } else {
      batch.push(parseLine(carry));
    }
  }

  await flushBatch();
  options.onProgress?.({ loaded, total: options.totalBytes });
}

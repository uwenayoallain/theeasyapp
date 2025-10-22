#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rows = Number(Bun.argv[2] ?? 200_000);
const cols = Number(Bun.argv[3] ?? 25);

const header =
  Array.from({ length: cols }, (_, i) => `col_${i + 1}`).join(",") + "\n";
const dir = new URL("../src/data/", import.meta.url);
const dirPath = fileURLToPath(dir);
await mkdir(dirPath, { recursive: true });
const out = new URL("../src/data/sample.csv", import.meta.url);
const outPath = fileURLToPath(out);

const file = Bun.file(outPath);
const writer = file.writer();
await writer.write(header);
for (let r = 0; r < rows; r++) {
  const line =
    Array.from({ length: cols }, (_, c) =>
      Math.random() < 0.4
        ? Math.floor(Math.random() * 1e6)
        : `"v${r}_${c}_${Math.random().toString(36).slice(2, 8)}"`,
    ).join(",") + "\n";
  await writer.write(line);
}
await writer.end();
console.log("Wrote:", outPath);

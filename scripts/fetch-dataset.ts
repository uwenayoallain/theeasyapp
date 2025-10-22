#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const argEntries = Bun.argv
  .slice(2)
  .map((arg) => {
    const [rawKey, rawValue] = arg.split("=", 2);
    if (!rawKey) return null;
    const key = rawKey.replace(/^--/, "");
    const value = rawValue ?? "";
    return key ? ([key, value] as const) : null;
  })
  .filter((entry): entry is readonly [string, string] => entry !== null);

const args = Object.fromEntries(argEntries);

const url =
  args.url?.trim() && args.url.trim().length > 0
    ? args.url.trim()
    : "https://data.cityofnewyork.us/resource/erm2-nwe9.csv?$limit=150000";
const out = new URL("../src/data/sample.csv", import.meta.url);
const outPath = fileURLToPath(out);

await mkdir(path.dirname(outPath), { recursive: true });

const response = await fetch(url);
if (!response.ok) throw new Error(`HTTP ${response.status}`);

await Bun.write(outPath, response);
console.log("Wrote:", outPath);

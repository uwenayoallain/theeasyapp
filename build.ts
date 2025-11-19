#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { rm, readFile, writeFile } from "fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import path from "path";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
🏗️  Bun Build Script

Usage: bun run build.ts [options]

Common Options:
  --outdir <path>          Output directory (default: "dist")
  --minify                 Enable minification (or --minify.whitespace, --minify.syntax, etc)
  --sourcemap <type>      Sourcemap type: none|linked|inline|external
  --target <target>        Build target: browser|bun|node
  --format <format>        Output format: esm|cjs|iife
  --splitting              Enable code splitting
  --packages <type>        Package handling: bundle|external
  --public-path <path>     Public path for assets
  --env <mode>             Environment handling: inline|disable|prefix*
  --conditions <list>      Package.json export conditions (comma separated)
  --external <list>        External packages (comma separated)
  --banner <text>          Add banner text to output
  --footer <text>          Add footer text to output
  --define <obj>           Define global constants (e.g. --define.VERSION=1.0.0)
  --help, -h               Show this help message

Example:
  bun run build.ts --outdir=dist --minify --sourcemap=linked --external=react,react-dom
`);
  process.exit(0);
}

const toCamelCase = (str: string): string =>
  str.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());

const parseValue = (value: string): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;

  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d*\.\d+$/.test(value)) return parseFloat(value);

  if (value.includes(",")) return value.split(",").map((v) => v.trim());

  return value;
};

function parseArgs(): Partial<Bun.BuildConfig> {
  const config: Record<string, unknown> = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) continue;

    if (arg.startsWith("--no-")) {
      const key = toCamelCase(arg.slice(5));
      config[key] = false;
      continue;
    }

    if (
      !arg.includes("=") &&
      (i === args.length - 1 || args[i + 1]?.startsWith("--"))
    ) {
      const key = toCamelCase(arg.slice(2));
      config[key] = true;
      continue;
    }

    let key: string;
    let value: string;

    if (arg.includes("=")) {
      [key, value] = arg.slice(2).split("=", 2) as [string, string];
    } else {
      key = arg.slice(2);
      value = args[++i] ?? "";
    }

    key = toCamelCase(key);

    if (key.includes(".")) {
      const [parentKeyRaw, childKeyRaw] = key.split(".", 2);
      if (!parentKeyRaw || !childKeyRaw) continue;
      const parentKey = parentKeyRaw;
      const childKey = childKeyRaw;
      const parent = (config[parentKey] ?? {}) as Record<string, unknown>;
      parent[childKey] = parseValue(value);
      config[parentKey] = parent;
    } else {
      config[key] = parseValue(value);
    }
  }

  return config as Partial<Bun.BuildConfig>;
}

const formatFileSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

console.log("\n🚀 Starting build process...\n");

type BuildCliConfig = Partial<Bun.BuildConfig> & { compress?: boolean };

const cliConfig: BuildCliConfig = parseArgs();
const outdir =
  typeof cliConfig.outdir === "string" && cliConfig.outdir.length > 0
    ? cliConfig.outdir
    : path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  console.log(`🗑️ Cleaning previous build at ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = [...new Bun.Glob("**.html").scanSync("src")]
  .map((a) => path.resolve("src", a))
  .filter((dir) => !dir.includes("node_modules"));
console.log(
  `📄 Found ${entrypoints.length} HTML ${entrypoints.length === 1 ? "file" : "files"} to process\n`,
);

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [plugin],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  ...cliConfig,
});

// Build the CSV worker as a separate asset for production
const workerOutDir = path.join(outdir, "workers");
const workerResult = await Bun.build({
  entrypoints: [path.resolve("src", "workers/csvWorker.ts")],
  outdir: workerOutDir,
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
});

const end = performance.now();

const outputTable = [...result.outputs, ...workerResult.outputs].map(
  (output) => ({
    File: path.relative(process.cwd(), output.path),
    Type: output.kind,
    Size: formatFileSize(output.size),
  }),
);

console.table(outputTable);
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);

const shouldCompressAssets =
  process.env.NODE_ENV === "production" || Boolean(cliConfig.compress);

if (shouldCompressAssets) {
  console.log("🗜️  Compressing static assets...");
  const assetsToCompress = [...result.outputs, ...workerResult.outputs].filter(
    (output) => output.kind === "entry-point" || output.kind === "chunk",
  );

  let compressed = 0;
  for (const asset of assetsToCompress) {
    try {
      const content = await readFile(asset.path);

      const gzipped = gzipSync(content, { level: 9 });
      await writeFile(`${asset.path}.gz`, gzipped);

      const brotli = brotliCompressSync(content, {
        params: {
          [0]: 11,
        },
      });
      await writeFile(`${asset.path}.br`, brotli);

      compressed++;
      console.log(`  ✓ ${path.relative(process.cwd(), asset.path)}`);
    } catch (err) {
      console.warn(`  ✗ Failed to compress ${asset.path}:`, err);
    }
  }
  console.log(`✅ Compressed ${compressed} asset(s)\n`);
}

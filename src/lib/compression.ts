import { gzipSync, brotliCompressSync } from "node:zlib";

export function compressResponse(
  data: string | Uint8Array,
  acceptEncoding: string | null,
): { data: Buffer; encoding: string | null } {
  const dataStr =
    typeof data === "string" ? data : new TextDecoder().decode(data);
  const dataBuffer = Buffer.from(dataStr);

  if (!acceptEncoding) {
    return { data: dataBuffer, encoding: null };
  }

  const encodings = acceptEncoding.toLowerCase();

  if (encodings.includes("br")) {
    return {
      data: brotliCompressSync(dataBuffer, {
        params: {
          [0]: 4,
        },
      }),
      encoding: "br",
    };
  }

  if (encodings.includes("gzip")) {
    return {
      data: gzipSync(dataBuffer, { level: 6 }),
      encoding: "gzip",
    };
  }

  return { data: dataBuffer, encoding: null };
}

export function shouldCompress(path: string, size?: number): boolean {
  if (path.startsWith("/api/")) {
    return size === undefined || size > 1024;
  }

  if (path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".html")) {
    return true;
  }

  return false;
}

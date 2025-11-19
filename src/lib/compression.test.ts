import { describe, it, expect } from "bun:test";
import { compressResponse, shouldCompress } from "./compression";

describe("compressResponse", () => {
  it("should compress with brotli when supported", () => {
    const data = "x".repeat(10000);
    const result = compressResponse(data, "br, gzip");

    expect(result.encoding).toBe("br");
    expect(result.data.byteLength).toBeLessThan(data.length);
  });

  it("should compress with gzip when brotli not supported", () => {
    const data = "x".repeat(10000);
    const result = compressResponse(data, "gzip");

    expect(result.encoding).toBe("gzip");
    expect(result.data.byteLength).toBeLessThan(data.length);
  });

  it("should not compress when no encoding accepted", () => {
    const data = "test data";
    const result = compressResponse(data, null);

    expect(result.encoding).toBeNull();
  });

  it("should handle ArrayBuffer input", () => {
    const text = "test data";
    const buffer = new TextEncoder().encode(text);
    const result = compressResponse(buffer, "gzip");

    expect(result.encoding).toBe("gzip");
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  it("should achieve good compression ratio for repetitive data", () => {
    const data = JSON.stringify(Array(1000).fill({ foo: "bar", baz: 123 }));
    const result = compressResponse(data, "br");

    const compressionRatio = result.data.byteLength / data.length;
    expect(compressionRatio).toBeLessThan(0.3);
  });
});

describe("shouldCompress", () => {
  it("should compress API responses over 1KB", () => {
    expect(shouldCompress("/api/db/preview", 2000)).toBe(true);
  });

  it("should not compress small API responses", () => {
    expect(shouldCompress("/api/db/preview", 500)).toBe(false);
  });

  it("should compress JS/CSS assets", () => {
    expect(shouldCompress("/dist/app.js")).toBe(true);
    expect(shouldCompress("/dist/styles.css")).toBe(true);
  });

  it("should compress HTML assets", () => {
    expect(shouldCompress("/index.html")).toBe(true);
  });

  it("should not compress non-compressible paths", () => {
    expect(shouldCompress("/image.png")).toBe(false);
  });

  it("should compress API routes when size is undefined", () => {
    expect(shouldCompress("/api/db/query")).toBe(true);
  });
});

import { describe, it, expect } from "bun:test";
import { jsonResponse } from "./api-helpers";

describe("jsonResponse", () => {
  it("should return compressed response when size exceeds threshold", async () => {
    const largeData = {
      items: Array(1000).fill({ id: 1, name: "test", value: 123 }),
    };
    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "br, gzip" },
    });

    const response = jsonResponse(largeData, request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
  });

  it("should return uncompressed response for small data", async () => {
    const smallData = { message: "ok" };
    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "br, gzip" },
    });

    const response = jsonResponse(smallData, request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  it("should fallback to gzip when brotli not supported", async () => {
    const largeData = { items: Array(1000).fill({ id: 1, name: "test" }) };
    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "gzip" },
    });

    const response = jsonResponse(largeData, request);

    expect(response.headers.get("content-encoding")).toBe("gzip");
  });

  it("should not compress when client doesn't support compression", async () => {
    const largeData = { items: Array(1000).fill({ id: 1, name: "test" }) };
    const request = new Request("http://localhost:6969/api/db/preview");

    const response = jsonResponse(largeData, request);

    expect(response.headers.get("content-encoding")).toBeNull();
  });

  it("should respect custom status codes", async () => {
    const errorData = { error: "Not found" };
    const request = new Request("http://localhost:6969/api/db/preview");

    const response = jsonResponse(errorData, request, { status: 404 });

    expect(response.status).toBe(404);
  });

  it("should merge custom headers", async () => {
    const data = { foo: "bar" };
    const request = new Request("http://localhost:6969/api/db/preview");

    const response = jsonResponse(data, request, {
      headers: { "X-Custom": "value" },
    });

    expect(response.headers.get("x-custom")).toBe("value");
  });

  it("should compress API routes by default", async () => {
    const largeData = { rows: Array(500).fill({ a: 1, b: 2, c: 3 }) };
    const request = new Request("http://localhost:6969/api/db/query", {
      headers: { "accept-encoding": "br" },
    });

    const response = jsonResponse(largeData, request);

    expect(response.headers.get("content-encoding")).toBe("br");
  });

  it("should return valid JSON after decompression", async () => {
    const originalData = { items: Array(100).fill({ id: 1, name: "test" }) };
    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "gzip" },
    });

    const response = jsonResponse(originalData, request);

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.status).toBe(200);

    const body = await response.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
    expect(body.byteLength).toBeLessThan(JSON.stringify(originalData).length);
  });

  it("should handle empty arrays", async () => {
    const data = { rows: [] };
    const request = new Request("http://localhost:6969/api/db/preview");

    const response = jsonResponse(data, request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.rows).toEqual([]);
  });

  it("should handle null values", async () => {
    const data = { value: null, nested: { inner: null } };
    const request = new Request("http://localhost:6969/api/db/preview");

    const response = jsonResponse(data, request);
    const json = await response.json();

    expect(json.value).toBeNull();
    expect(json.nested.inner).toBeNull();
  });

  it("should preserve custom headers with compression", async () => {
    const largeData = { items: Array(500).fill("x") };
    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "br" },
    });

    const response = jsonResponse(largeData, request, {
      headers: { "Cache-Control": "max-age=60", ETag: '"abc123"' },
    });

    expect(response.headers.get("cache-control")).toBe("max-age=60");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("content-encoding")).toBe("br");
  });

  it("should handle unicode and special characters", async () => {
    const unicodeData = {
      rows: [["Hello 世界", "Émojis: 🎉🚀"]],
    };

    const request = new Request("http://localhost:6969/api/db/preview", {
      headers: { "accept-encoding": "gzip" },
    });

    const response = jsonResponse(unicodeData, request);
    const json = await response.json();

    expect(json).toEqual(unicodeData);
  });
});

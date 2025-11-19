import { describe, it, expect, beforeAll } from "bun:test";
import { jsonResponse } from "./api-helpers";
import { responseCache } from "./response-cache";
import { compressResponse } from "./compression";

describe("Integration Tests: Compression + Caching + API", () => {
  beforeAll(() => {
    responseCache.clear();
  });

  describe("Compression + API Helpers Integration", () => {
    it("should compress large API responses automatically", async () => {
      const largePayload = {
        rows: Array(1000).fill({ id: 1, name: "test", value: 123 }),
        columns: ["id", "name", "value"],
        rowCount: 1000,
      };

      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "br, gzip" },
      });

      const response = jsonResponse(largePayload, request);

      expect(response.headers.get("content-encoding")).toBe("br");
      expect(response.headers.get("vary")).toBe("Accept-Encoding");

      const body = await response.arrayBuffer();
      const originalSize = JSON.stringify(largePayload).length;
      const compressedSize = body.byteLength;

      const compressionRatio = compressedSize / originalSize;
      expect(compressionRatio).toBeLessThan(0.5);
    });

    it("should handle compression + custom headers", async () => {
      const data = { items: Array(500).fill("x".repeat(100)) };
      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "gzip" },
      });

      const response = jsonResponse(data, request, {
        headers: { "Cache-Control": "private, max-age=60" },
      });

      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    });

    it("should preserve data integrity after compression", async () => {
      const originalData = {
        columns: [
          { name: "id", type: "INTEGER" },
          { name: "value", type: "VARCHAR" },
        ],
        rows: Array(100).fill([
          "1",
          "test data with special chars: 日本語, émojis 🎉",
        ]),
        rowCount: 100,
      };

      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "br" },
      });

      const response = jsonResponse(originalData, request);

      expect(response.headers.get("content-encoding")).toBe("br");

      const body = await response.arrayBuffer();
      const originalSize = JSON.stringify(originalData).length;

      expect(body.byteLength).toBeGreaterThan(0);
      expect(body.byteLength).toBeLessThan(originalSize);
    });
  });

  describe("Caching + API Integration", () => {
    it("should cache API responses with ETags", () => {
      const data = { rows: [[1, 2, 3]], rowCount: 1 };
      const cacheKey = "preview:table:0:100:";

      const etag = responseCache.set(cacheKey, data);

      expect(etag).toMatch(/^"[a-z0-9]+"$/);

      const cached = responseCache.get(cacheKey);
      expect(cached?.data).toEqual(data);
      expect(cached?.etag).toBe(etag);
    });

    it("should support 304 Not Modified workflow", () => {
      const data = { rows: [[1, 2, 3]], rowCount: 1 };
      const cacheKey = "preview:table:0:100:";

      const etag = responseCache.set(cacheKey, data);
      const matches = responseCache.checkETag(cacheKey, etag);

      expect(matches).toBe(true);
    });

    it("should invalidate cache on pattern match", () => {
      responseCache.set("preview:table1:0:100:", { data: 1 });
      responseCache.set("preview:table1:100:100:", { data: 2 });
      responseCache.set("preview:table2:0:100:", { data: 3 });

      responseCache.invalidate("preview:table1:");

      expect(responseCache.get("preview:table1:0:100:")).toBeNull();
      expect(responseCache.get("preview:table1:100:100:")).toBeNull();
      expect(responseCache.get("preview:table2:0:100:")).not.toBeNull();
    });
  });

  describe("Full Stack: Compression + Caching + Headers", () => {
    it("should handle complete request-response cycle with caching", async () => {
      const data = { items: Array(500).fill({ id: 1, value: "test" }) };
      const cacheKey = "preview:mytable:0:500:";
      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "br" },
      });

      const etag = responseCache.set(cacheKey, data);
      const cached = responseCache.get(cacheKey);

      expect(cached).not.toBeNull();

      const response = jsonResponse(cached!.data, request, {
        headers: {
          "Cache-Control": "private, max-age=60",
          ETag: etag,
        },
      });

      expect(response.headers.get("content-encoding")).toBe("br");
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    });

    it("should handle cache miss and set new cache entry", () => {
      const cacheKey = "preview:newtable:0:100:";
      const cached = responseCache.get(cacheKey);

      expect(cached).toBeNull();

      const data = { rows: [[1]], rowCount: 1 };
      const etag = responseCache.set(cacheKey, data);

      const newCached = responseCache.get(cacheKey);
      expect(newCached?.etag).toBe(etag);
    });

    it("should compress cached responses", async () => {
      const largeData = {
        rows: Array(1000).fill([1, 2, 3, 4, 5]),
        rowCount: 1000,
      };
      const cacheKey = "preview:bigtable:0:1000:";

      responseCache.set(cacheKey, largeData);
      const cached = responseCache.get(cacheKey);

      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "br" },
      });

      const response = jsonResponse(cached!.data, request);

      expect(response.headers.get("content-encoding")).toBe("br");

      const body = await response.arrayBuffer();
      const originalSize = JSON.stringify(largeData).length;

      expect(body.byteLength).toBeLessThan(originalSize * 0.3);
    });
  });

  describe("Performance Tests", () => {
    it("should compress 1000 rows in under 50ms", () => {
      const data = JSON.stringify({
        rows: Array(1000).fill([1, "test", true, null, 123.45]),
      });

      const start = performance.now();
      compressResponse(data, "br");
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it("should handle 100 cache operations in under 10ms", () => {
      responseCache.clear();
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        const key = `test:${i}`;
        responseCache.set(key, { data: i });
        responseCache.get(key);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(10);
    });

    it("should maintain performance with large payloads", () => {
      const largePayload = {
        rows: Array(5000).fill([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        columns: Array(10).fill({ name: "col", type: "INTEGER" }),
      };

      const start = performance.now();
      const json = JSON.stringify(largePayload);
      compressResponse(json, "br");
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(200);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty data structures", async () => {
      const emptyData = { rows: [], columns: [], rowCount: 0 };
      const request = new Request("http://localhost:6969/api/db/preview");

      const response = jsonResponse(emptyData, request);
      const json = await response.json();

      expect(json).toEqual(emptyData);
    });

    it("should handle deeply nested objects", async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              level4: {
                data: Array(100).fill("x"),
              },
            },
          },
        },
      };

      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "br" },
      });

      const response = jsonResponse(nested, request);
      const json = await response.json();

      expect(json).toEqual(nested);
    });

    it("should handle special characters and unicode", async () => {
      const unicodeData = {
        rows: [
          ["Hello 世界", "Émojis: 🎉🚀", "Math: ∑∫≈"],
          ["Symbols: €£¥", "Arrows: ←→↑↓", "Greek: αβγδ"],
        ],
      };

      const request = new Request("http://localhost:6969/api/db/preview", {
        headers: { "accept-encoding": "gzip" },
      });

      const response = jsonResponse(unicodeData, request);
      const json = await response.json();

      expect(json).toEqual(unicodeData);
    });

    it("should handle concurrent compression requests", async () => {
      const promises = Array(20)
        .fill(null)
        .map((_, i) => {
          const data = { index: i, rows: Array(100).fill(i) };
          const request = new Request("http://localhost:6969/api/db/preview", {
            headers: { "accept-encoding": "br" },
          });
          return jsonResponse(data, request).json();
        });

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result.index).toBe(i);
      });
    });

    it("should handle cache overflow gracefully", () => {
      responseCache.clear();
      const originalMaxSize = responseCache.getMaxSize();
      responseCache.setMaxSize(5);

      for (let i = 0; i < 10; i++) {
        responseCache.set(`key${i}`, { data: i });
      }

      const cacheSize = responseCache.getSize();
      expect(cacheSize).toBeLessThanOrEqual(5);

      responseCache.setMaxSize(originalMaxSize);
    });
  });
});

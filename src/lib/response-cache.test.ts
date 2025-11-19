import { describe, it, expect, beforeEach } from "bun:test";
import { responseCache } from "./response-cache";

describe("ResponseCache", () => {
  beforeEach(() => {
    responseCache.clear();
  });

  it("should cache and retrieve data", () => {
    const data = { foo: "bar" };
    const etag = responseCache.set("test-key", data);

    const cached = responseCache.get("test-key");
    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual(data);
    expect(cached?.etag).toBe(etag);
  });

  it("should return null for expired entries", async () => {
    const originalTTL = responseCache.getTTL();
    responseCache.setTTL(10);

    responseCache.set("test-key", { data: "test" });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const cached = responseCache.get("test-key");
    expect(cached).toBeNull();

    responseCache.setTTL(originalTTL);
  });

  it("should validate ETags correctly", () => {
    const data = { test: "data" };
    const etag = responseCache.set("key", data);

    expect(responseCache.checkETag("key", etag)).toBe(true);
    expect(responseCache.checkETag("key", "wrong-etag")).toBe(false);
  });

  it("should return false for non-existent keys", () => {
    expect(responseCache.checkETag("nonexistent", "etag")).toBe(false);
  });

  it("should generate different ETags for different data", () => {
    const etag1 = responseCache.set("key1", { a: 1 });
    const etag2 = responseCache.set("key2", { a: 2 });

    expect(etag1).not.toBe(etag2);
  });

  it("should generate same ETag for same data", () => {
    const data = { foo: "bar", baz: 123 };
    const etag1 = responseCache.set("key1", data);
    responseCache.clear();
    const etag2 = responseCache.set("key2", data);

    expect(etag1).toBe(etag2);
  });

  it("should evict oldest entry when cache is full", () => {
    const originalMaxSize = responseCache.getMaxSize();
    responseCache.setMaxSize(3);

    responseCache.set("key1", { data: 1 });
    responseCache.set("key2", { data: 2 });
    responseCache.set("key3", { data: 3 });
    responseCache.set("key4", { data: 4 });

    expect(responseCache.get("key1")).toBeNull();
    expect(responseCache.get("key4")).not.toBeNull();

    responseCache.setMaxSize(originalMaxSize);
  });

  it("should invalidate entries matching pattern", () => {
    responseCache.set("preview:table1:0:100:", { data: 1 });
    responseCache.set("preview:table1:100:100:", { data: 2 });
    responseCache.set("preview:table2:0:100:", { data: 3 });

    responseCache.invalidate("preview:table1:");

    expect(responseCache.get("preview:table1:0:100:")).toBeNull();
    expect(responseCache.get("preview:table1:100:100:")).toBeNull();
    expect(responseCache.get("preview:table2:0:100:")).not.toBeNull();
  });

  it("should clear all entries", () => {
    responseCache.set("key1", { data: 1 });
    responseCache.set("key2", { data: 2 });

    responseCache.clear();

    expect(responseCache.get("key1")).toBeNull();
    expect(responseCache.get("key2")).toBeNull();
  });
});

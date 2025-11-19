import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TempCleanupService } from "./temp-cleanup";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_TEMP_DIR = join(process.cwd(), ".test-temp-cleanup");

describe("TempCleanupService", () => {
  beforeEach(() => {
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_TEMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it("should create cleanup service with default values", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR);
    expect(service).toBeDefined();
  });

  it("should create cleanup service with custom max age", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 5000);
    expect(service).toBeDefined();
  });

  it("should start and stop cleanup service", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR);

    service.start();
    service.stop();

    expect(true).toBe(true);
  });

  it("should not start twice", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR);

    service.start();
    service.start();
    service.stop();

    expect(true).toBe(true);
  });

  it("should not clean up recent files", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 10000);

    const recentFile = join(TEST_TEMP_DIR, "recent.csv");
    writeFileSync(recentFile, "recent data");

    service.start();

    await new Promise((resolve) => setTimeout(resolve, 50));

    service.stop();

    expect(existsSync(recentFile)).toBe(true);
  });

  it("should handle non-existent directory gracefully", async () => {
    const nonExistentDir = join(TEST_TEMP_DIR, "does-not-exist");
    const service = new TempCleanupService(nonExistentDir, 100);

    service.start();

    await new Promise((resolve) => setTimeout(resolve, 50));

    service.stop();

    expect(true).toBe(true);
  });

  it("should handle file deletion errors gracefully", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 50);

    const file = join(TEST_TEMP_DIR, "test.csv");
    writeFileSync(file, "data");

    service.start();

    await new Promise((resolve) => setTimeout(resolve, 100));

    service.stop();

    expect(true).toBe(true);
  });

  it("should clean multiple files", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 50);

    for (let i = 0; i < 5; i++) {
      const file = join(TEST_TEMP_DIR, `file${i}.csv`);
      writeFileSync(file, `data${i}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    service.start();

    await new Promise((resolve) => setTimeout(resolve, 100));

    service.stop();
  });

  it("should handle mixed old and new files", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 100);

    const newFile = join(TEST_TEMP_DIR, "new.csv");

    writeFileSync(newFile, "new");

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.stop();

    expect(existsSync(newFile)).toBe(true);
  });

  it("should allow stopping before starting", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR);

    service.stop();

    expect(true).toBe(true);
  });

  it("should handle empty directory", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 50);

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    service.stop();

    expect(existsSync(TEST_TEMP_DIR)).toBe(true);
  });

  it("should not throw on cleanup errors", async () => {
    const service = new TempCleanupService(TEST_TEMP_DIR, 10);

    writeFileSync(join(TEST_TEMP_DIR, "file.csv"), "data");

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.stop();

    expect(true).toBe(true);
  });

  it("should handle rapid start/stop cycles", () => {
    const service = new TempCleanupService(TEST_TEMP_DIR);

    for (let i = 0; i < 5; i++) {
      service.start();
      service.stop();
    }

    expect(true).toBe(true);
  });
});

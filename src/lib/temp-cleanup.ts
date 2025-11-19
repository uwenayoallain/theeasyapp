import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@/lib/logger";

export class TempCleanupService {
  private intervalId: Timer | null = null;
  private tempDir: string;
  private maxAge: number;

  constructor(tempDir: string, maxAgeMs: number = 3600000) {
    this.tempDir = tempDir;
    this.maxAge = maxAgeMs;
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error("Temp cleanup error:", err);
      });
    }, 300000);

    this.cleanup().catch((err) => {
      logger.error("Initial temp cleanup error:", err);
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async cleanup(): Promise<void> {
    try {
      const files = await readdir(this.tempDir);
      const now = Date.now();

      for (const file of files) {
        try {
          const filePath = join(this.tempDir, file);
          const stats = await stat(filePath);

          if (now - stats.mtimeMs > this.maxAge) {
            await unlink(filePath);
            logger.log(`Cleaned up stale temp file: ${file}`);
          }
        } catch (err) {
          logger.warn(`Failed to cleanup ${file}:`, err);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}

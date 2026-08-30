import { createRateLimitServer } from "./server.js";
import { TokenBucket } from "./token-bucket.js";

const readPositiveInteger = (name: string, fallback: number) => {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const host = process.env.HOST ?? "0.0.0.0";
const port = readPositiveInteger("PORT", 3000);

const limiter = new TokenBucket({
  capacity: readPositiveInteger("RATE_LIMIT_CAPACITY", 100),
  tokensPerTimeUnit: readPositiveInteger("RATE_LIMIT_REFILL", 100),
  timeUnit: readPositiveInteger("RATE_LIMIT_TIME_UNIT_MS", 60_000),
  clock: () => Date.now(),
});

const server = createRateLimitServer(limiter);

server.on("error", (error) => {
  console.error("HTTP server error", error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Rate limiter listening on http://${host}:${port}`);
});

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);

  server.close((error) => {
    if (error) {
      console.error("Failed to close HTTP server cleanly", error);
      process.exitCode = 1;
    }
  });

  server.closeIdleConnections();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

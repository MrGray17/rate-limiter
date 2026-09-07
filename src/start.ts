import { createRateLimitServer } from "./server.js";
import { RedisFixedWindow } from "./redis-fixed-window.js";
import { createClient } from "redis";

const client = createClient({
  url: "redis://127.0.0.1:6379",
});

await client.connect();

const redisLimiter = new RedisFixedWindow({
  client,
  requestLimit: 5,
  windowSeconds: 10,
});

const EnvHelper = (name: string, fallback: number): number => {
  const content = process.env[name];
  if (content === undefined) {
    return fallback;
  }
  const NumContent = Number(content);
  if (Number.isInteger(NumContent) && NumContent > 0) {
    return NumContent;
  }
  throw new Error(`${name} must be a positive integer`);
};

const HostHandler = (fallback: string): string => {
  //we work with strings
  const host = process.env.HOST; //because addresses are not numbers (NaN)
  if (host === undefined) {
    return fallback;
  }
  if (host.trim().length === 0) {
    throw new Error("HOST must not be empty");
  }
  return host.trim();
};

const server = createRateLimitServer(redisLimiter);
const port = EnvHelper("PORT", 3000);
const host = HostHandler("0.0.0.0");
server.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});
server.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exitCode = 1;
});

let currentlyShuttingDown = false;

const GracefulShut = () => {
  if (currentlyShuttingDown) {
    return;
  }
  console.log("Server shutting down ...");
  currentlyShuttingDown = true;
  server.close(async () => {
    console.log("Server shut");
    await client.quit();
  });
};
process.on("SIGINT", GracefulShut);
process.on("SIGTERM", GracefulShut);

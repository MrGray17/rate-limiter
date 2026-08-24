import { createMyServer } from "./server.js";
import { FixedWindow } from "./fixed-window.js";
import { SlidingWindowLog } from "./sliding-window-log.js";
import { SlidingWindowCounter } from "./sliding-window-counter.js";
import { TokenBucket } from "./token-bucket.js";

const fixedWindow = new FixedWindow({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
});

const slidingWindowLog = new SlidingWindowLog({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
});

const slidingWindowCounter = new SlidingWindowCounter({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
});

const tokenBucket = new TokenBucket({
  capacity: 5,
  tokensPerTimeUnit: 1,
  timeUnit: 1000,
  clock: () => Date.now(),
});

const activeLimiter = tokenBucket;

const server = createMyServer(activeLimiter);
server.listen(3000);

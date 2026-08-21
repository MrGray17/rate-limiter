import { createMyServer } from "./server.js";
import { RateLimiter } from "./limiter.js";
import { slidingWindow } from "./sliding-window-log.js";

const FixedWindow = new RateLimiter({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
});

const SlidingWindow = new slidingWindow({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
});

const activeLimiter = FixedWindow;

const server = createMyServer(activeLimiter);
server.listen(3000);

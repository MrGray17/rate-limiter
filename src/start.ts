import { createMyServer } from "./server.js";
import { RateLimiter } from "./limiter.js";
import { slidingWindow } from "./sliding-window-log.js";
import { SlidingWindowCounter } from "./sliding-window-counter.js";

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
const SWC = new SlidingWindowCounter ({
  windowSize: 10_000,
  requestLimit: 5,
  clock: () => Date.now(),
})

const activeLimiter = SWC;

const server = createMyServer(activeLimiter);
server.listen(3000);

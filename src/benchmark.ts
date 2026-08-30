import { performance } from "node:perf_hooks";

import { FixedWindow } from "./fixed-window.js";
import { SlidingWindowLog } from "./sliding-window-log.js";
import { SlidingWindowCounter } from "./sliding-window-counter.js";
import { TokenBucket } from "./token-bucket.js";
import type { Limiter } from "./server.js";

let fakeTime = 0;

const requestLimit = 10_000;
const windowSize = 10_000;

const createFixedWindow = () => {
  return new FixedWindow({
    windowSize,
    requestLimit,
    clock: () => fakeTime,
  });
};

const createSlidingWindowLog = () => {
  return new SlidingWindowLog({
    windowSize,
    requestLimit,
    clock: () => fakeTime,
  });
};

const createSlidingWindowCounter = () => {
  return new SlidingWindowCounter({
    windowSize,
    requestLimit,
    clock: () => fakeTime,
  });
};

const createTokenBucket = () => {
  return new TokenBucket({
    capacity: requestLimit,
    tokensPerTimeUnit: 1,
    timeUnit: 1000,
    clock: () => fakeTime,
  });
};

const benchmark = (
  name: string,
  createLimiter: () => Limiter,
  iterations: number,
  warmupIterations: number,
) => {
  console.log(`\n---${name}---`);
  const totalStart = performance.now();
  const warmupLimiter = (createLimiter: () => Limiter) => {
    fakeTime = 0;
    const limiter = createLimiter();
    for (let i = 0; i < warmupIterations; i++) {
      limiter.isAllowed("warmup");
      fakeTime += 1;
    }
  };
  warmupLimiter(createLimiter);
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    fakeTime = 0;

    const limiter = createLimiter();

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      limiter.isAllowed("alice");
      fakeTime += 1;
    }

    const end = performance.now();

    const elapsedMs = end - start;

    times.push(elapsedMs);

    console.log(`Requests: ${iterations}`);
    console.log(`Time: ${elapsedMs.toFixed(2)} ms`);
    console.log(
      `Throughput: ${Math.round(iterations / (elapsedMs / 1000))} ops/sec`,
    );
  }
  times.sort((a, b) => a - b);

  if (times.length % 2 === 0) {
    const median =
      (times[Math.floor(times.length / 2 - 1)]! +
        times[Math.floor(times.length / 2)]!) /
      2;

    console.log(`Median: ${median.toFixed(2)} ms`);
  } else {
    const median = times[Math.floor(times.length / 2)]!;

    console.log(`Median: ${median.toFixed(2)} ms`);
  }
  const totalEnd = performance.now();
  console.log(`Total benchmark time: ${(totalEnd - totalStart).toFixed(2)} ms`);
};


benchmark("Fixed Window", createFixedWindow, 500_000, 500_000);
benchmark("Sliding Window", createSlidingWindowLog, 500_000, 500_000);
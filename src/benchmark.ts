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
    tokensPerTimeUnit: 1000,
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
  console.log(`\n--- ${name} ---`);

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

  for (let run = 0; run < 10; run++) {
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

    console.log(`Run ${run + 1}`);
    console.log(`Requests: ${iterations}`);
    console.log(`Time: ${elapsedMs.toFixed(2)} ms`);
    console.log(
      `Throughput: ${Math.round(iterations / (elapsedMs / 1000))} ops/sec`,
    );
  }

  times.sort((a, b) => a - b);

  let median: number;

  if (times.length % 2 === 0) {
    median =
      (times[Math.floor(times.length / 2 - 1)]! +
        times[Math.floor(times.length / 2)]!) /
      2;
  } else {
    median = times[Math.floor(times.length / 2)]!;
  }

  console.log(`Median: ${median.toFixed(2)} ms`);

  const medianThroughput = iterations / (median / 1000);

  console.log(`Median throughput: ${Math.round(medianThroughput)} ops/sec`);

  const totalEnd = performance.now();

  console.log(`Total benchmark time: ${(totalEnd - totalStart).toFixed(2)} ms`);
};

benchmark("Fixed Window", createFixedWindow, 1_000_000, 500_000);

benchmark("Sliding Window Log", createSlidingWindowLog, 1_000_000, 500_000);

benchmark(
  "Sliding Window Counter",
  createSlidingWindowCounter,
  1_000_000,
  500_000,
);

benchmark("Token Bucket", createTokenBucket, 1_000_000, 500_000);

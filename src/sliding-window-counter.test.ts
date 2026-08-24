import { SlidingWindowCounter } from "./sliding-window-counter.js";
import test from "node:test";
import assert from "node:assert";

test("New user returns true", () => {
  const slidingWindowCounter = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });

  const output = slidingWindowCounter.isAllowed("Alice");
  assert.strictEqual(output, true);
});

test("Request is rejected when estimated count reaches the limit", () => {
  let fakeTime = 0;
  const slidingWindowCounter = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  fakeTime = 17_000;

  for (let i = 0; i < 4; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  assert.strictEqual(slidingWindowCounter.isAllowed("alice"), false);
});

test("Skipping more than one bucket resets old count", () => {
  let fakeTime = 0;
  const slidingWindowCounter = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  fakeTime = 2 * 10_000;

  for (let i = 0; i < 3; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  const output = slidingWindowCounter.isAllowed("alice");
  assert.strictEqual(output, true);
});

test("Limits are enforced inside the same bucket", () => {
  let fakeTime = 0;
  const slidingWindowCounter = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  assert.strictEqual(slidingWindowCounter.isAllowed("alice"), false);
});

test("Crossing one bucket uses the previous bucket contribution", () => {
  let fakeTime = 0;
  const slidingWindowCounter = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 4; i++) {
    slidingWindowCounter.isAllowed("alice");
  }

  fakeTime = 11_000;

  const first = slidingWindowCounter.isAllowed("alice");
  assert.strictEqual(first, true);

  const second = slidingWindowCounter.isAllowed("alice");
  assert.strictEqual(second, false);
});

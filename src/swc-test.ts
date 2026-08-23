import { SlidingWindowCounter } from "./sliding-window-counter.js";
import test from "node:test";
import assert from "node:assert";

test("New user returns true", () => {
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });

  const output = swc.isAllowed("Alice");
  assert.strictEqual(output, true);
});

test("req not accepted if not under limit of prediction+current", () => {
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });
  let fakeTime = 0;
  for (let i = 0; i < 5; i++) {
    swc.isAllowed("alice");
  }

  fakeTime = 17_000;

  for (let i = 0; i < 4; i++) {
    const output = swc.isAllowed("alice");
  }
  assert.strictEqual(swc.isAllowed("alice"), false);
});

test("skipping more than a bucket resets count", () => {
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  let fakeTime = 0;
  for (let i = 0; i < 5; i++) {
    swc.isAllowed("alice");
  }

  fakeTime = 0 + 2 * 10_000;

  for (let i = 0; i < 3; i++) {
    swc.isAllowed("alice");
  }
  const output = swc.isAllowed("alice");
  assert.strictEqual(output, true);
});

test("Limits are enforced inside same bucket", () => {
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  let fakeTime = 0;
  for (let i = 0; i < 5; i++) {
    swc.isAllowed("alice");
  }
  assert.strictEqual(swc.isAllowed("alice"), false);
});

test("Crossing one bucket", () => {
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });
  let fakeTime = 0;
  for (let i = 0; i < 4; i++) {
    swc.isAllowed("alice");
  }
  fakeTime = 11_000;
  //the weight contribution should be added : (4 x 9) / 10 = 3.6
  //current bucket can only receive 1 req
  const first = swc.isAllowed("alice");
assert.strictEqual(first, true);
const second = swc.isAllowed("alice");
assert.strictEqual(second, false);
});

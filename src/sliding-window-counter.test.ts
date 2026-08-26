import { SlidingWindowCounter } from "./sliding-window-counter.js";
import test from "node:test";
import assert from "node:assert";

test("new user is allowed", () => {
  let fakeTime = 0;
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  assert.strictEqual(swc.isAllowed("alice"), true);
});

test("weighted previous bucket contribution limits new requests", () => {
  let fakeTime = 0;
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }

  fakeTime = 17_000;

  // Five requests from the previous bucket contribute 1.5 here:
  // 5 * ((10_000 - 7_000) / 10_000) = 1.5.
  // Three new requests fit; the fourth would push the estimate above 5.
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }

  assert.strictEqual(swc.isAllowed("alice"), false);
});

test("skipping more than one bucket discards old counts", () => {
  let fakeTime = 0;
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }

  fakeTime = 20_000;

  for (let i = 0; i < 4; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }
});

test("same-bucket limit allows exactly five requests", () => {
  let fakeTime = 0;
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }

  assert.strictEqual(swc.isAllowed("alice"), false);
});

test("crossing one bucket preserves weighted previous contribution", () => {
  let fakeTime = 0;
  const swc = new SlidingWindowCounter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 4; i++) {
    assert.strictEqual(swc.isAllowed("alice"), true);
  }

  fakeTime = 11_000;

  // Previous contribution: 4 * 0.9 = 3.6.
  // One new request produces 4.6 and is allowed.
  // A second would produce 5.6 and is rejected.
  assert.strictEqual(swc.isAllowed("alice"), true);
  assert.strictEqual(swc.isAllowed("alice"), false);
});

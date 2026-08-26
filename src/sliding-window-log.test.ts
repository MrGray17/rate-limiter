import test from "node:test";
import assert from "node:assert";
import { SlidingWindowLog } from "./sliding-window-log.js";

test("same-window limit", () => {
  let fakeTime = 0;
  const swl = new SlidingWindowLog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 4; i++) {
    swl.isAllowed("alice");
  }

  assert.strictEqual(swl.isAllowed("alice"), true);
  assert.strictEqual(swl.isAllowed("alice"), false);
});

test("expired timestamps are removed", () => {
  let fakeTime = 0;
  const swl = new SlidingWindowLog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    swl.isAllowed("alice");
  }

  assert.strictEqual(swl.isAllowed("alice"), false);

  fakeTime = 11_000;
  assert.strictEqual(swl.isAllowed("alice"), true);
});

test("different users do not interfere", () => {
  let fakeTime = 0;
  const swl = new SlidingWindowLog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    swl.isAllowed("alice");
  }

  assert.strictEqual(swl.isAllowed("alice"), false);
  assert.strictEqual(swl.isAllowed("adam"), true);
});

test("rolling-window boundary behaves correctly", () => {
  let fakeTime = 0;
  const swl = new SlidingWindowLog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });

  swl.isAllowed("alice");
  fakeTime = 3000;
  swl.isAllowed("alice");
  fakeTime = 5000;
  swl.isAllowed("alice");
  fakeTime = 7000;
  swl.isAllowed("alice");
  fakeTime = 9000;
  swl.isAllowed("alice");

  fakeTime = 12_000;
  assert.strictEqual(swl.isAllowed("alice"), true);
  assert.strictEqual(swl.isAllowed("alice"), false);
});

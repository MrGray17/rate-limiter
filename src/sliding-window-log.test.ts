import test from "node:test";
import assert from "node:assert";
import { slidingWindowlog } from "./sliding-window-log.js";

test("same-window limit", () => {
  const swl = new slidingWindowlog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });
  let fakeTime = 0;
  for (let i = 0; i < 4; i++) {
    swl.isAllowed("alice");
  }
  assert.strictEqual(swl.isAllowed("alice"), true);
  assert.strictEqual(swl.isAllowed("alice"), false);
});

test("expired timestamp are removed", () => {
  const swl = new slidingWindowlog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });
  let fakeTime = 0;

  for (let i = 0; i < 5; i++) {
    swl.isAllowed("alice");
  }
  assert.strictEqual(swl.isAllowed("alice"), false);

  fakeTime = 11_000;
  assert.strictEqual(swl.isAllowed("alice"), true);
});

test("different users dont interfere", () => {
  const swl = new slidingWindowlog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });
  let fakeTime = 0;

  for (let i = 0; i < 5; i++) {
    swl.isAllowed("alice");
  }
  assert.strictEqual(swl.isAllowed("alice"), false);
  assert.strictEqual(swl.isAllowed("adam"), true);
});

test("rolling-window boundary behaves correctly", () => {
  const swl = new slidingWindowlog({
    requestLimit: 5,
    windowSize: 10_000,
    clock: () => fakeTime,
  });
  let fakeTime = 0;

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

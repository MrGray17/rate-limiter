import { RateLimiter } from "./limiter.js";
import test from "node:test";
import assert from "node:assert/strict";

test("Alice should be accepted the first time", () => {
  const rL = new RateLimiter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });

  const output = rL.isAllowed("alice");
  assert.strictEqual(output, true);
});

test("Only 5 req per window", () => {
  const rL = new RateLimiter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });

  for (let i = 0; i < 5; i++) {
    const output = rL.isAllowed("alice");
    assert.strictEqual(output, true);
  }
  assert.strictEqual(rL.isAllowed("alice"), false);
});

test("New windows accept requests", () => {
  let fakeTime = 1000;
  const rL = new RateLimiter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    const output = rL.isAllowed("alice");
    assert.strictEqual(output, true);
  }
  assert.strictEqual(rL.isAllowed("alice"), false);

  fakeTime = 12_000;
  const output = rL.isAllowed("alice");
  assert.strictEqual(output, true);
});

test("Users' limits should not interfere", () => {
  const rL = new RateLimiter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });

  for (let i = 0; i < 5; i++) {
    const output = rL.isAllowed("alice");
    assert.strictEqual(output, true);
  }
  assert.strictEqual(rL.isAllowed("alice"), false);

  assert.strictEqual(rL.isAllowed("bob"), true);
});

test("New window and limit", () => {
  let fakeTime = 10_000;
  const rL = new RateLimiter({
    windowSize: 5000,
    requestLimit: 2,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 2; i++) {
    const output = rL.isAllowed("alice");
    assert.strictEqual(output, true);
  }

  fakeTime = 14_500;
  assert.strictEqual(rL.isAllowed("alice"), false);

  fakeTime = 16_000;
  assert.strictEqual(rL.isAllowed("alice"), true);
});

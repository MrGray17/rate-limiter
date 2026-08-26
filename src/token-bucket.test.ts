import test from "node:test";
import assert from "node:assert";
import { TokenBucket } from "./token-bucket.js";

test("Burst capacity", () => {
  const fakeTime = 0;
  const tb = new TokenBucket({
    capacity: 5,
    tokensPerTimeUnit: 1,
    timeUnit: 1000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 4; i++) {
    tb.isAllowed("alice");
  }

  assert.strictEqual(tb.isAllowed("alice"), true);
  assert.strictEqual(tb.isAllowed("alice"), false);
});

test("Refill", () => {
  let fakeTime = 0;
  const tb = new TokenBucket({
    capacity: 5,
    tokensPerTimeUnit: 1,
    timeUnit: 1000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    tb.isAllowed("alice");
  }

  assert.strictEqual(tb.isAllowed("alice"), false);
  fakeTime = 1000;
  assert.strictEqual(tb.isAllowed("alice"), true);
});

test("Partial refill", () => {
  let fakeTime = 0;
  const tb = new TokenBucket({
    capacity: 5,
    tokensPerTimeUnit: 1,
    timeUnit: 1000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    tb.isAllowed("alice");
  }

  assert.strictEqual(tb.isAllowed("alice"), false);
  fakeTime = 500;
  assert.strictEqual(tb.isAllowed("alice"), false);
  fakeTime = 1000;
  assert.strictEqual(tb.isAllowed("alice"), true);
});

test("Capacity ceiling", () => {
  let fakeTime = 0;
  const tb = new TokenBucket({
    capacity: 5,
    tokensPerTimeUnit: 1,
    timeUnit: 1000,
    clock: () => fakeTime,
  });

  for (let i = 0; i < 5; i++) {
    tb.isAllowed("alice");
  }

  fakeTime = 500_000;

  for (let i = 0; i < 5; i++) {
    tb.isAllowed("alice");
  }

  assert.strictEqual(tb.isAllowed("alice"), false);
  fakeTime = 501_000;
  assert.strictEqual(tb.isAllowed("alice"), true);
});

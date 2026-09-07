import test, { after } from "node:test";
import assert from "node:assert/strict";
import { RedisFixedWindow } from "./redis-fixed-window.js";
import { createClient } from "redis";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const client = createClient({
  url: "redis://127.0.0.1:6379",
});

await client.connect();

test("5th request under same window is refused", async () => {
  const limiter = new RedisFixedWindow({
    client,
    requestLimit: 4,
    windowSeconds: 5,
  });
  const separateId = randomUUID();
  const alice = `${separateId}:Alice`;

  for (let i = 0; i < 4; i++) {
    const allowed = await limiter.isAllowed(alice);
    assert.strictEqual(allowed, true);
  }
  assert.strictEqual(await limiter.isAllowed(alice), false);
});

test("users do not overlap", async () => {
  const limiter = new RedisFixedWindow({
    client,
    requestLimit: 4,
    windowSeconds: 5,
  });
  const separateId = randomUUID();
  const alice = `${separateId}:Alice`;
  const bob = `${separateId}:Bob`;
  for (let i = 0; i < 4; i++) {
    const allowed = await limiter.isAllowed(alice);
    assert.strictEqual(allowed, true);
  }
  assert.strictEqual(await limiter.isAllowed(alice), false);

  assert.strictEqual(await limiter.isAllowed(bob), true);
});

test("requests are allowed after window reset", async () => {
  const limiter = new RedisFixedWindow({
    client,
    requestLimit: 4,
    windowSeconds: 1, // made it 1 sec so that we don't wait
  });
  const separateId = randomUUID();
  const alice = `${separateId}:Alice`;

  for (let i = 0; i < 4; i++) {
    const allowed = await limiter.isAllowed(alice);
    assert.strictEqual(allowed, true);
  }
  assert.strictEqual(await limiter.isAllowed(alice), false);

  await setTimeout(1100);
  assert.strictEqual(await limiter.isAllowed(alice), true);
});

test("Separate apps share same state", async () => {
  const clientA = createClient({
    url: "redis://127.0.0.1:6379",
  });
  const clientB = createClient({
    url: "redis://127.0.0.1:6379",
  });

  await clientA.connect();
  await clientB.connect();

  const limiterA = new RedisFixedWindow({
    client: clientA,
    requestLimit: 4,
    windowSeconds: 5,
  });
  const limiterB = new RedisFixedWindow({
    client: clientB,
    requestLimit: 4,
    windowSeconds: 5,
  });

  const alice = `${randomUUID()}:Alice`;

  for (let i = 0; i < 2; i++) {
    const a = await limiterA.isAllowed(alice);
    const b = await limiterB.isAllowed(alice);

    assert.strictEqual(a, true);
    assert.strictEqual(b, true);
  }
  assert.strictEqual(await limiterA.isAllowed(alice), false);

  after(async () => {
    await clientA.quit();
    await clientB.quit();
  });
});

test("concurrent requests enforce the request limit", async () => {
  //we test if operations overlap
  const limiter = new RedisFixedWindow({
    client,
    requestLimit: 2,
    windowSeconds: 5,
  });
  const alice = `${randomUUID()}:Alice`;

  const p1 = limiter.isAllowed(alice);
  const p2 = limiter.isAllowed(alice);
  const p3 = limiter.isAllowed(alice);

  const result = await Promise.all([p1, p2, p3]);

  assert.strictEqual(result[0], true);
  assert.strictEqual(result[1], true);
  assert.strictEqual(result[2], false);
});

test("concurrent requests across multiple instances never exceed the limit", async () => {
  const clientA = createClient();
  const clientB = createClient();

  await clientA.connect();
  await clientB.connect();

  try {
    // if the test fails we have to close the server (else the code is unreachable)
    const requestLimit = 20;
    const totalRequests = 100;

    const limiterA = new RedisFixedWindow({
      client: clientA,
      requestLimit,
      windowSeconds: 5,
    });

    const limiterB = new RedisFixedWindow({
      client: clientB,
      requestLimit,
      windowSeconds: 5,
    });

    const alice = `${randomUUID()}:Alice`;

    const requests = Array.from({ length: totalRequests }, (_, index) => {
      // _ means we know there's a parameter
      //there we're just not using it
      const limiter = index % 2 === 0 ? limiterA : limiterB; // brilliant idea to distribute requests equally

      return limiter.isAllowed(alice);
    });
    // fancy code that creates a 100 slots array, and for each index it runs the callback

    const results = await Promise.all(requests);

    const allowedCount = results.filter((result) => result === true).length;
    const rejectedCount = results.filter((result) => result === false).length;

    assert.strictEqual(allowedCount, requestLimit);
    assert.strictEqual(rejectedCount, totalRequests - requestLimit);
  } finally {
    await clientA.quit();
    await clientB.quit();
  }
});

after(async () => {
  await client.quit();
});

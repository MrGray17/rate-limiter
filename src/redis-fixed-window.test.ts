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

test ("requests are allowed after window reset" , async () => {
    const limiter = new RedisFixedWindow({
    client,
    requestLimit: 4,
    windowSeconds: 1,   // made it 1 sec so that we don't wait 
  });
  const separateId = randomUUID();
  const alice = `${separateId}:Alice`;

  for (let i = 0; i < 4; i++) {
    const allowed = await limiter.isAllowed(alice);
    assert.strictEqual(allowed, true);
  }
  assert.strictEqual(await limiter.isAllowed(alice), false);

  await setTimeout (1100);
  assert.strictEqual (await limiter.isAllowed(alice) , true)
})

after(async () => {
  await client.quit();
});

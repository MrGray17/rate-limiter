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
}) ;

test ("Separate apps share same state" , async () => {
  const clientA = createClient ({
    url: "redis://127.0.0.1:6379"
  })
  const clientB = createClient ({
    url: "redis://127.0.0.1:6379"
  })

  await clientA.connect()
  await clientB.connect()
  
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

  const alice = `${randomUUID()}:Alice`

  for (let i = 0 ; i<2 ; i++) {
    const a = await limiterA.isAllowed(alice)
    const b = await limiterB.isAllowed(alice)

    assert.strictEqual(a , true)
    assert.strictEqual(b , true)
  }
  assert.strictEqual (await limiterA.isAllowed(alice) , false)

  after (async () => {
    await clientA.quit() ;
    await clientB.quit() ;
  })

})

after(async () => {
  await client.quit();
});


import { createMyServer } from "./server.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, closeServer } from "./test-utils.js";

test("allows first 5 requests and rejects the 6th", async () => {
  const server1 = createMyServer();
  await startServer(server1);

  try {
    const address = server1.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not start correctly");
    }
    const url = "http://localhost:" + address.port + "/hello";

    for (let i = 0; i < 5; i++) {
      const response = await fetch(url, {
        headers: {
          "x-client-id": "Alice",
        },
      });
      assert.strictEqual(response.status, 200);
    }

    const resp = await fetch(url, {
      headers: {
        "x-client-id": "Alice",
      },
    });
    assert.strictEqual(resp.status, 429);
  } finally {
    await closeServer(server1);
  }
});

test("Missing x-client-id retuns 400", async () => {
  const server2 = createMyServer();
  await startServer(server2);
  try {
    const address = server2.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not start correctly");
    }
    const url = "http://localhost:" + address.port + "/hello";
    const response = await fetch(url);
    assert.strictEqual(response.status, 400);
  } finally {
    await closeServer(server2);
  }
});

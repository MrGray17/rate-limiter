import { server } from "./server.js";
import test from "node:test";
import assert from "node:assert/strict";

test("allows first 5 requests and rejects the 6th", async () => {
  const startServer = () => {
    return new Promise<void>((resolve) => {
      server.listen(0, () => {
        resolve();
      });
    });
  };

  const closeServer = () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };

  await startServer();

  try {
    const address = server.address();
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
    await closeServer();
  }
});

import { createMyServer } from "./server.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, closeServer } from "./test-utils.js";

const BoringServerManagement = async (path: string) => {
  const serverP = createMyServer();
  await startServer(serverP);

  const address = serverP.address();
  try {
    if (!address || typeof address === "string") {
      throw new Error("Server did not start correctly");
    }
    const url = "http://localhost:" + address.port + path;
    return { url, serverP };
  } catch (error) {
    await closeServer(serverP);
    throw error;
  }
};

test("allows first 5 requests and rejects the 6th", async () => {
  const setup = await BoringServerManagement("/check");

  try {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(setup.url, {
        headers: {
          "x-client-id": "Alice",
        },
        method: "POST",
      });
      assert.strictEqual(response.status, 200);
    }

    const resp = await fetch(setup.url, {
      headers: {
        "x-client-id": "Alice",
      },
      method: "POST",
    });
    assert.strictEqual(resp.status, 429);
  } finally {
    await closeServer(setup.serverP);
  }
});

test("Missing x-client-id retuns 400", async () => {
  const setup = await BoringServerManagement("/check");
  try {
    const response = await fetch(setup.url, {
      method: "POST",
    });
    assert.strictEqual(response.status, 400);
  } finally {
    await closeServer(setup.serverP);
  }
});

test("405 if the method is GET", async () => {
  const setup = await BoringServerManagement("/check");
  try {
    const response = await fetch(setup.url, { method: "GET" });
    assert.strictEqual(response.status, 405);
  } finally {
    await closeServer(setup.serverP);
  }
});

test("A GET /health should return 200", async () => {
  const setup = await BoringServerManagement("/health");

  try {
    const response = await fetch(setup.url, { method: "GET" });
    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.serverP);
  }
});

test("Wrong path returns 404", async () => {
  const setup = BoringServerManagement("/banana");
  try {
    const response = await fetch((await setup).url);
    assert.strictEqual(response.status, 404);
  } finally {
    await closeServer((await setup).serverP);
  }
});

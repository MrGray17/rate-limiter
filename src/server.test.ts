import { createMyServer, type Limiter } from "./server.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, closeServer } from "./test-utils.js";

const allowLimiter: Limiter = {
  isAllowed: () => true,
};

const rejectLimiter: Limiter = {
  isAllowed: () => false,
};

const setupTestServer = async (path: string, limiter: Limiter = allowLimiter) => {
  const server = createMyServer(limiter);
  await startServer(server);

  const address = server.address();

  try {
    if (!address || typeof address === "string") {
      throw new Error("Server did not start correctly");
    }

    const url = "http://localhost:" + address.port + path;
    return { url, server };
  } catch (error) {
    await closeServer(server);
    throw error;
  }
};

test("returns 200 when limiter allows the request", async () => {
  const setup = await setupTestServer("/check", allowLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: {
        "x-client-id": "Alice",
      },
      method: "POST",
    });

    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.server);
  }
});

test("returns 429 when limiter rejects the request", async () => {
  const setup = await setupTestServer("/check", rejectLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: {
        "x-client-id": "Alice",
      },
      method: "POST",
    });

    assert.strictEqual(response.status, 429);
  } finally {
    await closeServer(setup.server);
  }
});

test("Missing x-client-id returns 400", async () => {
  const setup = await setupTestServer("/check");

  try {
    const response = await fetch(setup.url, {
      method: "POST",
    });
    assert.strictEqual(response.status, 400);
  } finally {
    await closeServer(setup.server);
  }
});

test("405 if the method is GET", async () => {
  const setup = await setupTestServer("/check");

  try {
    const response = await fetch(setup.url, { method: "GET" });
    assert.strictEqual(response.status, 405);
  } finally {
    await closeServer(setup.server);
  }
});

test("A GET /health should return 200", async () => {
  const setup = await setupTestServer("/health");

  try {
    const response = await fetch(setup.url, { method: "GET" });
    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.server);
  }
});

test("Wrong path returns 404", async () => {
  const setup = await setupTestServer("/banana");

  try {
    const response = await fetch(setup.url);
    assert.strictEqual(response.status, 404);
  } finally {
    await closeServer(setup.server);
  }
});

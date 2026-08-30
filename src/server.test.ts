import assert from "node:assert/strict";
import test from "node:test";

import { closeServer, startServer } from "./test-utils.js";
import { createRateLimitServer, type Limiter } from "./server.js";

const allowLimiter: Limiter = {
  isAllowed: () => true,
};

const rejectLimiter: Limiter = {
  isAllowed: () => false,
};

const setupTestServer = async (path: string, limiter: Limiter = allowLimiter) => {
  const server = createRateLimitServer(limiter);
  await startServer(server);

  const address = server.address();

  try {
    if (!address || typeof address === "string") {
      throw new Error("Server did not start correctly");
    }

    const url = `http://localhost:${address.port}${path}`;
    return { url, server };
  } catch (error) {
    await closeServer(server);
    throw error;
  }
};

test("POST /check returns structured 200 when limiter allows", async () => {
  const setup = await setupTestServer("/check", allowLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "Alice" },
      method: "POST",
    });

    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.ok(response.headers.get("x-request-id"));
    assert.deepStrictEqual(await response.json(), { allowed: true });
  } finally {
    await closeServer(setup.server);
  }
});

test("POST /check returns structured 429 when limiter rejects", async () => {
  const setup = await setupTestServer("/check", rejectLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "Alice" },
      method: "POST",
    });

    assert.strictEqual(response.status, 429);

    const body = (await response.json()) as {
      allowed: boolean;
      error: { code: string };
    };

    assert.strictEqual(body.allowed, false);
    assert.strictEqual(body.error.code, "RATE_LIMITED");
  } finally {
    await closeServer(setup.server);
  }
});

test("POST /check trims client id before passing it to limiter", async () => {
  let receivedClientId = "";

  const limiter: Limiter = {
    isAllowed: (clientId) => {
      receivedClientId = clientId;
      return true;
    },
  };

  const setup = await setupTestServer("/check", limiter);

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "  Alice  " },
      method: "POST",
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(receivedClientId, "Alice");
  } finally {
    await closeServer(setup.server);
  }
});

test("POST /check rejects missing client id", async () => {
  const setup = await setupTestServer("/check");

  try {
    const response = await fetch(setup.url, { method: "POST" });

    assert.strictEqual(response.status, 400);
  } finally {
    await closeServer(setup.server);
  }
});

test("POST /check rejects blank client id", async () => {
  const setup = await setupTestServer("/check");

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "   " },
      method: "POST",
    });

    assert.strictEqual(response.status, 400);
  } finally {
    await closeServer(setup.server);
  }
});

test("GET /check returns 405 and advertises POST", async () => {
  const setup = await setupTestServer("/check");

  try {
    const response = await fetch(setup.url, { method: "GET" });

    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.headers.get("allow"), "POST");
  } finally {
    await closeServer(setup.server);
  }
});

test("GET /health returns JSON health status", async () => {
  const setup = await setupTestServer("/health");

  try {
    const response = await fetch(setup.url, { method: "GET" });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { status: "ok" });
  } finally {
    await closeServer(setup.server);
  }
});

test("routing uses pathname and ignores query string", async () => {
  const setup = await setupTestServer("/health?source=probe");

  try {
    const response = await fetch(setup.url, { method: "GET" });

    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.server);
  }
});

test("unknown path returns structured 404", async () => {
  const setup = await setupTestServer("/banana");

  try {
    const response = await fetch(setup.url);

    assert.strictEqual(response.status, 404);

    const body = (await response.json()) as { error: { code: string } };
    assert.strictEqual(body.error.code, "NOT_FOUND");
  } finally {
    await closeServer(setup.server);
  }
});

test("server supports asynchronous limiters", async () => {
  const asyncLimiter: Limiter = {
    isAllowed: async () => true,
  };

  const setup = await setupTestServer("/check", asyncLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "Alice" },
      method: "POST",
    });

    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.server);
  }
});

test("limiter failures return 503 instead of crashing the server", async () => {
  const failingLimiter: Limiter = {
    isAllowed: async () => {
      throw new Error("backend unavailable");
    },
  };

  const setup = await setupTestServer("/check", failingLimiter);

  try {
    const response = await fetch(setup.url, {
      headers: { "x-client-id": "Alice" },
      method: "POST",
    });

    assert.strictEqual(response.status, 503);

    const body = (await response.json()) as { error: { code: string } };
    assert.strictEqual(body.error.code, "LIMITER_UNAVAILABLE");
  } finally {
    await closeServer(setup.server);
  }
});

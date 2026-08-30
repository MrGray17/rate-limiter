import { randomUUID } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface Limiter {
  isAllowed(userId: string): boolean | Promise<boolean>;
}

type JsonBody = Record<string, unknown>;

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: JsonBody,
  headers: Record<string, string> = {},
) => {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload).toString(),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });

  response.end(payload);
};

const methodNotAllowed = (response: ServerResponse, allowedMethod: string) => {
  sendJson(
    response,
    405,
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      },
    },
    { allow: allowedMethod },
  );
};

const handleCheck = async (
  request: IncomingMessage,
  response: ServerResponse,
  limiter: Limiter,
) => {
  if (request.method !== "POST") {
    methodNotAllowed(response, "POST");
    return;
  }

  const rawClientId = request.headers["x-client-id"];

  if (typeof rawClientId !== "string" || rawClientId.trim().length === 0) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CLIENT_ID",
        message: "X-Client-Id must be a non-empty string",
      },
    });
    return;
  }

  const clientId = rawClientId.trim();

  let allowed: boolean;

  try {
    allowed = await limiter.isAllowed(clientId);
  } catch (error) {
    console.error("Rate limiter decision failed", error);

    sendJson(response, 503, {
      error: {
        code: "LIMITER_UNAVAILABLE",
        message: "Rate limiter is temporarily unavailable",
      },
    });
    return;
  }

  if (!allowed) {
    sendJson(response, 429, {
      allowed: false,
      error: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded",
      },
    });
    return;
  }

  sendJson(response, 200, { allowed: true });
};

const handleHealth = (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "GET") {
    methodNotAllowed(response, "GET");
    return;
  }

  sendJson(response, 200, { status: "ok" });
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  limiter: Limiter,
) => {
  const requestId = randomUUID();
  response.setHeader("x-request-id", requestId);

  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname === "/check") {
    await handleCheck(request, response, limiter);
    return;
  }

  if (requestUrl.pathname === "/health") {
    handleHealth(request, response);
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
};

export const createRateLimitServer = (limiter: Limiter) => {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, limiter).catch((error) => {
      console.error("Unhandled HTTP request error", error);

      if (!response.headersSent) {
        sendJson(response, 500, {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal server error",
          },
        });
        return;
      }

      response.destroy();
    });
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;

  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  });

  return server;
};

// Temporary compatibility export while callers migrate to the clearer name.
export const createMyServer = createRateLimitServer;

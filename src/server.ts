import { randomUUID } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface Limiter {
  isAllowed(userId: string): boolean | Promise<boolean>;
}

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
) => {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString(),
    "cache-control": "no-store",
  });

  response.end(payload);
};

const methodNotAllowed = (
  response: ServerResponse,
  expectedMethod: string
) => {
  response.setHeader("allow", expectedMethod);

  sendJson(response, 405, {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Method Not Allowed",
    },
  });
};

const handleCheck = async (
  request: IncomingMessage,
  response: ServerResponse,
  limiter: Limiter
) => {
  if (request.method !== "POST") {
    methodNotAllowed(response, "POST");
    return;
  }

  const user = request.headers["x-client-id"];

  if (typeof user !== "string" || user.trim().length === 0) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_CLIENT_ID",
        message: "X-Client-Id must be a non-empty string",
      },
    });

    return;
  }

  let allowed: boolean;

  try {
    allowed = await limiter.isAllowed(user.trim());
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
        message: "Rate Limit Exceeded",
      },
    });

    return;
  }

  sendJson(response, 200, {
    allowed: true,
  });
};

export const createRateLimitServer = (limiter: Limiter) => {
  const server = http.createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      const requestId = randomUUID();

      response.setHeader("x-request-id", requestId);

      const requestUrl = new URL(
        request.url ?? "/",
        "http://localhost"
      );

      if (requestUrl.pathname === "/check") {
        void handleCheck(request, response, limiter).catch((error) => {
          console.error(
            `Unhandled HTTP request error [${requestId}]`,
            error
          );

          if (!response.headersSent) {
            sendJson(response, 500, {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Internal Server Error",
              },
            });

            return;
          }

          response.destroy();
        });

        return;
      }

      if (requestUrl.pathname === "/health") {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET");
          return;
        }

        sendJson(response, 200, {
          status: "ok",
        });

        return;
      }

      sendJson(response, 404, {
        error: {
          code: "NOT_FOUND",
          message: "Path Not Found",
        },
      });
    }
  );
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;
server.on("clientError", (_error, socket) => {
  if (socket.writable) { //means can we still send data through this connection?
    socket.end(
      "HTTP/1.1 400 Bad Request\r\n" +   //\return\new
      "Connection: close\r\n" +
      "Content-Length: 0\r\n" +
      "\r\n"
    );
  }
});
  return server;
};
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface Limiter {
  isAllowed(userId: string): boolean;
}

export const createMyServer = (limiter: Limiter) => {
  const HANDLER_FUNCTION = (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    if (request.url == "/check") {
      //we are protection the /check path

      if (request.method != "POST") {
        response.statusCode = 405;
        response.end("Method Not Allowed");
        return;
      }
      const clientId = request.headers["x-client-id"];

      if (clientId == undefined) {
        response.statusCode = 400;
        response.end("Bad Request");
        return;
      }

      if (Array.isArray(clientId)) {
        response.statusCode = 400;
        response.end("Bad Request");
        return;
      }

      const allowed = limiter.isAllowed(clientId);

      if (!allowed) {
        response.statusCode = 429;
        response.end("Too many requests");
        return;
      }

      response.end("hello");
    } else if (request.url == "/health") {
      if (request.method != "GET") {
        response.statusCode = 405;
        response.end("Method Not Allowed");
        return;
      }
      response.end("Server is running ...");
    } else {
      response.statusCode = 404;
      response.end("Not found");
    }
  };
  return http.createServer(HANDLER_FUNCTION);
};

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter } from "./limiter.js";

export const createMyServer = () => {
  const rateLimiter = new RateLimiter({
    windowSize: 10_000,
    requestLimit: 5,
    clock: () => Date.now(),
  });
  const HANDLER_FUNCTION = (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    if (request.url == "/check") {
      //we are protection the /check path

      if (request.method != "POST"){ response.statusCode = 405
        response.end("Method Not Allowed")
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

      const allowed = rateLimiter.isAllowed(clientId);

      if (!allowed) {
        response.statusCode = 429;
        response.end("Too many requests");
        return;
      }

      response.end("hello");
    } else if (request.url == "/health") {
      if (request.method != "GET") {response.statusCode = 405
        response.end("Method Not Allowed")
          return}
      response.end("Server is running ...");
    } else {
      response.statusCode = 404;
      response.end("Not found");
    }
  };
  return http.createServer(HANDLER_FUNCTION);
};

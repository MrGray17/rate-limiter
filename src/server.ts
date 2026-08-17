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
    if (request.url == "/hello") {
      //we are protection the /hello path
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

      console.log(request.headers["x-client-id"]);
      response.end("hello");
    } else if (request.url == "/status") {
      response.end("Server is running ...");
    } else {
      response.statusCode = 404;
      response.end("Not found");
    }
  };
  return http.createServer(HANDLER_FUNCTION);
};

createMyServer();

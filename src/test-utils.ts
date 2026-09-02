import type { Server } from "node:http";
import { createRateLimitServer } from "./server.js";
export const startServer = (server: Server) => {
    return new Promise<void>((resolve) => {
      server.listen(0 , () => {
        resolve();
      });
    });
  };

export const closeServer = (server: Server) => {
return new Promise<void>((resolve) => {
    server.close(() => {
    resolve();
    });
});
};
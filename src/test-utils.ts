import type { Server } from "node:http";
import { createRateLimitServer } from "./server.js";
export const startServer = (server: Server) => {   //the server we returned from server.ts
    return new Promise<void>((resolve) => {  //resolve is used to create a condition on when
      server.listen(0 , () => {       //to turn the promise to successful
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
import type { RedisClientType } from "redis";

const script = `
local count = redis.call("INCR", KEYS[1])

if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end

return count
`;

type RedisFixedWindowConfig = {
  client: RedisClientType;
  requestLimit: number;
  windowSeconds: number;
};

export class RedisFixedWindow {
  client: RedisClientType;
  requestLimit: number;
  windowSeconds: number;    //use PEXPIRE if we want ms

  constructor(config: RedisFixedWindowConfig) {
    this.client = config.client;
    this.requestLimit = config.requestLimit;
    this.windowSeconds = config.windowSeconds;
  }

  async isAllowed(userId: string): Promise<boolean> {
    const key = `rate-limit:${userId}`;

    const result = await this.client.eval(script, {
      keys: [key],
      arguments: [this.windowSeconds.toString()],
    });

    const count = Number(result);

    return count <= this.requestLimit;
  }
}
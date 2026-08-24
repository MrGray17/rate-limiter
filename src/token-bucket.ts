type UserState = {
  tokens: number;
  lastRefillTime: number;
};

type TokenBucketConfig = {
  capacity: number;
  tokensPerTimeUnit: number;
  timeUnit: number;
  clock: () => number;
};

export class TokenBucket {
  capacity: number;
  tokensPerTimeUnit: number;
  timeUnit: number;
  clock: () => number;
  users: Map<string, UserState>;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.tokensPerTimeUnit = config.tokensPerTimeUnit;
    this.timeUnit = config.timeUnit;
    this.clock = config.clock;
    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const state = this.users.get(userId);

    if (state === undefined) {
      this.users.set(userId, {
        tokens: this.capacity - 1,
        lastRefillTime: this.clock(),
      });
      return true;
    }

    const elapsed = this.clock() - state.lastRefillTime;
    const refillRate = this.tokensPerTimeUnit / this.timeUnit;
    const refilledTokens = Math.min(
      this.capacity,
      state.tokens + elapsed * refillRate,
    );

    if (refilledTokens < 1) {
      return false;
    } else {
      state.tokens = refilledTokens - 1;
      state.lastRefillTime = this.clock();
      return true;
    }
  }
}

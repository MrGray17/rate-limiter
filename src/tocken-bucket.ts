type userState = {
  tockens: number;
  lastRefill: number;
};

type configuration = {
  bucketLimit: number;
  tockensPerTimeUnit: number;
  timeUnit: number;
  clock: () => number;
};
export class tockenBucket {
  bucketLimit: number;
  tockensPerTimeUnit: number;
  timeUnit: number;
  clock: () => number;
  users: Map<string, userState>;

  constructor(config: configuration) {
    this.bucketLimit = config.bucketLimit;
    this.tockensPerTimeUnit = config.tockensPerTimeUnit;
    this.timeUnit = config.timeUnit;
    this.clock = config.clock;
    this.users = new Map<string, userState>();
  }

  isAllowed(userId: string): boolean {
    const state = this.users.get(userId);
    if (state === undefined) {
      this.users.set(userId, {
        tockens: this.bucketLimit - 1,
        lastRefill: this.clock(),
      });
      return true;
    }
    const elapsed = this.clock() - state.lastRefill;
    const refill = this.tockensPerTimeUnit / this.timeUnit;
    const refilled = Math.min(
      this.bucketLimit,
      state.tockens + elapsed * refill,
    );

    if (refilled < 1) {
      return false;
    } else {
      state.tockens = refilled - 1;
      state.lastRefill = this.clock();
      return true;
    }
  }
}

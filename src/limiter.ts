type UserState = {
  count: number; // count means the number of requests already accepted, not incoming ones
  windowStart: number;
};

type rateLimiterConfig = {
  // we enforce the user to write manually
  windowSize: number; //parameters to avoid confusing "number" type order
  requestLimit: number;
  clock: () => number;
};

export class RateLimiter {
  users: Map<string, UserState>;
  clock: () => number;
  requestLimit: number;
  windowSize: number;

  constructor(rateLimiterConfig: rateLimiterConfig) {
    this.clock = rateLimiterConfig.clock;
    this.requestLimit = rateLimiterConfig.requestLimit;
    this.windowSize = rateLimiterConfig.windowSize;

    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const currentClock = this.clock(); // calling this.clock() several times may return different numbers

    const state = this.users.get(userId);

    if (state == undefined) {
      this.users.set(userId, { count: 1, windowStart: currentClock });
      return true;
    }

    const elapsed = currentClock - state.windowStart;

    if (elapsed >= this.windowSize) {
      this.users.set(userId, { count: 1, windowStart: currentClock });
      return true;
    } else {
      if (state.count >= this.requestLimit) {
        return false;
      } else {
        this.users.set(userId, {
          count: state.count + 1,
          windowStart: state.windowStart,
        });
        return true;
      }
    }
  }
}

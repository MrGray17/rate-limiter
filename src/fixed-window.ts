type UserState = {
  count: number;
  windowStart: number;
};

type FixedWindowConfig = {
  windowSize: number;
  requestLimit: number;
  clock: () => number;
};

export class FixedWindow {
  users: Map<string, UserState>;
  clock: () => number;
  requestLimit: number;
  windowSize: number;

  constructor(config: FixedWindowConfig) {
    this.clock = config.clock;
    this.requestLimit = config.requestLimit;
    this.windowSize = config.windowSize;
    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const currentClock = this.clock();
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

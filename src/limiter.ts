type UserState = {
    count : number ,  // count means the number of requests already accepted, not incoming ones
    windowStart : number ,
}

export class RateLimiter {
    users : Map <string , UserState> ;
    clock : () => number;
    windowSize = 10_000 ;
    requestLimit = 5;

   constructor (clock : () => number) {
    this.clock = clock ;
    this.users = new Map <string , UserState> ()
   }

   check(userId : string) : boolean {
    const currentClock = this.clock() ; // calling this.clock() several times may return different numbers

    const state = this.users.get(userId);

    if (state == undefined) {
        this.users.set(userId , {count : 1 , windowStart : currentClock})
        return true;
    }
    
    const elapsed = currentClock - state.windowStart ;

        if (elapsed >= this.windowSize) {
            this.users.set(userId , {count : 1 , windowStart : currentClock})
            return true;
        }
        

        else {
            if (state.count >= this.requestLimit) {
                return false;
            }
             else {
                this.users.set (userId , {count : state.count + 1 , windowStart : state.windowStart})
                return true;
            }

        }
   }
}




type UserState = {
    count : number ,  // count means the number of requests already accepted, not incoming ones
    windowStart : number ,
}

export class RateLimiter {
   users : Map<string , UserState> ;

    windowSize = 10_000 ;
    requestLimit = 5;

   constructor () {
    this.users = new Map <string , UserState> ()
   }

   check(userId : string) : boolean {
    const state = this.users.get(userId);

    if (state == undefined) {
        this.users.set(userId , {count : 1 , windowStart : Date.now()})
        return true;
    }
    
    const elapsed = Date.now() - state.windowStart ;

        if (elapsed >= this.windowSize) {
            this.users.set(userId , {count : 1 , windowStart : Date.now()})
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




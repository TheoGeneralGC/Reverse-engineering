/** Command's one-step arrow selection only. No catalogue, modifier jumps or
 * invocation policy is inferred here. Empty results retain the neutral index0. */
export function commandArrowIndex(index:number,count:number,direction:1|-1):number{
 if(!Number.isSafeInteger(count)||count<=0)return 0;
 const current=Number.isSafeInteger(index)&&index>=0&&index<count?index:0;
 return direction===1?(current===count-1?0:current+1):(current===0?count-1:current-1);
}

/** Exact whole-group coverage selection. Uses a compact bitset, never splits translations. */
export function closestGroups<T>(items:readonly T[],weight:(item:T)=>number,target:number,limit:number) {
  const bound=Math.max(0,Math.floor(limit)),goal=Math.max(0,Math.min(bound,Math.round(target)))
  const bits=new Uint32Array((bound>>>5)+1),parent=new Int32Array(bound+1),chosenBy=new Int32Array(bound+1)
  bits[0]=1;chosenBy.fill(-1)
  for(let index=0;index<items.length;index++) {
    const size=weight(items[index])
    if(!Number.isSafeInteger(size)||size<=0||size>bound)continue
    const shift=size>>>5,part=size&31
    // Descending writes ensure each item is only used once, including shifts <32.
    for(let word=bits.length-1;word>=shift;word--) {
      const source=word-shift
      let moved=part ? (bits[source]<<part)|(source>0?bits[source-1]>>>(32-part):0) : bits[source]
      if(word===bits.length-1&&(bound&31)!==31)moved&=0xffffffff>>>(31-(bound&31))
      let fresh=(moved&~bits[word])>>>0
      bits[word]|=moved
      while(fresh) {
        const bit=31-Math.clz32(fresh&-fresh),sum=word*32+bit
        parent[sum]=sum-size;chosenBy[sum]=index
        fresh=(fresh&(fresh-1))>>>0
      }
    }
  }
  // At equal distance prefer the lower coverage, preserving Chinese assistance.
  let best=0
  for(let sum=1;sum<=bound;sum++)if((bits[sum>>>5]&(1<<(sum&31)))&&Math.abs(sum-goal)<Math.abs(best-goal))best=sum
  const selected:T[]=[]
  for(let sum=best;sum>0;sum=parent[sum])selected.push(items[chosenBy[sum]])
  return selected
}

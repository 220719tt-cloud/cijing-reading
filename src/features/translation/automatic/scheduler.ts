// Conservative frontend budget; the Worker continues enforcing its own stricter limits.
export const AUTO_POLICY={segments:3,source:450,intervalMs:6100,maxRequests:240}
export function abortableDelay(ms:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('翻译已停止。','AbortError'));return}
    const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(new DOMException('翻译已停止。','AbortError'))}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},ms)
    signal.addEventListener('abort',stop,{once:true})
  })
}
function browserStorage(){try{return typeof localStorage==='undefined'?undefined:localStorage}catch{return undefined}}
/** Serializes starts per service, including recoveries and multiple books in this tab. */
export function createTranslationScheduler(now=Date.now,delay=abortableDelay,storage:Storage|undefined=browserStorage()){
  const slots=new Map<string,{tail:Promise<void>;next:number}>()
  function slot(endpoint:string){let value=slots.get(endpoint);if(!value){value={tail:Promise.resolve(),next:0};slots.set(endpoint,value)}return value}
  const key=(endpoint:string)=>`cijing-translation-next:${endpoint}`
  function stored(endpoint:string){try{const n=Number(storage?.getItem(key(endpoint)));return Number.isFinite(n)&&n>0&&n<=now()+3600000?n:0}catch{return 0}}
  function save(endpoint:string,next:number){try{storage?.setItem(key(endpoint),String(next))}catch{/* In-memory pacing still applies. */}}
  return {
    async start(endpoint:string,signal:AbortSignal,onWait?:(ms:number)=>void){
      const s=slot(endpoint),before=s.tail;let release!:()=>void
      s.tail=new Promise<void>(resolve=>{release=resolve})
      try{
        await before
        if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
        const ms=Math.max(0,s.next,stored(endpoint))-now()
        if(ms>0){onWait?.(ms);await delay(ms,signal)}
        if(signal.aborted)throw new DOMException('翻译已停止。','AbortError')
        s.next=now()+AUTO_POLICY.intervalMs;save(endpoint,s.next)
      }finally{release()}
    },
    defer(endpoint:string,seconds:number){const s=slot(endpoint);s.next=Math.max(s.next,now()+Math.min(3600,Math.max(60,seconds))*1000);save(endpoint,s.next)},
  }
}
export const translationScheduler=createTranslationScheduler()

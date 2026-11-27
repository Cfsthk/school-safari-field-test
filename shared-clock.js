// All school rooms on a deployment use its HTTP clock. Requests only happen at
// startup, on returning to a long-suspended tab, or after a long session.
export function createSchoolClock({monotonic=()=>performance.now(),wall=Date.now,request=fetch}={}) {
  let offset=wall()-monotonic(), pending=null, lastAttempt=-Infinity, lastSuccess=-Infinity;
  const now=()=>offset+monotonic();
  function sync(resume=false) {
    const elapsed=monotonic();
    if(pending || (!resume && elapsed-lastSuccess<15*60000) || elapsed-lastAttempt<10000) return pending;
    lastAttempt=elapsed;
    const signal=new AbortController();
    const timer=setTimeout(()=>signal.abort(),4000);
    async function calibrate() {
      const page=new URL('./index.html',import.meta.url);
      page.searchParams.set('clock',crypto.randomUUID());
      const response=await request(page,{method:'HEAD',cache:'no-store',signal:signal.signal});
      const date=Date.parse(response.headers.get('Date'));
      if(!response.ok || !Number.isFinite(date))return;
      const age=Number(response.headers.get('Age')) || 0, end=monotonic();
      // HTTP dates have whole-second precision. Take the midpoint of the second.
      offset=date+Math.max(0,age)*1000+500-(elapsed+end)/2;
      lastSuccess=end;
    }
    pending=calibrate().catch(()=>{}).finally(()=>{clearTimeout(timer);pending=null;});
    return pending;
  }
  return {now,sync};
}

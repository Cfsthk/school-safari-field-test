// One local cartridge and a battery file. A stale tab cannot overwrite a newer save.
let opening;
function database() {
  return opening ??= new Promise((resolve,reject)=>{
    const req=indexedDB.open('emerald-safari-native',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('library');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{opening=null;reject(req.error);};
  });
}
async function transaction(mode, action) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('library',mode);
    let value;
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('儲存空間暫時無法使用。'));
    action(tx.objectStore('library'),result=>{value=result;});
  });
}
export const readLocal = key => transaction('readonly',(s,done)=>{
  const req=s.get(key);req.onsuccess=()=>done(req.result);
});
export const writeLocal = (key,value) => transaction('readwrite',s=>s.put(value,key));
export function writeBattery(bytes, revision, {writer,serial}={}) {
  return transaction('readwrite',(s,done)=>{
    const req=s.get('battery');
    req.onsuccess=()=>{
      const current=req.result?.revision ?? 0;
      if(current!==revision) { done(null); return; }
      s.put({bytes:bytes.slice(),revision:current+1,writer,serial},'battery');
      done(current+1);
    };
  });
}

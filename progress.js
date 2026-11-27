// The IndexedDB revision protects a shared browser profile across tabs. The small
// synchronous journal covers iPad suspending a page with its last write in flight.
import {readLocal,writeBattery} from './library.js?auto=1';
import {batteryBytes} from './cartridge.js';

const journalKey='emerald-safari-exit-v1';
function readJournal(storage) {
  try { return JSON.parse(storage?.getItem(journalKey) || 'null'); }
  catch { return null; }
}
function clearJournal(storage,writer,serial) {
  const saved=readJournal(storage);
  if(saved?.writer===writer && saved.serial<=serial) {
    try{storage.removeItem(journalKey);}catch{}
  }
}
function pack(bytes) {
  let text='';
  for(let i=0;i<bytes.length;i+=0x4000) text+=String.fromCharCode(...bytes.subarray(i,i+0x4000));
  return btoa(text);
}
function unpack(text) {
  if(typeof text!=='string' || text.length!==174764)return null;
  try{return batteryBytes(Uint8Array.from(atob(text),ch=>ch.charCodeAt(0)));}
  catch{return null;}
}
export function localJournal() {
  try{return window.localStorage;}catch{return null;}
}
export async function readProgress({read=readLocal,write=writeBattery,storage=localJournal()}={}) {
  const current=await read('battery');
  const last=readJournal(storage);
  if(!last || typeof last.writer!=='string' || !Number.isSafeInteger(last.serial))return current;
  const revision=current?.revision ?? 0;
  const pending=last.base===revision || (last.writer===current?.writer && last.serial>current.serial);
  if(pending) {
    const bytes=unpack(last.data);
    if(bytes) {
      const {writer,serial}=last;
      const next=await write(bytes,revision,{writer,serial});
      if(next!==null) {clearJournal(storage,writer,serial);return {bytes,revision:next,writer,serial};}
      return await read('battery');
    }
  }
  clearJournal(storage,last.writer,last.serial);
  return current;
}

export function createProgressWriter(record,{onConflict,onError,storage=localJournal(),write=writeBattery}={}) {
  const writer=crypto.randomUUID();
  let revision=record?.revision ?? 0, bytes=record?.bytes ?? null;
  let serial=0, saved=0, conflict=false, pending=null;
  async function drain() {
    while(saved<serial && !conflict) {
      const id=serial;
      try{
        const result=await write(bytes,revision,{writer,serial:id});
        if(result===null) {conflict=true;clearJournal(storage,writer,serial);onConflict?.();return;}
        revision=result;saved=id;
        if(readJournalOnExit) clearJournal(storage,writer,id);
      }catch{onError?.();return;}
    }
  }
  let readJournalOnExit=false;
  function flush() {
    if(!pending && saved<serial && !conflict) pending=drain().finally(()=>{pending=null;});
    return pending;
  }
  return {
    get bytes(){return bytes;},
    get conflict(){return conflict;},
    offer(next) {
      if(next){bytes=next;serial++;}
      return flush();
    },
    flush,
    suspend() {
      if(saved>=serial || conflict || !storage)return;
      readJournalOnExit=true;
      try{storage.setItem(journalKey,JSON.stringify({writer,serial,base:revision,data:pack(bytes)}));}catch{}
    }
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {createProgressWriter,readProgress} from '../progress.js';
import {createSchoolClock} from '../shared-clock.js';

function battery(mark) {
  const b=new Uint8Array(131072), view=new DataView(b.buffer);
  for(let i=0;i<14;i++) {
    const footer=i*4096+0xff4;
    view.setUint16(footer,i,true);view.setUint32(footer+4,0x08012025,true);
    view.setUint32(footer+8,2,true);
  }
  b[0]=mark;return b;
}
function storage() {
  const m=new Map();
  return {getItem:key=>m.get(key),setItem:(key,v)=>m.set(key,v),removeItem:key=>m.delete(key)};
}
const forever=()=>new Promise(()=>{});
test('closing the app preserves a newer change while IndexedDB is writing',async()=>{
  const s=storage(), initial={bytes:battery(1),revision:5};
  const writer=createProgressWriter(initial,{storage:s,write:forever});
  writer.offer(battery(2));writer.offer(battery(3));writer.suspend();
  const recovered=await readProgress({storage:s,read:async()=>initial,write:async (bytes,rev)=>{
    assert.equal(bytes[0],3);assert.equal(rev,5);return rev+1;
  }});
  assert.equal(recovered.revision,6);
  assert.equal(recovered.bytes[0],3);
});
test('a stale tab cannot replace progress another tab has committed',async()=>{
  const s=storage();
  const a=createProgressWriter({bytes:battery(1),revision:5},{storage:s,write:forever});
  a.offer(battery(2));a.suspend();
  const newest={bytes:battery(7),revision:6,writer:'other tab',serial:1};
  assert.equal(await readProgress({storage:s,read:async()=>newest,write:async()=>assert.fail()}),newest);
});
test('multiple captures during a write commit the newest state in revision order',async()=>{
  let release;const gate=new Promise(ok=>{release=ok;});
  const writes=[];
  const w=createProgressWriter(null,{storage:storage(),write:async (bytes,r)=>{
    writes.push([bytes[0],r]);if(!r)await gate;return r+1;
  }});
  const done=w.offer(battery(1));w.offer(battery(2));w.offer(battery(3));release();await done;
  assert.deepEqual(writes,[[1,0],[3,1]]);
});
test('server time drives the clock even when two devices have different wall clocks',async()=>{
  const date='Fri, 27 Nov 2026 06:00:00 GMT';
  let t=2000, requests=0;
  const request=async()=>{requests++;return {ok:true,headers:new Headers({date})};};
  const clocks=[0,800000].map(wall=>createSchoolClock({wall:()=>wall,monotonic:()=>t,request}));
  await Promise.all(clocks.map(c=>c.sync()));t+=65000;
  for(const c of clocks)assert.equal(c.now(),Date.parse(date)+65500);
  await clocks[0].sync();assert.equal(requests,2);
});

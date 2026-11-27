import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureAutosave,readBatteryLocation,warpBatteryForLogin} from '../native-save.js';

const ram=0x02000000, prefs=ram+0x24ab0, field=ram+0x25a60, boxes=ram+0x29870, safari=0x3598;
function machine() {
  const banks={2:new Uint8Array(0x40000),3:new Uint8Array(0x8000)};
  const get=(a,n)=>banks[a>>>24].subarray(a&0xffffff,(a&0xffffff)+n);
  const view=a=>new DataView(banks[a>>>24].buffer,a&0xffffff);
  const core={read8:a=>view(a).getUint8(0),read16:a=>view(a).getUint16(0,true),
    read32:a=>view(a).getUint32(0,true),readBytes:get};
  const put=(a,v,n=1)=>view(a)['setUint'+(n*8)](0,v,true);
  put(0x03005d8c,field,4);put(0x03005d90,prefs,4);put(0x03005d94,boxes,4);
  put(field+safari,0x5347,2);put(field+safari+4,4);
  put(0x030022c4,0x08085e5d,4);
  put(0x02037350,1);put(0x02037352,1);
  put(0x02037360,16,2);put(0x02037362,18,2);
  put(field+4,0);put(field+5,16);
  return {core,put};
}
const word=(data,at)=>new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(at,true);
function block1Byte(bytes,counter,offset) {
  for(let i=(counter%2)*14; i<(counter%2+1)*14;i++) {
    const id=bytes[i*4096+0xff4];
    if(id===1+Math.floor(offset/3968))return bytes[i*4096+offset%3968];
  }
  throw Error('Missing save sector');
}
test('first native save is readable without previous flash; login warp does not alter the original or heal',()=>{
  const {core,put}=machine();
  put(field+safari+2,125,2);put(field+safari+8,255);put(field+safari+12+8,0x31);
  const first=captureAutosave(core);
  assert.equal(first.length,131072);
  assert.deepEqual(readBatteryLocation(first),{group:0,map:16,x:9,y:11,fallback:undefined,summitUnlocked:true});
  assert.equal(captureAutosave(core,{previous:first}),null);
  const next=warpBatteryForLogin(first,{group:2,map:2,x:7,y:4});
  assert.equal(readBatteryLocation(next).group,2);
  assert.equal(readBatteryLocation(first).map,16);
  assert.equal(block1Byte(next,2,safari+4),4);
  assert.equal(block1Byte(next,2,safari+2),125);
  assert.equal(block1Byte(next,2,safari+12+8),0x31);
  assert.equal(captureAutosave(core,{previous:first,location:{area:'hoenn-1-10',x:2,y:4}}),null);
});
test('older valid slot survives truncation or corruption of latest slot',()=>{
  const {core,put}=machine();const older=captureAutosave(core);
  put(field+safari+2,30,2);
  const newer=captureAutosave(core,{previous:older});
  assert.ok(newer);assert.ok(word(newer,0xffc)===2);
  newer[0] ^= 255;
  assert.equal(readBatteryLocation(newer).map,16);
  assert.ok(captureAutosave(core,{previous:newer}));
  const both=new Uint8Array(131072);
  assert.equal(readBatteryLocation(both),null);
  assert.equal(warpBatteryForLogin(both,{group:2,map:2,x:7,y:4}),null);
});
test('shop saves purchases and original encrypted inventory without changing emulated RAM',()=>{
  const {core,put}=machine(),shop=0x02023864,key=0x12345678;
  put(shop,0x53484f50,4);put(shop+4,900,4);
  put(prefs+0xac,key,4);put(field+0x490,87^key,4);
  put(field+0x560,58,2);put(field+0x562,7^(key&0xffff),2); // potion
  put(field+0x790,52,2);put(field+0x792,9^(key&0xffff),2); // sweet berry
  put(shop+12,82,2);put(shop+14,3,2); // pre-shop retail slot, plaintext
  const bytes=captureAutosave(core,{location:{area:'hoenn-0-16',x:9,y:11}});
  assert.equal(block1Byte(bytes,1,safari+2),87);
  assert.equal(block1Byte(bytes,1,safari+5),9);
  assert.equal(block1Byte(bytes,1,safari+341),7);
  assert.equal(block1Byte(bytes,1,0x560),82);
  assert.equal(block1Byte(bytes,1,0x562),(3^key)&255);
  assert.equal(block1Byte(bytes,1,0x490),(900^key)&255);
  assert.equal(core.read32(shop),0x53484f50);
  assert.equal(core.read16(field+0x560),58);
});
test('blackout and session-local scratch finish cleanly if the browser closes on the hit message',()=>{
  const {core,put}=machine();
  put(field+0x36f0,1);put(field+0x36f4,4);put(field+safari+4,0);
  put(field+0x370c,0x02001000,4);put(field+safari+12,0x02);
  const bytes=captureAutosave(core);
  assert.equal(block1Byte(bytes,1,safari+4),10);
  assert.equal(block1Byte(bytes,1,safari+12),2);
  assert.equal(block1Byte(bytes,1,0x36f0),0);
  assert.equal(block1Byte(bytes,1,0x370f),0);
});

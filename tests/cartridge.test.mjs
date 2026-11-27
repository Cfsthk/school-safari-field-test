import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPatch,digest,batteryBytes,EDITED_SHA,prepareCartridge} from '../cartridge.js';
import {demonstration} from '../demonstration.js';
const patch=await readFile(new URL('../patches/emerald-safari-1.14.bps',import.meta.url));
test('released cumulative patch is unchanged and malformed input is rejected',async()=>{
  assert.equal(await digest(patch),'ef0922b0e8ca445eda5fb343d29a749a29831f18d1ed489cba4b9b62a66e91bc');
  assert.throws(()=>applyPatch(new Uint8Array(32),patch));
  await assert.rejects(()=>prepareCartridge(new Blob([patch])));
});
test('128 KiB battery requires a full generation; desktop RTC trailer is trimmed',()=>{
  const bytes=new Uint8Array(131088), view=new DataView(bytes.buffer);
  assert.equal(batteryBytes(bytes),null);
  for(let i=0;i<14;i++) {
    const base=i*4096;
    view.setUint16(base+0xff4,i,true);view.setUint32(base+0xff8,0x08012025,true);
    view.setUint32(base+0xffc,5,true);
  }
  assert.equal(batteryBytes(bytes).length,131072);view.setUint32(0xffc,6,true);
  assert.equal(batteryBytes(bytes),null);
});
test('Route 101 has 29 distinct simulated classmates around the native player',()=>{
  const peers=demonstration('hoenn-0-16',1);
  assert.equal(new Set(peers.map(p=>p.slot)).size,29);
  assert.equal(new Set(peers.map(p=>p.x+','+p.y)).size,29);
  assert.equal(demonstration('hoenn-1-4',0).length,0);
});
test('local original cartridge produces the exact native release',{skip:!process.env.SAFARI_ORIGINAL_ROM},async()=>{
  const original=await readFile(process.env.SAFARI_ORIGINAL_ROM);
  assert.equal(await digest(applyPatch(original,patch)),EDITED_SHA);
});

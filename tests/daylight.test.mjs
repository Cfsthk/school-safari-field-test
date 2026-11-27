import test from 'node:test';
import assert from 'node:assert/strict';
import {cycleTime,createLighting,fieldLighting,colourField,writeSchoolCalendar} from '../daylight.js';
const start=Date.parse('2026-11-27T00:00:00+08:00');
const minute=m=>start+60000*m;
test('one Hong Kong safari day keeps the cartridge phase boundaries',()=>{
  for(const [m,phase] of [[0,'morning'],[21.999,'morning'],[22,'afternoon'],[49.999,'afternoon'],
    [50,'evening'],[64.999,'evening'],[65,'night'],[89.999,'night'],[90,'morning'],[155,'night']]) {
    assert.equal(cycleTime(minute(m)).phase,phase);
  }
  const mem=new WebAssembly.Memory({initial:1});
  writeSchoolCalendar(mem,0,Date.parse('2026-12-31T17:27:52Z'));
  assert.deepEqual([...new Int32Array(mem.buffer,0,10)],[52,27,1,1,0,127,5,0,0,28800]);
});
test('native midday palette, warm dusk and cooler night grade',()=>{
  const light=createLighting(),gray=(16<<10)|(16<<5)|16;
  assert.equal(light(minute(35)).table,null);
  const dusk=light(minute(57)).table[gray], night=light(minute(75)).table[gray];
  const red=p=>p&255,blue=p=>p>>>16&255;
  assert.ok(red(dusk)>blue(dusk)); assert.ok(blue(night)>red(night));assert.ok(red(night)<red(dusk));
  assert.deepEqual(light(minute(89.999)).table,light(minute(0)).table);
});
test('only surface field maps are shaded, excluding native bag, caves and underwater',()=>{
  const sample=(type,cb=0x08085e5c)=>fieldLighting({
    read32:()=>cb|1, read8:a=>a===0x02037318+0x17?type:0, read16:()=>0x7f60
  });
  for(const type of [1,2,3,6]) assert.ok(sample(type));
  for(const type of [4,5,8,9]) assert.equal(sample(type),false);
  assert.equal(sample(3,0x081aad5c),false);
});
test('opaque native BG0 glyph pixels retain their exact colour, transparent border pixels reveal shaded map',()=>{
  const vram=new Uint8Array(65536),map=31*2048;
  vram[map]=1; vram[32]=1;
  const core={readBytes:()=>vram,read16:a=>a===0x04000000?0x100:a===0x04000008?0x1f00:0};
  const raw=new Uint32Array(240*160).fill(0xffffffff),painted=new Uint32Array(raw.length);
  const night=createLighting()(minute(76));
  colourField(core,raw,painted,night.table);
  assert.equal(painted[0],raw[0]);assert.equal(painted[1],night.table[32767]);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRomWorld} from '../rom-world.js';

function field() {
  const memory=new Map(), put=(a,n,count=1)=>{
    for(let i=0;i<count;i++)memory.set(a+i,(n>>>(i*8))&255);
  };
  const save=0x02029000,obj=0x02037350,sprite=0x02020630;
  put(0x030022c4,0x08085e5d,4);put(0x03005d8c,save,4);
  put(save,8,2);put(save+2,10,2);put(save+5,16);
  put(obj,1);put(obj+2,1);put(obj+16,15,2);put(obj+18,17,2);put(obj+24,1);
  put(sprite+32,120,2);put(sprite+34,112,2);put(sprite+41,240);put(sprite+0x3e,3);
  put(0x02021bbe,-40,2);put(0x03000e38,2);
  return {world:createRomWorld({read8:a=>memory.get(a)??0}),put,save,obj};
}
test('native camera keeps local feet fixed while other world tiles scroll two pixels',()=>{
  const {world,put,save,obj}=field();
  const first=world.sample();
  assert.equal(first.visible,true);
  assert.deepEqual(first.state,{area:'hoenn-0-16',x:8,y:10,facing:'down',look:0,observing:false});
  assert.equal(first.localY,88);
  assert.equal(first.cameraX+16*8,120);
  put(save,9,2);put(obj+16,16,2);put(obj+24,4);
  put(0x03005de0,2,4);
  const walking=world.sample();
  assert.equal(walking.localX,120);assert.equal(walking.cameraX,first.cameraX-2);
  assert.equal(walking.state.facing,'right');assert.equal(walking.state.x,9);
});
test('native menu and encounter conceal tags, preserving the last sighting site',()=>{
  const {world,put,save}=field(),start=world.sample().state;
  put(0x03000f2c,1);
  assert.equal(world.sample().visible,false);
  put(0x030022c4,0x08038421,4);
  const sighting=world.sample();
  assert.equal(sighting.visible,false);assert.deepEqual(sighting.state,{...start,observing:true});
  put(0x030022c4,0x081aad5d,4);put(0x030026f9,2);
  assert.equal(world.sample().observing,true);
  put(0x030022c4,0x08085e5d,4);put(0x030026f9,0);put(0x03000f2c,0);put(save+4,7);put(save+5,3);
  assert.equal(world.sample().state.area,'hoenn-7-3');
});
test('connection tools follow the native Start menu and close for save confirmation',()=>{
  const {world,put}=field();
  const task=0x03005e00+3*40;
  put(0x03005df4,0x0809fac5,4);
  put(task,0x0809fa35,4);
  assert.equal(world.sample().startMenu,false);
  put(task+4,1);
  assert.equal(world.sample().startMenu,true);
  put(0x03005df4,0x0809fe45,4); // Native save confirmation in the same task
  assert.equal(world.sample().startMenu,false);
});
test('native dialogue hides classmate tags while printing and while waiting for A',()=>{
  const {world,put}=field();
  put(0x020375bc,1);
  assert.equal(world.sample().visible,false);
  put(0x020375bc,0); // Doctor's text is still on screen while waiting for A
  put(0x04000000,0x100,2);
  put(0x04000008,31<<8,2);
  const frame=0x0600f800+14*32*2;
  put(frame,0xf201,2);
  assert.equal(world.sample().visible,true);
  put(frame+29*2,0xf206,2);
  assert.equal(world.sample().visible,false);
});

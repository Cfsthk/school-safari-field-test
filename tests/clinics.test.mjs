import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createClinicLocator} from '../clinics.js';

// Public source contains no cartridge. The integration suite can use the private build
// alongside this checkout, or SAFARI_EDITED_ROM on a standalone checkout.
const cart=process.env.SAFARI_EDITED_ROM || new URL('../../../outputs/Emerald Safari/Emerald-Safari.gba',import.meta.url);
const locate=existsSync(cart) ? createClinicLocator(readFileSync(cart)) : null;
const opts={skip:!locate && 'Set SAFARI_EDITED_ROM to the current edited cartridge.'};
const where=(g,n,x,y)=>({area:'hoenn-'+g+'-'+n,x,y});
const nurse=(group,map,x=7)=>({group,map,x,y:4});

test('Route 101 and the lab lead to Oldale; opposite ends of 102 lead to different clinics',opts,()=>{
  assert.deepEqual(locate(where(1,4,6,5)),nurse(2,2));
  assert.deepEqual(locate(where(0,16,9,11)),nurse(2,2));
  assert.deepEqual(locate(where(0,17,0,9)),nurse(8,4));
  assert.deepEqual(locate(where(0,17,49,9)),nurse(2,2));
});
test('forest, desert, cave and ocean exits use local geography',opts,()=>{
  assert.deepEqual(locate(where(24,7,9,9)),nurse(3,1)); // Granite Cave → Dewford
  assert.deepEqual(locate(where(0,26,14,44)),nurse(10,5)); // Route 111 → Mauville
  assert.deepEqual(locate(where(0,39,0,34)),nurse(13,6)); // West Route 124 → Lilycove
  assert.deepEqual(locate(where(0,39,76,37)),nurse(14,3)); // East Route 124 → Mossdeep
  assert.deepEqual(locate(where(24,50,7,7)),nurse(14,3)); // High tide Shoal Cave
  assert.deepEqual(locate(where(0,55,12,19)),locate(where(0,20,12,19))); // Underwater Route 105
});
test('a clinic always leads to its counter, including the two distinct Summit lobbies',opts,()=>{
  const list=[[2,2],[3,1],[4,5],[5,4],[6,4],[7,0],[8,4],[9,11],[10,5],[11,5],[12,2],[13,6],[14,3],[15,2],[16,10],[16,12],[26,53]];
  for(const [g,n] of list){
    const counter=nurse(g,n,g===16&&n===10?3:7);
    assert.deepEqual(locate(counter,null,{summitUnlocked:true}),counter);
  }
  assert.deepEqual(locate(where(0,8,9,10),null,{summitUnlocked:true}),nurse(16,10,3));
  assert.deepEqual(locate(where(0,8,20,70),null,{summitUnlocked:true}),nurse(16,12));
  assert.notEqual(locate(where(0,8,20,70)).group,16);
});
test('dynamic rooms use the actual return position before the starting-region fallback',opts,()=>{
  assert.deepEqual(locate(where(25,0,7,7),where(0,39,76,37)),nurse(14,3));
  assert.deepEqual(locate(null,null),nurse(2,2));
});

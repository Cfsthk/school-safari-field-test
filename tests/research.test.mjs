import test from 'node:test';
import assert from 'node:assert/strict';
import {freshResearch, startEncounter, takeTurn, report} from '../research.js';
import {areas, canStand, step, suggestSpawns} from '../world.js';
import {students} from '../students.js';

test('thirty students can start on different walkable squares', () => {
  const places=suggestSpawns('route101',30);
  assert.equal(students.length,30);
  assert.equal(new Set(students.map(s => s.className+' '+s.name)).size,30);
  assert.equal(new Set(places.map(p=>p.x+','+p.y)).size,30);
  assert.ok(places.every(p=>canStand('route101',p.x,p.y)));
});
test('the route connects both towns, with traversable return crossings', () => {
  const seen=new Set(), queue=[{area:'route101',...areas.route101.spawn}];
  for (let i=0;i<queue.length;i++) {
    const {area,x,y}=queue[i], key=[area,x,y].join(',');
    if(seen.has(key))continue;
    seen.add(key);
    for(const d of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const dest=step(area,x,y,...d);
      if(dest)queue.push(dest);
    }
  }
  for(const [id,a] of Object.entries(areas)) assert.ok(seen.has([id,a.spawn.x,a.spawn.y].join(',')));
  for(const [a,b,dy] of [['route101','oldale',-1],['route101','littleroot',1]]) {
    const y=dy===1?19:0;
    assert.ok(Array.from({length:20},(_,x)=>{
      const out=step(a,x,y,0,dy);
      return out?.area===b && step(b,out.x,out.y,0,-dy)?.area===a;
    }).some(Boolean));
  }
});
test('sighting starts at zero, only observation increases familiarity, doctor pays once',()=>{
  const s=freshResearch();
  startEncounter(s,()=>0);
  assert.equal(s.journal[1].level,0);
  takeTurn(s,'berry',2,()=>.99);
  assert.equal(s.journal[1].level,0);
  assert.equal(s.basket[2],1);
  takeTurn(s,'observe',0,()=>.99);
  assert.equal(s.journal[1].level,1);
  takeTurn(s,'escape',0,()=>0);
  assert.deepEqual(report(s),{first:1,updates:0,coins:9});
  assert.equal(report(s).coins,0);
});
test('blackout loses unreported notes, retaining earlier filed evidence',()=>{
  const s=freshResearch();
  startEncounter(s,()=>0); report(s);
  s.hp=1;
  assert.equal(takeTurn(s,'observe',0,()=>.4).blackout,true);
  assert.equal(s.journal[1].level,0);
  assert.equal(s.journal[1].filed,true);
  assert.equal(s.hp,10);
});

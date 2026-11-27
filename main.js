import {areas, canStand, tileAt, step, suggestSpawns, renderWorld} from './world.js';
import {createUI} from './ui.js';
import {createPresence} from './presence.js';
import {students} from './students.js';
import {animals} from './animals.js';
import {berries, freshResearch, getAnimal, startEncounter, takeTurn, report} from './research.js';

const dirs = {up:[0,-1], down:[0,1], left:[-1,0], right:[1,0]};
const saveKey = 'school-safari-field-test-v1';
const spawn = {area:'route101', ...areas.route101.spawn, direction:'down'};
function load() {
  try {
    const value = JSON.parse(localStorage.getItem(saveKey));
    if (value?.research?.journal && Array.isArray(value.research.basket) &&
        areas[value.position?.area] && canStand(value.position.area, value.position.x, value.position.y)) return value;
  } catch {}
  return {position:{...spawn}, research:freshResearch()};
}
const save = load(), position = save.position, research = save.research;
let warnedStorage = false;
function persist() {
  try { localStorage.setItem(saveKey, JSON.stringify(save)); }
  catch { if (!warnedStorage) { warnedStorage = true; ui.notify('這部裝置目前無法保存進度。'); } }
}
let slot = 0, shared = false, remote = [], display = {}, netStatus = {kind:'offline'};
let motion = null, held = null, nextStep = 0, grassSteps = 0, placeAtHost = false;
let previous = 0, nextWander = 0, panel = '', activeInvite = null, dirty = true;
const demoAreas = new Map();
const ui = createUI({
  onDirection:(dir, pressed) => {
    if (pressed) { held = dir; walk(dir, performance.now()); }
    else if (held === dir) held = null;
  },
  onA:interact,
  onB:() => {},
  onMenu:() => { if (research.encounter) encounterMenu(); else menu(); }
});
function roomState() {
  return {area:position.area, x:position.x, y:position.y, facing:position.direction,
    observing:Boolean(research.encounter), ...display};
}
const network = createPresence({
  initialState:roomState(), preferredSlot:slot,
  onStatus:status => { netStatus = status; if (panel === 'network') roomMenu(); },
  onSlot:id => { slot = id; dirty = true; },
  onPeers:list => {
    const now = performance.now();
    remote = list.filter(person => areas[person.area]).map(person => {
      const prior = remote.find(p => p.id === person.id);
      if (prior && prior.area === person.area && (prior.x !== person.x || prior.y !== person.y) &&
          Math.abs(prior.x-person.x) + Math.abs(prior.y-person.y) === 1)
        return {...person, motion:{x:prior.x, y:prior.y, time:now}};
      if (prior?.area === person.area && prior.x === person.x && prior.y === person.y)
        return {...person, motion:prior.motion};
      return person;
    });
    if (placeAtHost && !research.encounter) {
      const host = remote.find(person => person.id === 'host');
      if (host) {
        placeAtHost = false;
        const spots = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1]];
        for (const [dx,dy] of spots) {
          const x=host.x+dx,y=host.y+dy;
          if (canStand(host.area,x,y) && !remote.some(p=>p.area===host.area && p.x===x && p.y===y)) {
            go(host.area,x,y); break;
          }
        }
      }
    }
    dirty = true;
  }
});
function sendPosition() { if (shared) network.update(roomState()); }
function close() { panel = ''; held = null; ui.close(); }
function show(key, options) {
  held = null; panel = key;
  ui.show({ ...options, onBack:options.onBack ?? close });
}
const choice = (label,run) => ({label,run});
function say(title, text, done = close, image) {
  show('dialogue',{title, text, image, choices:[choice('繼續',done)], onBack:done});
}
function interpolate(object, movement, now) {
  if (!movement) return object;
  const t = Math.min(1, Math.max(0,(now - movement.time)/145));
  return {...object, x:movement.x+(object.x-movement.x)*t, y:movement.y+(object.y-movement.y)*t, walking:t<1};
}
function actors(area) {
  if (!demoAreas.has(area)) {
    const sites = suggestSpawns(area, area === 'route101' ? 30 : 9)
      .filter(p => p.x !== areas[area].spawn.x || p.y !== areas[area].spawn.y);
    const cohort = sites.slice(0,area==='route101'?29:8).map((p,i) => ({
      ...students[i+1], ...p, direction:['left','down','right','up'][(i*3)%4],
      observing:tileAt(area,p.x,p.y)==='grass' && i%3===0, homeX:p.x,homeY:p.y
    }));
    demoAreas.set(area,cohort);
  }
  return demoAreas.get(area);
}
function wander(now) {
  if (shared || now < nextWander) return;
  nextWander = now + 650;
  const demo = actors(position.area);
  if (!demo.length) return;
  const actor = demo[Math.floor(Math.random()*demo.length)];
  if (actor.observing && Math.random() < .7) return;
  const direction = Object.keys(dirs)[Math.floor(Math.random()*4)];
  const dest = step(position.area,actor.x,actor.y,...dirs[direction]);
  actor.direction = direction;
  if (!dest || dest.area !== position.area || Math.abs(dest.x-actor.homeX)+Math.abs(dest.y-actor.homeY)>2 ||
      (position.x===dest.x && position.y===dest.y) || demo.some(o=>o.x===dest.x && o.y===dest.y)) return;
  actor.motion={x:actor.x,y:actor.y,time:now}; actor.x=dest.x; actor.y=dest.y;
  actor.observing=tileAt(position.area,dest.x,dest.y)==='grass' && Math.random()<.3;
  dirty=true;
}
function fieldActors(now) {
  if (!shared) return actors(position.area).map(p=>interpolate(p,p.motion,now));
  return remote.filter(p=>p.area===position.area).map(p=>{
    const profile = students[p.slot] ?? students[0];
    return interpolate({...profile, ...p, name:p.name || profile.name, className:p.className || profile.className, direction:p.facing},p.motion,now);
  });
}
function frame(now) {
  if (held && !ui.isOpen() && now>=nextStep) walk(held,now);
  wander(now);
  if (now-previous >= 32 || dirty) {
    const me=interpolate({...students[slot], ...display, ...position, observing:Boolean(research.encounter)},motion,now);
    renderWorld(ui.canvas,{area:position.area,player:me,students:fieldActors(now),time:now});
    previous=now;dirty=false;
  }
  requestAnimationFrame(frame);
}
function go(area,x,y) {
  Object.assign(position,{area,x,y}); motion=null; grassSteps=0;
  ui.banner(areas[area].name); dirty=true; persist(); sendPosition();
}
function walk(direction,now) {
  if (!dirs[direction] || ui.isOpen() || research.encounter || now < nextStep) return;
  position.direction=direction; nextStep=now+155;
  const dest=step(position.area,position.x,position.y,...dirs[direction]);
  if (!dest) { sendPosition(); dirty=true; return; }
  if (dest.area!==position.area) { go(dest.area,dest.x,dest.y); return; }
  motion={x:position.x,y:position.y,time:now};
  Object.assign(position,dest); dirty=true; persist(); sendPosition();
  if (tileAt(position.area,position.x,position.y)==='grass') {
    if (++grassSteps >= 2 && (Math.random()<.26 || grassSteps>=8)) {
      grassSteps=0; held=null; startEncounter(research); persist(); sendPosition();
      encounterMenu('你在草叢中目擊了'+getAnimal(research.encounter.id).name+'。');
    }
  }
}
function interact() {
  if (research.encounter) { encounterMenu(); return; }
  const [dx,dy] = dirs[position.direction] || dirs.down;
  const x=position.x+dx, y=position.y+dy;
  const landmarks=areas[position.area].landmarks;
  const here=landmarks.find(l=>l.x===x && l.y===y);
  if (here?.kind === 'doctor') {
    const amount=report(research); research.hp=10; research.pad=Math.max(2,research.pad);
    research.basket=research.basket.map(n=>Math.max(n,2)); persist();
    return say('研究博士', '收到 '+amount.first+' 項首次目擊和 '+amount.updates+' 項更新，給你 '+amount.coins+' 枚金幣。已替你補給和回復體力。');
  }
  if (here?.kind === 'ranger') return show('ranger',{title:'護林員',text:'你想打聽甚麼？',choices:[
    choice('地點',()=>say('護林員','沿道路的彎位走進深色高草，在草叢裏多走幾步便有機會遇見動物。')),
    choice('食物',()=>say('護林員','小熊貓喜歡清甜的莓果。大熊貓看見草莓尖尖的紅色外形，也可能好奇地靠近。')),
    choice('離開',close)]});
  if (here) return say(here.name || '路牌', here.text || (position.area==='route101' ? '北面通往古辰鎮，南面通往未白鎮。' : '沿小路前往 101 號道路；在未白鎮研究所門外可以向博士上報。'));
  const other = fieldActors(performance.now()).find(p=>Math.round(p.x)===x && Math.round(p.y)===y);
  if (other) return say(other.className+' '+other.name,other.observing?'這位同學正在觀察動物。':'這位同學正在附近考察。');
  const tile=tileAt(position.area,x,y);
  if (tile==='grass' || tileAt(position.area,position.x,position.y)==='grass') return say('高草叢','仔細聽，草葉在動。走進深色草叢，來回走動尋找動物。');
  ui.notify('面向同學、路牌或護林員，再按 A。');
}
function encounterMenu(text) {
  const e=research.encounter;
  if (!e) return close();
  const a=getAnimal(e.id), entry=research.journal[a.id];
  const summary='熟悉度 '+entry.level+'/5　體力 '+research.hp+'/10';
  show('encounter',{title:a.name+'　'+'★'.repeat(a.stars), text:(text?text+'\n':'')+summary, image:a.image,imageAlt:a.name,
    choices:[choice('觀察',()=>act('observe')),choice('莓果',berryMenu),choice('背包',bagMenu),choice('撤離',()=>act('escape'))],
    onBack:()=>show('confirm',{title:'撤離這次考察？',choices:[choice('繼續觀察',()=>encounterMenu()),choice('撤離',()=>act('escape'))],onBack:()=>encounterMenu()})});
}
function berryMenu() {
  show('berries',{title:'樹果口袋',text:'選擇一種莓果。',choices:[
    ...berries.flatMap(([label],i)=>research.basket[i]?[choice(label+' × '+research.basket[i],()=>act('berry',i))]:[]),
    choice('返回',()=>encounterMenu())],onBack:()=>encounterMenu()});
}
function bagMenu() {
  show('bag',{title:'考察背包',text:'護墊可減輕本回合受到的傷害。',choices:[
    ...(research.pad?[choice('護墊 × '+research.pad,()=>act('pad'))]:[]),choice('返回',()=>encounterMenu())],onBack:()=>encounterMenu()});
}
function act(action,index) {
  const a=getAnimal(research.encounter.id);
  const result=takeTurn(research,action,index);
  persist(); sendPosition();
  if (!result) return encounterMenu();
  if (!result.ended) return encounterMenu(result.text);
  if (result.blackout) go('oldale',areas.oldale.spawn.x,areas.oldale.spawn.y);
  const done = result.note ? () => journalEntry(a,close) : close;
  say(a.name,result.text,done);
}
function journalEntry(a,back) {
  const entry=research.journal[a.id];
  if (!entry?.seen) return say(a.name,'你尚未在野外目擊這種動物。',back);
  let page=Math.max(0,entry.level-1);
  function draw() {
    show('entry',{title:a.name+'　熟悉度 '+entry.level+'/5',image:a.image,imageAlt:a.name,
      text:entry.level ? a.notes[page] : '首次目擊已記錄。下次選「觀察」，便可寫下更多資料。',
      choices:[...(page>0?[choice('上一段',()=>{page--;draw();})]:[]),
        ...(page+1<entry.level?[choice('下一段',()=>{page++;draw();})]:[]),choice('返回',back)],onBack:back});
  }
  draw();
}
function journal() {
  show('journal',{title:'動物圖鑑',choices:animals.map(a=>choice((research.journal[a.id]?.seen?'● ':'○ ')+a.name,()=>journalEntry(a,journal))),onBack:menu});
}
const statuses = {
  offline:'獨自試玩', connecting:'正在連接', waiting:'房間已開放，等候同學加入',
  connected:'已連上同學', reconnecting:'正在重新連接', unavailable:'未能連上房間', full:'房間已滿'
};
function menu() {
  show('menu',{title:'考察選單',text:(display.className || students[slot].className)+' '+(display.name || students[slot].name)+'　體力 '+research.hp+'/10　金幣 '+research.coins,
    choices:[choice('同學連線',roomMenu),choice('動物圖鑑',journal),choice('考察指南',guide),choice('回到地圖',close)]});
}
function guide() {
  say('考察指南','按住十字鍵移動。面向同學、路牌或護林員按 A，按 B 返回。走過深色草叢可獨自目擊動物。往南到未白鎮研究所門外找博士，上報可得金幣。',menu);
}
function roomMenu() {
  if (!shared) return show('network',{title:'同學連線',text:'目前是示範場景，其他角色是模擬同學。開設房間後，可邀請不同班的同學加入，彼此看見走動和觀察狀態。',choices:[
    choice('開設房間',()=>{
      shared=true; remote=[]; network.update(roomState()); activeInvite=network.host();
      history.replaceState(null,'',activeInvite);
      sendPosition(); roomMenu();
    }),choice('返回',menu)],onBack:menu});
  const leave=()=>{
    shared=false;activeInvite=null;display={};remote=[];slot=0;placeAtHost=false;
    history.replaceState(null,'',location.pathname+location.search);
    try { sessionStorage.removeItem('safari-display-v1'); } catch {}
    network.leave();roomMenu();dirty=true;
  };
  const profile=()=>{
    panel='profile';
    ui.profile({className:display.className || students[slot].className,name:display.name || students[slot].name},v=>{
      display={className:v.className,name:v.name};
      try { sessionStorage.setItem('safari-display-v1',JSON.stringify({room:location.hash, ...display})); } catch {}
      sendPosition();roomMenu();dirty=true;
    },roomMenu);
  };
  const invite=network.getInvite() || activeInvite;
  show('network',{title:'同學連線',text:(statuses[netStatus.kind] ?? '連線中')+'。'+(netStatus.kind==='unavailable'||netStatus.kind==='reconnecting'?'可重試連線；房主的網頁須保持開啟。':'請將房間連結交給同校同學。'),
    choices:[...(invite?[choice('分享房間連結',()=>{panel='invite';ui.invite(invite,roomMenu);})]:[]),
      choice('設定班別和姓名',profile),
      ...(netStatus.kind==='unavailable'&&invite?[choice('重試連線',()=>{network.leave();network.join(invite);sendPosition();roomMenu();})]:[]),
      choice('回到地圖',close),choice('離開房間',leave)],onBack:menu});
}
if (location.hash.startsWith('#room=')) {
  shared=true; activeInvite=location.href; placeAtHost=true;
  try {
    const stored=JSON.parse(sessionStorage.getItem('safari-display-v1') || 'null');
    if (stored?.room===location.hash && typeof stored.name==='string' && typeof stored.className==='string') {
      display={name:stored.name.slice(0,12),className:stored.className.slice(0,8)};
    }
  } catch {}
  network.update(roomState());
  if (!network.join(activeInvite)) { shared=false; activeInvite=null; ui.notify('房間連結無效，已進入示範場景。'); }
}
window.addEventListener('blur',()=>{held=null;});
document.addEventListener('visibilitychange',()=>{held=null;if(document.hidden)persist();});
ui.banner(areas[position.area].name);
if (research.encounter) encounterMenu();
requestAnimationFrame(frame);

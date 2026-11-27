import {createUI} from './ui.js?rom=114';
import {createEmulator} from './emulator.js';
import {createRomWorld} from './rom-world.js';
import {createPresence} from './presence.js?rom=114';
import {students} from './students.js';
import {demonstration} from './demonstration.js';
import {EDITED_SHA, prepareCartridge, digest, batteryBytes} from './cartridge.js';
import {readLocal, writeLocal, writeBattery} from './library.js';
import {schoolCartridgeURL} from './school-config.js';

const noPosition = {area:'offmap',x:0,y:0,facing:'down',observing:false,look:null};
let game, world, cartridge, pendingBoot = false, bootSerial = 0, latest = noPosition;
let revision=0, lastBattery, lastCheck=0, pendingWrite, writeConflict=false, storageNotice=false;
let mySlot=0, display={}, peers=[], networkStatus='offline', shared=false, demo=true, panel='', invite=null;
let lastSample=0;

const ui=createUI({
  onDirection:(key,down)=>game?.setKey(key,down),
  onButton:(key,down)=>game?.setKey(key,down),
  onMenu:toolsMenu, onFile:selectCartridge, onSaveFile:importBattery, onExport:exportBattery,
  onAudio:()=>game?.unlockAudio()
});
const option=(label,run)=>({label,run});
const connection=createPresence({
  initialState:noPosition,
  onSlot:id=>{mySlot=id;},
  onPeers:list=>{peers=list;},
  onStatus:({kind})=>{networkStatus=kind;if(panel==='room') roomMenu();}
});

function close() { panel='';ui.close(); }
function menu(name,options) { panel=name;ui.show({...options,onBack:options.onBack || close}); }
function errorText(error) { return error instanceof Error ? error.message : '載入時發生問題，請再試一次。'; }
function unavailableStorage() {
  if (!storageNotice) { storageNotice=true;ui.notify('瀏覽器未能保存檔案。可從「存檔管理」匯出 .sav。'); }
}
function sameBytes(a,b) {
  if(!a || !b || a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i])return false;
  return true;
}
async function saveIfChanged() {
  if(!game || pendingBoot || pendingWrite || writeConflict) return pendingWrite;
  const bytes=batteryBytes(game.exportSave());
  if(!bytes || sameBytes(bytes,lastBattery)) return;
  pendingWrite=writeBattery(bytes,revision).then(next=>{
    if(next===null) {
      writeConflict=true;
      ui.notify('另一個分頁已儲存遊戲。請匯出此分頁的 .sav 以保留兩邊進度。');
    } else { revision=next;lastBattery=bytes; }
  }).catch(unavailableStorage).finally(()=>{pendingWrite=null;});
  return pendingWrite;
}
function frame(core) {
  const now=performance.now();
  if (!world || core!==game || now-lastSample<28) return;
  lastSample=now;
  const sample=world.sample();
  latest=sample.state ?? noPosition;
  if(shared) connection.update({...latest,...display});
  const classmates=shared ? peers.map(p=>({...p,className:p.className || students[p.slot].className,name:p.name || students[p.slot].name}))
    : demo && sample.visible ? demonstration(latest.area,now) : [];
  world.draw(ui.overlay,{sample,local:{...students[mySlot],...display},peers:classmates,time:now});
  if(now-lastCheck>850) { lastCheck=now; void saveIfChanged(); }
}
async function start(bytes,batteryRecord) {
  await pendingWrite;
  game?.dispose();game=null;world=null;
  latest=noPosition;lastSample=0;
  if(shared) connection.update({...latest,...display});
  const battery=batteryRecord?.bytes;
  game=await createEmulator({rom:bytes,save:battery,canvas:ui.canvas,onFrame:frame});
  world=createRomWorld({rom:bytes,read8:game.read8,read16:game.read16,read32:game.read32});
  revision=batteryRecord?.revision ?? 0;lastBattery=battery;writeConflict=false;
  cartridge=bytes;
  ui.ready();close();
  game.start();
  if (!shared && location.hash.startsWith('#room=')) enterRoom();
}
async function loadLocalBattery() {
  try { return await readLocal('battery'); } catch { return null; }
}
async function selectCartridge(file) {
  if(pendingBoot) return;
  const sequence=++bootSerial;pendingBoot=true;
  try {
    const bytes=await prepareCartridge(file,text=>ui.setup(text));
    ui.setup('正在啟動遊戲…');
    await start(bytes,await loadLocalBattery());
    try { await writeLocal('cart-'+EDITED_SHA,bytes); } catch { unavailableStorage(); }
  } catch(error) {
    if(sequence===bootSerial) {
      if(game) { ui.ready();ui.notify(errorText(error)); }
      else ui.setup(errorText(error));
    }
  } finally { pendingBoot=false; }
}
async function restore() {
  const sequence=bootSerial;
  let bytes;
  try { bytes=await readLocal('cart-'+EDITED_SHA); } catch {}
  if(sequence!==bootSerial)return;
  if(bytes) {
    try {
      if(await digest(bytes)!==EDITED_SHA) throw new Error('本機遊戲檔未通過檢查，請重新選取。');
      if(sequence!==bootSerial)return;
      pendingBoot=true;ui.setup('正在啟動遊戲…');await start(bytes,await loadLocalBattery());
    } catch(error){ui.setup(errorText(error));}
    finally{pendingBoot=false;}
  } else if(schoolCartridgeURL) {
    ui.setup('正在載入學校遊戲檔…');
    try {
      const asset=new URL(schoolCartridgeURL,location.href);
      if(asset.origin!==location.origin) throw new Error('請在校內遊戲網站選取卡帶。');
      const response=await fetch(asset);
      if(!response.ok) throw new Error('未能載入校內遊戲檔。你也可以自行選檔。');
      const file=await response.blob();
      if(sequence===bootSerial) await selectCartridge(file);
    } catch(error) { if(sequence===bootSerial)ui.setup(errorText(error)); }
  }
}
function exportBattery() {
  const bytes=batteryBytes(game?.exportSave() ?? []) ?? lastBattery;
  if(!bytes) { ui.notify('請先在遊戲內按 START，選「儲存」。');return; }
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
  const link=document.createElement('a');
  link.href=url;link.download='Emerald-Safari.sav';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function importBattery(file) {
  if(!game || pendingBoot)return;
  if(![131072,131088].includes(file.size)) {ui.notify('請選擇綠寶石的 128 KB .sav 檔案。');return;}
  const bytes=batteryBytes(await file.arrayBuffer());
  if(!bytes) {ui.notify('這個檔案沒有完整的綠寶石遊戲紀錄。');return;}
  const apply=async()=>{
    if(pendingBoot)return;
    pendingBoot=true;game.pause();
    try {
      await pendingWrite;
      const old=await loadLocalBattery();
      const next=await writeBattery(bytes,old?.revision ?? 0);
      if(next===null)throw new Error('另一個分頁剛更新存檔，請再試一次。');
      ui.setup('正在讀取進度…');
      await start(cartridge,{bytes,revision:next});
    } catch(error){
      if(game){ui.ready();close();game.start();ui.notify(errorText(error));}
      else ui.setup(errorText(error));
    } finally {pendingBoot=false;}
  };
  if(lastBattery || batteryBytes(game.exportSave())) menu('import',{
    title:'載入這個存檔？',text:'這會取代本機的考察進度。你可以先匯出目前的 .sav。',
    choices:[option('取消',filesMenu),option('匯出目前存檔',exportBattery),option('載入存檔',apply)],onBack:filesMenu});
  else await apply();
}
function toolsMenu() {
  menu('tools',{title:'連線與檔案',choices:[option('同學連線',roomMenu),option('存檔管理',filesMenu),option('回到遊戲',close)]});
}
function filesMenu() {
  menu('files',{title:'存檔管理',text:'在遊戲內按 START，再選「儲存」。可匯出 .sav 到另一部裝置繼續。',
    choices:[option('匯出 .sav',exportBattery),option('載入 .sav',ui.pickSave),option('返回',toolsMenu)],onBack:toolsMenu});
}
const statuses={offline:'已離開房間',connecting:'正在連線…',waiting:'房間已開放，等候同學加入。',connected:'已與同學連線。',reconnecting:'正在重新連線…',unavailable:'未能連上房間。請確認房主仍開啟遊戲。',full:'這間房間已滿。'};
function roomMenu() {
  if(!shared) return menu('room',{title:'同學連線',text:'開設房間，把連結交給同學。走近同一地點，便會看到彼此。',
    choices:[option('開設房間',()=>{
      shared=true;peers=[];connection.update({...latest,...display});
      invite=connection.host();history.replaceState(null,'',invite);roomMenu();
    }),option(demo?'隱藏示範同學':'顯示示範同學',()=>{demo=!demo;roomMenu();}),option('返回',toolsMenu)],onBack:toolsMenu});
  function leave() {
    shared=false;invite=null;peers=[];mySlot=0;display={};
    try{sessionStorage.removeItem('native-student');}catch{}
    history.replaceState(null,'',location.pathname+location.search);connection.leave();roomMenu();
  }
  const actions=[option('分享房間連結',()=>{panel='invite';ui.invite(connection.getInvite() || invite,roomMenu);}),
    option('設定班別和姓名',()=>{
      panel='profile';
      ui.profile({...students[mySlot],...display},value=>{
        display={name:value.name,className:value.className};
        try{sessionStorage.setItem('native-student',JSON.stringify({...display,room:location.hash}));}catch{}
        connection.update({...latest,...display});roomMenu();
      },roomMenu);
    })];
  if(networkStatus==='unavailable')actions.push(option('重試連線',()=>{connection.leave();connection.join(invite);roomMenu();}));
  actions.push(option('回到遊戲',close),option('離開房間',leave));
  menu('room',{title:'同學連線',text:statuses[networkStatus],choices:actions,onBack:toolsMenu});
}
function enterRoom() {
  shared=true;invite=location.href;
  try{
    const stored=JSON.parse(sessionStorage.getItem('native-student'));
    if(stored?.room===location.hash && typeof stored.name==='string' && typeof stored.className==='string')
      display={name:stored.name.slice(0,12),className:stored.className.slice(0,8)};
  }catch{}
  connection.update({...latest,...display});
  if(!connection.join(invite)){shared=false;invite=null;ui.notify('房間連結無效。');}
}
document.addEventListener('visibilitychange',()=>{
  if(!game || pendingBoot)return;
  if(document.hidden){void saveIfChanged();game.pause();}
  else game.start();
});
window.addEventListener('pagehide',()=>{void saveIfChanged();});
restore();

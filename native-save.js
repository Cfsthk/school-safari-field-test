// Emerald Safari 1.14 (BPEE). Retail sSaveSlotLayout and CopyPartyAndObjectsToSave.
const FLASH_SIZE = 0x20000, SECTOR = 0x1000, DATA = 0xf80, SECTORS = 14;
const FOOTER = 0xff4, SIGNATURE = 0x08012025;
const SIZES = [0xf2c, DATA,DATA,DATA,0xf08, DATA,DATA,DATA,DATA,DATA,DATA,DATA,DATA,0x7d0];
const BLOCK_1 = 0x3d88, BLOCK_2 = 0xf2c, BOXES = 0x83d0;
const SAFARI = 0x3598, PARK = 0x36f0, SHOP = 0x02023864;
const fieldCallback = 0x08085e5c;
const viewOf = b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
function checksum(data) {
  const view=viewOf(data);
  let sum=0;
  for(let i=0;i<data.length;i+=4)sum=(sum+view.getUint32(i,true))>>>0;
  return (sum+(sum>>>16))&0xffff;
}
function bytesFrom(input) {
  return input instanceof Uint8Array ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength)
    : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
}
function parseSlot(bytes,index) {
  const view=viewOf(bytes), offsets=Array(SECTORS);
  let counter;
  for(let i=0;i<SECTORS;i++) {
    const at=(index*SECTORS+i)*SECTOR, footer=at+FOOTER;
    const id=view.getUint16(footer,true), seq=view.getUint32(footer+8,true);
    if(id>=SECTORS || offsets[id]!==undefined || seq%2!==index ||
       view.getUint32(footer+4,true)!==SIGNATURE || (counter!==undefined && seq!==counter) ||
       view.getUint16(footer+2,true)!==checksum(bytes.subarray(at,at+SIZES[id])))return null;
    offsets[id]=at;
    counter=seq;
  }
  return {offsets,counter};
}
function latestSlot(bytes) {
  if(!bytes || bytes.length<FLASH_SIZE)return null;
  const a=parseSlot(bytes,0), b=parseSlot(bytes,1);
  if(!a||!b)return a||b;
  if(a.counter===0 && b.counter===0xffffffff)return a;
  return a.counter>b.counter ? a : b;
}
function sections(bytes,slot) {
  return slot.offsets.map((offset,id)=>bytes.subarray(offset,offset+SIZES[id]));
}
function nextFlash(base,slot,sections) {
  const result=base?.length>=FLASH_SIZE ? base.slice(0,FLASH_SIZE) : new Uint8Array(FLASH_SIZE).fill(255);
  const view=viewOf(result), counter=((slot?.counter ?? 0)+1)>>>0;
  const rotation=slot ? ((slot.offsets[0]/SECTOR)%SECTORS+1)%SECTORS : 1;
  for(let id=0;id<SECTORS;id++) {
    const offset=((counter%2)*SECTORS+(id+rotation)%SECTORS)*SECTOR;
    result.fill(0,offset,offset+SECTOR);
    result.set(sections[id],offset);
    const footer=offset+FOOTER;
    view.setUint16(footer,id,true);view.setUint16(footer+2,checksum(sections[id]),true);
    view.setUint32(footer+4,SIGNATURE,true);view.setUint32(footer+8,counter,true);
  }
  return result;
}
function validPosition(p) {
  return p && Number.isInteger(p.group) && p.group>=0 && p.group<=34 &&
    Number.isInteger(p.map) && p.map>=0 && p.map<255 &&
    [p.x,p.y].every(n=>Number.isInteger(n) && n>=0 && n<256);
}
function warpAt(bytes,offset) {
  const view=viewOf(bytes);
  return {group:bytes[offset],map:bytes[offset+1],x:view.getInt16(offset+4,true),y:view.getInt16(offset+6,true)};
}
function writeWarp(bytes,pos) {
  const view=viewOf(bytes);
  bytes[12]=pos.group;bytes[13]=pos.map;bytes[14]=255;bytes[15]=0;
  view.setInt16(16,pos.x,true);view.setInt16(18,pos.y,true);
}
export function readBatteryLocation(input) {
  const bytes=bytesFrom(input), slot=latestSlot(bytes);
  if(!slot)return null;
  const s=sections(bytes,slot), prefs=s[0], field=s[1], view=viewOf(field);
  const resume=warpAt(field,12);
  const standing={group:field[4],map:field[5],x:view.getInt16(0,true),y:view.getInt16(2,true)};
  // Some older cartridges express a continue warp by door ID without tile coordinates.
  const position=(prefs[9]&1) && validPosition(resume) ? resume : standing;
  if(!validPosition(position))return null;
  // Escape, dynamic and last-heal warps may identify an outdoor entrance.
  // A cleared warp is zero throughout and must not imply Petalburg City.
  position.fallback=[36,20,28].filter(i=>field.subarray(i,i+8).some(n=>n!==0))
    .map(i=>warpAt(field,i)).find(p=>validPosition(p) && p.group===0);
  position.summitUnlocked=s[4][SAFARI+8-3*DATA]===255;
  return position;
}
// On Continue, Emerald loads its original map, then performs this warp through
// the normal entry scripts, fresh object events, collision and graphics.
export function warpBatteryForLogin(input,clinic) {
  const bytes=bytesFrom(input), slot=latestSlot(bytes);
  if(!slot || !validPosition(clinic))return null;
  const s=sections(bytes,slot);
  s[0]=s[0].slice();s[1]=s[1].slice();
  s[0][9]|=1;
  writeWarp(s[1],clinic);
  return nextFlash(bytes,slot,s);
}
function copyRam(core,address,size) {
  if(core.readBytes)return new Uint8Array(core.readBytes(address,size));
  const dest=new Uint8Array(size), view=viewOf(dest);
  let i=0;
  for(;i+4<=size;i+=4)view.setUint32(i,core.read32(address+i),true);
  for(;i<size;i++)dest[i]=core.read8(address+i);
  return dest;
}
function isRam(address,length) {
  return address>=0x02000000 && address%4===0 && address+length<=0x02040000;
}
function positionAt(core,sb,location) {
  if(!location){
    if((core.read32(0x030022c4)&~1)!==fieldCallback)return null;
    const player=core.read8(0x02037595);
    if(player>=16)return null;
    const obj=0x02037350+player*36;
    if(!(core.read8(obj)&1) || !(core.read8(obj+2)&1))return null;
    location={group:core.read8(sb+4),map:core.read8(sb+5),x:core.read16(obj+16)-7,y:core.read16(obj+18)-7};
  }
  if(location.area) {
    const match=/^hoenn-(\d+)-(\d+)$/.exec(location.area);
    if(!match)return null;
    location={group:Number(match[1]),map:Number(match[2]),x:location.x,y:location.y};
  }
  return validPosition(location) && location.group===core.read8(sb+4) && location.map===core.read8(sb+5) ? location : null;
}
// The patched Mart temporarily expands the Safari stock into retail item slots.
// Mirror leaveFieldShop on our private copy. The running shop keeps its own state.
const ITEM_IDS=[
  [52,53,54,58,59,60,61,62,72,82,90,91,92,99,100,101,102,105,112,113,114,115,116,117],
  [55,56,57,87,88,89,118,119,120,176,177,178,226,227,228,229,230,231,232,233,234,235]
];
function finishShopCopy(core,field,prefs) {
  if(core.read32(SHOP)!==0x53484f50)return;
  const view=viewOf(field), key=viewOf(prefs).getUint32(0xac,true), ids=ITEM_IDS[field[SAFARI+9]===1?1:0];
  const stock=new Uint16Array(ids.length);
  for(let offset=0x560;offset<0x848;offset+=4) {
    const id=ids.indexOf(view.getUint16(offset,true));
    if(id>=0)stock[id]+=view.getUint16(offset+2,true)^(key&65535);
  }
  for(let i=0;i<stock.length;i++) {
    const at=i<3 ? SAFARI+5+i : i<6 ? SAFARI+341+i-3 : 0x139c+2*0x64+(i-6)+(i>=16?2:0);
    field[at]=Math.min(250,stock[i]);
  }
  const cash=(view.getUint32(0x490,true)^key)>>>0;
  view.setUint16(SAFARI+2,Math.min(65535,cash),true);
  view.setUint32(0x490,core.read32(SHOP+4)^key,true);
  for(let offset=0x560;offset<0x848;offset+=4) {
    const old=SHOP+12+offset-0x560;
    view.setUint16(offset,core.read16(old),true);
    view.setUint16(offset+2,core.read16(old+2)^key,true);
  }
}
function changed(s,old) {
  for(let id=0;id<SECTORS;id++) {
    for(let i=0;i<s[id].length;i++) {
      // The real save includes play time and NPC animation timers. These rarely
      // need a flash write on their own. Store their newest values with progress.
      if(id===0 && (i===0x11 || i===0x12))continue;
      if(id===1 && i>=0xa30 && i<0xc70)continue;
      if(s[id][i]!==old[id][i])return true;
    }
  }
  return false;
}
export function captureAutosave(core,{previous=null,location=null}={}) {
  const base=bytesFrom(previous);
  const sb1=core.read32(0x03005d8c), sb2=core.read32(0x03005d90), boxes=core.read32(0x03005d94);
  if(!isRam(sb1,BLOCK_1) || !isRam(sb2,BLOCK_2) || !isRam(boxes,BOXES))return null;
  const position=positionAt(core,sb1,location);
  if(!position)return null;
  const slot=latestSlot(base);
  if(!slot && core.read16(sb1+SAFARI)!==0x5347)return null;
  const field=copyRam(core,sb1,BLOCK_1), prefs=copyRam(core,sb2,BLOCK_2), storage=copyRam(core,boxes,BOXES);
  // The game prevents a lethal hit from retaining unreported research. If the
  // session ends during the blackout message, carry its committed result forward.
  if(field[PARK] && field[PARK+4]===4 && field[SAFARI+4]===0)field[SAFARI+4]=10;
  field.fill(0,PARK,0x3710); // encounter scratch + notebook heap pointer; both are session-local
  prefs[9]|=1;
  writeWarp(field,position);
  field[0x234]=core.read8(0x020244e9);
  field.set(copyRam(core,0x020244ec,600),0x238);
  field.set(copyRam(core,0x02037350,576),0xa30);
  finishShopCopy(core,field,prefs);
  const slices=[prefs];
  for(const block of [field,storage])
    for(let i=0;i<block.length;i+=DATA)slices.push(block.subarray(i,i+DATA));
  if(slot && !changed(slices,sections(base,slot)))return null;
  return nextFlash(base,slot,slices);
}

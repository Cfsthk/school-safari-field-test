// The cartridge's clockUI reads raw RTC hours and minutes (no player's clock offset).
// A whole calendar day is exactly sixteen 90-minute safari cycles.
const HK = 8*60*60*1000;
const cycle = 90*60000;
export function cycleTime(now) {
  const minute=(((now+HK)%cycle)+cycle)%cycle/60000;
  return {minute,phase:minute<22?'morning':minute<50?'afternoon':minute<65?'evening':'night'};
}

// The fixed 0.3.1 mGBA build imports Emscripten localtime_r as a.s, with musl's
// wasm32 struct tm. Use the same school clock for the native animal schedule and
// the visible sky, including on an iPad configured for another time zone.
export function writeSchoolCalendar(memory,ptr,ms) {
  const date=new Date(ms+HK),calendar=new DataView(memory.buffer);
  const year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate();
  const yday=(Date.UTC(year,month,day)-Date.UTC(year,0,1))/86400000;
  const fields=[date.getUTCSeconds(),date.getUTCMinutes(),date.getUTCHours(),day,month,
    year-1900,date.getUTCDay(),yday,0,HK/1000];
  for(let i=0;i<fields.length;i++) calendar.setInt32(ptr+4*i,fields[i],true);
  return 0;
}

// Channel scales and highlight lifts retain the underlying 15-bit pixel art.
// Morning is warm, late afternoon is neutral, dusk is amber then violet and
// night is cool blue. Adjacent phases share each boundary colour.
const day=[1,1,1,0,0,0];
const dawn=[.85,.73,.74,27,17,16];
const clear=[1,.96,.88,9,6,3];
const gold=[1.02,.85,.69,15,7,3];
const sunset=[.93,.62,.53,33,13,17];
const blueHour=[.62,.56,.75,17,11,31];
const night=[.43,.51,.70,5,9,23];
const predawn=[.56,.57,.71,14,11,25];
const stops=[[0,dawn],[5,clear],[17,day],[46,day],[50,gold],[57,sunset],
  [65,blueHour],[70,night],[84,night],[88,predawn],[90,dawn]];

function coloursFor(minute) {
  const hi=stops.findIndex(([m])=>m>minute);
  const [a,left]=stops[hi-1],[b,right]=stops[hi];
  // Updating sixty-four times per gradient makes the changes imperceptible
  // without rebuilding the colour table on each video frame.
  let blend=Math.round((minute-a)/(b-a)*64)/64;
  blend=blend*blend*(3-2*blend);
  return {key:left===right?String(a):a+'/'+blend,
    channels:left===right?left:left.map((value,i)=>value+(right[i]-value)*blend)};
}
function makeLookup(v) {
  if(v.every((n,i)=>n===day[i]))return null;
  const table=new Uint32Array(32768),expand=n=>(n<<3)|(n>>2);
  for(let i=0;i<table.length;i++) {
    const r=expand(i&31),g=expand((i>>5)&31),b=expand(i>>10);
    const strength=Math.sqrt(Math.max(r,g,b)/255);
    const outR=Math.min(255,Math.round(r*v[0]+strength*v[3]));
    const outG=Math.min(255,Math.round(g*v[1]+strength*v[4]));
    const outB=Math.min(255,Math.round(b*v[2]+strength*v[5]));
    table[i]=(0xff000000 | (outB<<16) | (outG<<8) | outR)>>>0;
  }
  return table;
}
const rgb555=rgba=>((rgba>>>3)&31)|((rgba>>>6)&0x3e0)|((rgba>>>9)&0x7c00);
export function createLighting() {
  let lastKey,table;
  return function light(now) {
    const time=cycleTime(now),palette=coloursFor(time.minute);
    if(palette.key!==lastKey){lastKey=palette.key;table=makeLookup(palette.channels);}
    return {phase:time.phase,minute:time.minute,table};
  };
}

const outside=new Set([1,2,3,6]); // Surface towns, cities, routes and ocean routes.
const overworld=0x08085e5c;
export function fieldLighting(core) {
  return (core.read32(0x030022c4)&~1)===overworld && !(core.read8(0x030026f9)&2) &&
    outside.has(core.read8(0x02037318+0x17)) && !(core.read16(0x04000000)&0x80);
}

// Emerald draws dialogue, signs and the field Start menu into BG0. Leave the
// actual nontransparent pixels of that layer at native palette values, including
// animated / scrolled window borders, while keeping the scene behind them lit.
function restoreWindows(core,raw,result) {
  if(!(core.read16(0x04000000)&0x100))return;
  const bg=core.read16(0x04000008),charBase=((bg>>>2)&3)*0x4000;
  const block=((bg>>>8)&31)*0x800,wide=(bg&0x4000)!==0,tall=(bg&0x8000)!==0;
  const sx=core.read16(0x04000010)&511,sy=core.read16(0x04000012)&511;
  const vram=core.readBytes(0x06000000,0x10000),eightBit=!!(bg&0x80);
  if(vram.length!==0x10000)return;
  for(let row=0;row<160;row++) {
    const wy=(row+sy)&(tall?511:255),rowStart=row*240;
    for(let col=0;col<240;) {
      const wx=(col+sx)&(wide?511:255),len=Math.min(8-(wx&7),240-col);
      const page=(wy>>8)*(wide?2:1)+(wx>>8);
      const index=(block+page*2048+((wy>>3&31)*32+(wx>>3&31))*2)&0xffff;
      const cell=vram[index]|vram[index+1]<<8, tile=cell&1023;
      if(tile) {
        const localY=(wy&7)^((cell&0x800)?7:0);
        const source=charBase+(tile*8+localY)*(eightBit?8:4);
        for(let j=0;j<len;j++){
          const x=((wx+j)&7)^((cell&0x400)?7:0);
          const solid=eightBit?vram[source+x]:(vram[source+(x>>1)]>>((x&1)*4))&15;
          if(solid)result[rowStart+col+j]=raw[rowStart+col+j];
        }
      }
      col+=len;
    }
  }
}
export function colourField(core,raw,result,table) {
  for(let i=0;i<raw.length;i++) result[i]=table[rgb555(raw[i])];
  restoreWindows(core,raw,result);
}

const colouredSprites=new WeakMap();
export function colourSprite(surface,table) {
  if(!table)return surface;
  let mapped=colouredSprites.get(surface);
  if(mapped?.table===table)return mapped.surface;
  if(!mapped) {
    const target=document.createElement('canvas');
    target.width=surface.width;target.height=surface.height;
    const original=surface.getContext('2d').getImageData(0,0,target.width,target.height);
    mapped={surface:target,raw:new Uint32Array(original.data.buffer),
      pixels:target.getContext('2d').createImageData(target.width,target.height)};
    colouredSprites.set(surface,mapped);
  }
  const words=new Uint32Array(mapped.pixels.data.buffer);
  for(let i=0;i<words.length;i++) words[i]=(mapped.raw[i]>>>24)?table[rgb555(mapped.raw[i])]:0;
  mapped.surface.getContext('2d').putImageData(mapped.pixels,0,0);
  mapped.table=table;
  return mapped.surface;
}

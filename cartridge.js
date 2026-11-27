export const EDITED_SHA = '63198a70a82649496737c7ee9292a652cb46dff61de17fbd453266ba0d55f788';
export const ORIGINAL_SHA = 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af';
const PATCH_SHA = 'ef0922b0e8ca445eda5fb343d29a749a29831f18d1ed489cba4b9b62a66e91bc';
export const EDITED_SIZE = 32 * 1024 * 1024;
const ORIGINAL_SIZE = EDITED_SIZE / 2;
const badPatch = () => new Error('更新檔未能通過檢查，請重新載入。');

export async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}
export function applyPatch(source, patch) {
  if (String.fromCharCode(...patch.subarray(0,4)) !== 'BPS1') throw badPatch();
  const end = patch.length-12;
  let at = 4;
  function number() {
    let value = 0, shift = 1;
    for (let i=0;i<6 && at<end;i++) {
      const b=patch[at++]; value += (b&127)*shift;
      if (b&128) return value;
      shift*=128; value+=shift;
    }
    throw badPatch();
  }
  if (number() !== source.length || number() !== EDITED_SIZE) throw badPatch();
  const metadata = number(); at += metadata;
  let src=0, dst=0, out=0;
  const result=new Uint8Array(EDITED_SIZE);
  while (at<end && out<result.length) {
    const instruction=number(), action=instruction%4, size=Math.floor(instruction/4)+1;
    if (out+size>result.length) throw badPatch();
    if (action===0) {
      if (out+size>source.length) throw badPatch();
      result.set(source.subarray(out,out+size),out);
    } else if (action===1) {
      if (at+size>end) throw badPatch();
      result.set(patch.subarray(at,at+size),out); at+=size;
    } else {
      const delta=number();
      const distance=Math.floor(delta/2)*(delta%2?-1:1);
      if (action===2) {
        src+=distance;
        if (src<0 || src+size>source.length) throw badPatch();
        result.set(source.subarray(src,src+size),out); src+=size;
      } else {
        dst+=distance;
        if (dst<0 || dst>=out) throw badPatch();
        // BPS permits a target copy to overlap itself.
        for(let i=0;i<size;i++) result[out+i]=result[dst++];
      }
    }
    out+=size;
  }
  if(out!==result.length || at!==end) throw badPatch();
  return result;
}
export async function prepareCartridge(file, progress=()=>{}) {
  if (!file || ![ORIGINAL_SIZE,EDITED_SIZE].includes(file.size)) throw new Error('請選擇 Emerald Safari 1.14 或美歐版 Pokémon Emerald 的 .gba 檔案。');
  progress('正在核對遊戲版本…');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const hash=await digest(bytes);
  if(hash===EDITED_SHA) return bytes;
  if(hash!==ORIGINAL_SHA) throw new Error('這個檔案的版本不同。請選 Emerald-Safari.gba 1.14，或未經修改的美歐版 Pokémon Emerald。');
  progress('正在套用動物考察更新…');
  const response=await fetch(new URL('./patches/emerald-safari-1.14.bps',import.meta.url));
  if(!response.ok) throw badPatch();
  const patch=new Uint8Array(await response.arrayBuffer());
  if(await digest(patch)!==PATCH_SHA) throw badPatch();
  const result=applyPatch(bytes,patch);
  if(await digest(result)!==EDITED_SHA) throw badPatch();
  return result;
}
export function batteryBytes(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (![131072,131088].includes(b.byteLength)) return null;
  const view = new DataView(b.buffer,b.byteOffset,131072);
  const slots = new Map();
  for(let at=0;at<28*4096;at+=4096) {
    const sector = view.getUint16(at+0xff4,true);
    if(sector>13 || view.getUint32(at+0xff8,true)!==0x08012025) continue;
    const generation=view.getUint32(at+0xffc,true);
    slots.set(generation,(slots.get(generation)||0)|(1<<sector));
  }
  return [...slots.values()].some(sectors=>sectors===0x3fff) ? b.subarray(0,131072) : null;
}

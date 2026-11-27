// The patched BPEE map/warp tables and tile collision flags come from the player's cartridge.
const GROUP_COUNTS = [57,5,5,6,7,8,9,7,7,14,8,17,10,23,13,15,15,2,2,2,3,1,1,1,108,61,89,2,1,13,1,1,3,1];
const CENTERS = [[2,2],[3,1],[4,5],[5,4],[6,4],[7,0],[8,4],[9,11],[10,5],[11,5],[12,2],[13,6],[14,3],[15,2],[16,10],[16,12],[26,53]];
const mapKey = (group,map) => group*256+map;
function coordinates(position) {
  if (!position) return null;
  if (Number.isInteger(position.group) && Number.isInteger(position.map)) return position;
  const m=/^hoenn-(\d+)-(\d+)$/.exec(position.area);
  return m ? {group:Number(m[1]),map:Number(m[2]),x:position.x,y:position.y} : null;
}
const square = (m,x,y) => m && x>=0 && y>=0 && x<m.w && y<m.h ? m.base+(y+1)*m.stride+x+1 : 0;
const onSameLevel = (a,b) => a===b || a===1 || b===1 || a===16 || b===16 || (a===2&&b===4) || (b===2&&a===4);

function routing(rom) {
  const data=rom instanceof Uint8Array ? rom : new Uint8Array(rom);
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const half=at=>view.getUint16(at,true);
  const word=at=>view.getUint32(at,true);
  const pointer=at=>word(at)-0x08000000;
  const maps=new Map(), mapList=[];
  let size=1;
  for (let group=0;group<GROUP_COUNTS.length;group++) {
    const groupTable=pointer(0x486578+4*group);
    for (let map=0;map<GROUP_COUNTS[group];map++) {
      const header=pointer(groupTable+4*map), layout=pointer(header);
      const w=word(layout), h=word(layout+4), stride=w+2;
      const m={group,map,header,layout,w,h,stride,section:data[header+0x14],base:size,index:mapList.length,warps:[],exits:[]};
      size+=stride*(h+2);mapList.push(m);maps.set(mapKey(group,map),m);
    }
  }
  const elevation=new Uint8Array(size), behavior=new Uint8Array(size), ownerMap=new Uint16Array(size);
  const incoming=new Map(), clinics=[];
  function edge(from,to) {
    if(!from || !to || !elevation[from] || !elevation[to]) return;
    const links=incoming.get(to);
    if(links) links.push(from); else incoming.set(to,[from]);
  }
  for(const m of mapList) {
    const layoutTiles=pointer(m.layout+12);
    const attrs=[pointer(pointer(m.layout+16)+16),pointer(pointer(m.layout+20)+16)];
    for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
      const at=square(m,x,y), block=half(layoutTiles+2*(y*m.w+x)), tile=block&1023;
      elevation[at]=block&0xc00 ? 0 : 1+(block>>>12);
      behavior[at]=data[attrs[tile>=512?1:0]+2*(tile%512)];
      ownerMap[at]=m.index;
    }
    const events=pointer(m.header+4);
    if(events<0)continue;
    const list=pointer(events+8);
    for(let i=0;i<data[events+1];i++){
      const at=list+8*i,x=half(at),y=half(at+2),id=square(m,x,y);
      // A doorway on a building facade is activated from the walkable tile immediately below.
      const stand=elevation[id]?id:square(m,x,y+1);
      m.warps.push({x,y,stand,group:data[at+7],map:data[at+6],warp:data[at+5]});
    }
  }
  for(const [group,map] of CENTERS) {
    const m=maps.get(mapKey(group,map)), events=pointer(m.header+4), people=pointer(events+4);
    // Every converted clinic retains the original nurse at local object ID 1.
    let nurse=people;
    while(nurse<people+24*data[events] && data[nurse]!==1)nurse+=24;
    const x=half(nurse+4), y=half(nurse+6)+2, stand=square(m,x,y);
    if(nurse>=people+24*data[events] || !elevation[stand]) throw new Error('找不到醫護站的櫃檯。');
    clinics.push({group,map,x,y,stand});
  }
  for(const m of mapList) {
    for(const w of m.warps) {
      const next=maps.get(mapKey(w.group,w.map))?.warps[w.warp];
      if(next) { edge(w.stand,next.stand); m.exits.push({group:w.group,map:w.map,x:next.x,y:next.y}); }
    }
    // Ledges are one-way; a student on the upper side can still reach a lower clinic.
    for(let y=1;y<m.h-1;y++)for(let x=1;x<m.w-1;x++){
      const id=square(m,x,y), kind=behavior[id];
      if(kind>=0x38 && kind<=0x3b){
        const d=[1,-1,-m.stride,m.stride][kind-0x38];edge(id-d,id+d);
      }
    }
    const c=pointer(m.header+12);
    if(c<0)continue;
    const entries=pointer(c+4);
    for(let i=0;i<word(c);i++){
      const at=entries+12*i, direction=data[at], offset=view.getInt32(at+4,true);
      const other=maps.get(mapKey(data[at+8],data[at+9]));
      if(!other)continue;
      if(direction===1 || direction===2){
        for(let x=0;x<m.w;x++)edge(square(m,x,direction===1?m.h-1:0),square(other,x-offset,direction===1?0:other.h-1));
      } else if(direction===3 || direction===4){
        for(let y=0;y<m.h;y++)edge(square(m,direction===3?0:m.w-1,y),square(other,direction===3?other.w-1:0,y-offset));
      } else if(direction===5 || direction===6) {
        if(direction===6)m.surface={group:other.group,map:other.map};
        for(let y=0;y<Math.min(m.h,other.h);y++)for(let x=0;x<Math.min(m.w,other.w);x++){
          const from=square(m,x,y),to=square(other,x,y);
          const top=behavior[direction===5?from:to], bottom=behavior[direction===5?to:from];
          if((top===0x11||top===0x12||top===0x14) && bottom!==0x19 && bottom!==0x2a)edge(from,to);
        }
      }
    }
  }
  function trace(summitUnlocked) {
    // A single multi-source search assigns the nearest walkable nurse to each reachable tile.
    const labels=new Uint8Array(size),queue=new Uint32Array(size);
    let head=0,tail=0;
    for(let i=0;i<clinics.length;i++){
      const c=clinics[i];
      if(c.group===16 && !summitUnlocked)continue;
      labels[c.stand]=i+1;queue[tail++]=c.stand;
    }
    function visit(next,label){if(!labels[next]){labels[next]=label;queue[tail++]=next;}}
    while(head<tail){
      const id=queue[head++], label=labels[id], m=mapList[ownerMap[id]], level=elevation[id];
      for(const next of [id-1,id+1,id-m.stride,id+m.stride]){
        if(!labels[next] && elevation[next] && onSameLevel(elevation[next],level))visit(next,label);
      }
      const links=incoming.get(id);
      if(links)for(const from of links)visit(from,label);
    }
    return labels;
  }
  const cache=[];
  function lookup(position,summitUnlocked) {
    const p=coordinates(position), m=p && maps.get(mapKey(p.group,p.map));
    if(!m)return null;
    const labels=cache[Number(summitUnlocked)] ??= trace(summitUnlocked);
    const id=square(m,p.x,p.y);
    if(id && labels[id])return clinics[labels[id]-1];
    // Map scripts can move blocks or the player (e.g. gym puzzles and tidal caves).
    // For those squares choose the closest routed floor within the same room.
    const px=Number.isFinite(p.x)?p.x:m.w/2, py=Number.isFinite(p.y)?p.y:m.h/2;
    let best=Infinity,label=0;
    for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
      const k=labels[square(m,x,y)],cost=Math.abs(px-x)+Math.abs(py-y);
      if(k && cost<best){best=cost;label=k;}
    }
    return label?clinics[label-1]:null;
  }
  return (position,fallback,{summitUnlocked=false}={})=>{
    const p=coordinates(position);
    let c=lookup(p,summitUnlocked);
    const m=p && maps.get(mapKey(p.group,p.map));
    if(!c && m?.surface)c=lookup({...m.surface,x:p.x,y:p.y},summitUnlocked);
    // Runtime-altered exits (tides and the Sky Pillar seal) still lead to the
    // same outdoor warp. Search their connected rooms for an accessible exit.
    if(!c && m){
      const todo=[m],seen=new Set(todo);
      for(let i=0;i<todo.length && !c;i++)for(const exit of todo[i].exits){
        const dest=maps.get(mapKey(exit.group,exit.map));
        if(!dest || seen.has(dest))continue;
        c=lookup(exit,summitUnlocked);if(c)break;
        seen.add(dest);todo.push(dest);
      }
    }
    if(!c && m && m.group>=2 && m.group<=16)
      c=clinics.find(k=>k.group===m.group && (m.group!==16||summitUnlocked));
    if(!c && m){
      // High tide layouts and scripted subrooms share a map section with their entrance.
      // Secret bases and the moving ship have no fixed geographical section.
      const section=m.section;
      if(![84,86,87,196,200,201,203,204,205,211].includes(section)){
        for(const other of mapList)if(other!==m && other.section===section){
          c=lookup({group:other.group,map:other.map},summitUnlocked);if(c)break;
        }
        // A few dive exits and ferries are scripted rather than stored as warps.
        // Project their regional-map marker onto the surface route beneath it.
        if(!c){
          const at=0x5a147c+8*section, rx=data[at],ry=data[at+1];
          for(const surface of mapList){
            if(surface.group!==0 || surface.map>=50)break;
            const box=0x5a147c+8*surface.section,left=data[box],top=data[box+1],w=data[box+2],h=data[box+3];
            if(rx<left||rx>=left+w||ry<top||ry>=top+h)continue;
            const x=Math.floor((rx-left+0.5)*surface.w/w), y=Math.floor((ry-top+0.5)*surface.h/h);
            c=lookup({group:0,map:surface.map,x,y},summitUnlocked);if(c)break;
          }
        }
      }
    }
    if(!c)c=lookup(fallback,summitUnlocked);
    const {group,map,x,y}=c || clinics[0];
    return {group,map,x,y};
  };
}
export function createClinicLocator(rom) {
  // Skip graph construction entirely on a user's first ever launch.
  let locate;
  return (...args)=>(locate ??= routing(rom))(...args);
}

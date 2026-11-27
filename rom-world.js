// Emerald Safari 1.14, BPEE. The GBA owns the camera, local avatar and every game UI.
// This layer only adds the names and the visiting students' cartridge sprite frames.
const GBA_ROM = 0x08000000;
const MAIN = 0x030022c0, FIELD = 0x08085e5c, BATTLE = 0x08038420;
const SAVE_PTR = 0x03005d8c, OBJECTS = 0x02037350, AVATAR = 0x02037590;
const SPRITES = 0x02020630, OFFSET_X = 0x02021bbc, OFFSET_Y = 0x02021bbe;
const CAMERA = 0x03005dd0, TOTAL_X = 0x03005dec, TOTAL_Y = 0x03005de8;
const GRAPHICS = 0x08505620, PALETTES = 0x0850bbc8;
const directionNames = ['down','down','up','left','right'];
const directions = ['down','up','left','right'];
const studentGraphics = [38,47,7,8,35,6,9,10,31,32,13,14];
const avatarGraphics = new Set([0,1,2,3,63,89,90,91,92,93,111,112,137,138,191,192,193,194]);
const s8 = n => n<<24>>24;
const s16 = n => n<<16>>16;
const cameraRemainder = n => (n > 0 ? 16 : n < 0 ? -16 : 0) - n;

function cartridgeArt(buffer) {
  if (!buffer) return null;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const valid = (a,n) => Number.isInteger(a) && a >= GBA_ROM && a+n <= GBA_ROM+bytes.length;
  const half = a => valid(a,2) ? view.getUint16(a-GBA_ROM,true) : 0;
  const word = a => valid(a,4) ? view.getUint32(a-GBA_ROM,true) : 0;
  const palettes = new Map(), cache = new Map();
  for (let i=0;i<36;i++) {
    const at=PALETTES+8*i, p=word(at);
    if (valid(p,32)) palettes.set(half(at+4),p);
  }
  function geometry(id) {
    if (!Number.isInteger(id) || id<0 || id>=239) return null;
    const info=word(GRAPHICS+4*id);
    if(!valid(info,36)) return null;
    const w=half(info+8), h=half(info+10);
    if (![8,16,32,64].includes(w) || ![8,16,32,64].includes(h)) return null;
    return {w,h, palette:palettes.get(half(info+2)), images:word(info+28), anims:word(info+24)};
  }
  function pose(id, facing, stepFrame) {
    const key=id+'-'+facing+'-'+stepFrame;
    if (cache.has(key)) return cache.get(key);
    const g=geometry(id);
    if(!g?.palette || !g.images) return null;
    const direction=Math.max(0,directions.indexOf(facing));
    const list=word(g.anims+4*(direction+(stepFrame>=0?4:0)));
    // Standard overworld four-command step cycle also encodes the right-facing mirror.
    const command=list+(stepFrame>=0?stepFrame%4:0)*4;
    let frame=half(command), flags=half(command+2);
    if (frame>50) { const standing=word(g.anims+direction*4); frame=half(standing); flags=half(standing+2); }
    const image=word(g.images+frame*8),size=half(g.images+frame*8+4);
    if (size<g.w*g.h/2 || !valid(image,g.w*g.h/2)) return null;
    const surface=document.createElement('canvas');
    surface.width=g.w; surface.height=g.h;
    const c=surface.getContext('2d'), data=c.createImageData(g.w,g.h);
    const expand=v=>(v<<3)|(v>>2);
    let top=g.h, bottom=0;
    for(let y=0;y<g.h;y++) for(let x=0;x<g.w;x++){
      const sourceX=flags&0x40?g.w-1-x:x;
      const sourceY=flags&0x80?g.h-1-y:y;
      const tile=(sourceY>>3)*(g.w>>3)+(sourceX>>3);
      const packed=bytes[image-GBA_ROM+tile*32+(sourceY%8)*4+((sourceX%8)>>1)];
      const index=sourceX%2?packed>>4:packed&15;
      if(index===0)continue;
      const color=half(g.palette+index*2), pixel=4*(y*g.w+x);
      data.data[pixel]=expand(color&31);
      data.data[pixel+1]=expand(color>>5&31);
      data.data[pixel+2]=expand(color>>10&31);
      data.data[pixel+3]=255;
      top=Math.min(top,y);bottom=Math.max(bottom,y+1);
    }
    c.putImageData(data,0,0);
    const result={surface,w:g.w,h:g.h,top,bottom};
    cache.set(key,result);
    return result;
  }
  return {pose};
}

export function createRomWorld({read8,read16,read32,rom}) {
  const b=read8;
  const h=read16 || (a=>b(a)+b(a+1)*256);
  const w=read32 || (a=>(h(a)+h(a+2)*65536)>>>0);
  const sh=a=>s16(h(a)), sw=a=>w(a)|0;
  const art=cartridgeArt(rom);
  let lastField=null;
  const motion=new Map();
  function sample() {
    const cb=w(MAIN+4)&~1;
    const observing=Boolean(cb===BATTLE || (b(MAIN+0x439)&2));
    function hidden() {
      return {visible:false, observing, state:lastField?{...lastField,observing}:null};
    }
    if (cb!==FIELD || observing) return hidden();
    const save=w(SAVE_PTR);
    if(save<0x02000000 || save+0x3800>0x02040000) return hidden();
    const id=b(AVATAR+5);
    if(id>=16)return hidden();
    const obj=OBJECTS+id*36,spriteId=b(obj+4);
    if(!(b(obj)&1) || !(b(obj+2)&1) || spriteId>=64) return hidden();
    const x=sh(obj+16)-7,y=sh(obj+18)-7,group=b(save+4),map=b(save+5);
    if(x<0 || y<0 || x>255 || y>255 || group>34) return hidden();
    const sprite=SPRITES+0x44*spriteId, look=b(obj+5);
    const facing=directionNames[b(obj+24)&15] || 'down';
    lastField={area:'hoenn-'+group+'-'+map,x,y,facing,look,observing:false};
    // CB2_Overworld also owns scripts, fades, NPC text and the native Start menu.
    if(b(0x03000f2c) || b(0x03000e38)!==2 || b(0x020375bc) || (b(0x02037fdb)&0x80) ||
        b(obj+1)&0x20 || (b(sprite+0x3e)&5)!==1) return hidden();
    const dx=sh(OFFSET_X),dy=sh(OFFSET_Y);
    const cameraX=(7-sh(save))*16+8+cameraRemainder(sw(CAMERA+16))+s16(dx-sh(TOTAL_X));
    const cameraY=(7-sh(save+2))*16+16+cameraRemainder(sw(CAMERA+20))+s16(dy-sh(TOTAL_Y));
    const localX=sh(sprite+32)+sh(sprite+36)+dx;
    const localY=sh(sprite+34)+sh(sprite+38)+dy-s8(b(sprite+41));
    const anim=b(sprite+42),command=b(sprite+43);
    return {visible:true,observing:false,state:lastField,cameraX,cameraY,localX,localY,
      localHeight:-2*s8(b(sprite+41)),localStep:anim>=4&&anim<8?command%4:-1,
      // Native area-name window has a separate small tilemap above visiting students.
      routeSign:b(0x0203cd8d)!==0xff && isNamePopupAlive()};
  }
  function isNamePopupAlive() {
    for(let i=0;i<16;i++){const t=0x03005e00+i*40;if (b(t+4) && (w(t)&~1)===0x080d487c)return true;}
    return false;
  }
  function resetMotion() {motion.clear();}
  function remotePosition(p,now) {
    const id=p.id??p.slot;
    let m=motion.get(id);
    if(!m || m.area!==p.area || !Number.isFinite(m.x)) {
      m={area:p.area,x:p.x,y:p.y,fromX:p.x,fromY:p.y,start:now-200,parity:0};
      motion.set(id,m);
    }
    const interp=(from,to)=>from+(to-from)*Math.max(0,Math.min(1,(now-m.start)/135));
    if(m.x!==p.x||m.y!==p.y){
      const nearby=Math.abs(m.x-p.x)+Math.abs(m.y-p.y)<=2;
      m.fromX=nearby?interp(m.fromX,m.x):p.x; m.fromY=nearby?interp(m.fromY,m.y):p.y;
      m.x=p.x;m.y=p.y;m.start=nearby?now:now-200;m.parity^=1;
    }
    const elapsed=now-m.start;
    return {x:interp(m.fromX,m.x),y:interp(m.fromY,m.y),
      step:elapsed<135?(m.parity?0:2)+(elapsed>=75?1:0):-1};
  }

  function draw(canvas,{local,peers=[],time=performance.now(),sample:field=sample()}) {
    if (!canvas) return;
    const width=Math.round(canvas.clientWidth || canvas.width || 240);
    const height=Math.round(canvas.clientHeight || canvas.height || 160);
    const dpr=Math.min(globalThis.devicePixelRatio || 1,2);
    const pw=Math.max(1,Math.round(width*dpr)),ph=Math.max(1,Math.round(height*dpr));
    if(canvas.width!==pw)canvas.width=pw;
    if(canvas.height!==ph)canvas.height=ph;
    const c=canvas.getContext('2d'); c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,pw,ph);
    if(!field.visible) {resetMotion();return;}
    const {state}=field, group=[];
    const ids=new Set();
    for(const peer of peers){
      if(peer.area!==state.area || !Number.isInteger(peer.x) || !Number.isInteger(peer.y))continue;
      ids.add(peer.id??peer.slot);
      const pos=remotePosition(peer,time);
      const x=Math.round(field.cameraX+pos.x*16), y=Math.round(field.cameraY+pos.y*16);
      // Keep every label with its sprite. A distant classmate does not produce an edge badge.
      if(x<=-7 || x>=247 || y<=2 || y>=183) continue;
      const graphic=avatarGraphics.has(peer.look)?peer.look:studentGraphics[(peer.slot??0)%studentGraphics.length];
      const frame=art?.pose(graphic,peer.facing,pos.step);
      if(!frame || x+frame.w/2<=0 || x-frame.w/2>=240 || y-frame.h+frame.top>=160 || y-frame.h+frame.bottom<=0)continue;
      group.push({peer,x,y,frame,top:y-frame.h+frame.top});
    }
    for (const id of motion.keys()) if(!ids.has(id)) motion.delete(id);
    const localFrame=art?.pose(state.look,state.facing,field.localStep);
    const me={peer:local||{},x:field.localX,y:field.localY,frame:localFrame,local:true,
      top:field.localY-field.localHeight+(localFrame?.top??3)};
    group.push(me);
    group.sort((a,b)=>a.y-b.y||Number(a.local===true)-Number(b.local===true));
    c.save();c.scale(pw/240,ph/160);c.imageSmoothingEnabled=false;
    if(field.routeSign) {
      c.beginPath(); c.rect(0,0,240,160); c.rect(0,0,88,33); c.clip('evenodd');
    }
    for(const a of group){
      if(!a.frame)continue;
      if(a.local){
        // Leave the native hero in front of classmate pixels behind their silhouette.
        c.save();c.globalCompositeOperation='destination-out';
        c.drawImage(a.frame.surface,Math.round(a.x-a.frame.w/2),Math.round(a.y-a.frame.h));c.restore();
      } else c.drawImage(a.frame.surface,Math.round(a.x-a.frame.w/2),Math.round(a.y-a.frame.h));
    }
    c.restore();
    c.save();c.setTransform(pw/width,0,0,ph/height,0,0);
    const sx=width/240,sy=height/160;
    if(field.routeSign){c.beginPath();c.rect(0,0,width,height);c.rect(0,0,88*sx,33*sy);c.clip('evenodd');}
    const size=Math.max(9,Math.min(25,Math.round(5.8*sy)));
    c.font='600 '+size+'px "PingFang HK","Microsoft JhengHei",sans-serif';
    c.textAlign='center'; c.textBaseline='bottom'; c.lineJoin='round';
    const placed=[];
    for(const a of [me,...group.filter(v=>!v.local)]){
      const title=[a.peer.className,a.peer.name].filter(Boolean).join(' ');
      if(!title)continue;
      const iconScale=Math.max(1,Math.round(size/7));
      const iconWidth=a.peer.observing?iconScale*8:0;
      const tw=c.measureText(title).width+iconWidth+4;
      let x=Math.max(tw/2+1,Math.min(width-tw/2-1,a.x*sx));
      let y=Math.max(size+1,Math.min(height-2,(a.top-1)*sy));
      // Name tags for students on adjacent tiles can overlap at the standard GBA zoom.
      // Offset just the conflicting label and draw a fine leader to the student.
      const rawY=y;
      for(let attempt=0;attempt<3;attempt++){
        if(!placed.some(l=>Math.abs(l.x-x)*2<l.w+tw && Math.abs(l.y-y)<size+1))break;
        const raised=y-(size+2);
        y=raised>size+1?raised:rawY+(attempt+1)*(size+2);
      }
      if(y!==rawY){c.beginPath();c.moveTo(x,y);c.lineTo(a.x*sx,rawY);c.strokeStyle='#3c5045';c.lineWidth=1;c.stroke();}
      c.strokeStyle='#283630';c.lineWidth=Math.max(2,size*.18);
      c.strokeText(title,x-iconWidth/2,y);
      c.fillStyle=a.local?'#ffed9d':'#fffdf3';c.fillText(title,x-iconWidth/2,y);
      if(a.peer.observing){
        const left=Math.round(x+tw/2-iconWidth),top=Math.round(y-size/2-iconScale*3);
        const binoculars=['.##.##.','.##.##.','#######','#..#..#','#######'];
        c.fillStyle='#293c32';c.fillRect(left-1,top-1,7*iconScale+2,5*iconScale+2);
        c.fillStyle='#caffdc';
        binoculars.forEach((row,j)=>{for(let i=0;i<row.length;i++)if(row[i]==='#')c.fillRect(left+i*iconScale,top+j*iconScale,iconScale,iconScale);});
      }
      placed.push({x,y,w:tw});
    }
    c.restore();
  }
  return {sample,draw,resetMotion};
}

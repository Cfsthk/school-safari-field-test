// Outdoor field study map, drawn with original pixel tiles and student sprites.
// Coordinates increase from the upper left. Route connections preserve x.
const layout = {
  littleroot: [
    '##########..########','##########..########','##................##','##................##',
    '....................','..HHHHH......HHHHH..','..HHHHH......HHHHH..','..HHHHH......HHHHH.f',
    'f.HHHHHs....sHHHHHf.','.f.................f','f..f............f.f.','....................',
    '....................','...HHHHHHH.....s....','...HHHHHHH..........','...HHHHHHH..........',
    '...HHHHHHH........##','...fffs...........##','##.fff..........####','##..............####',
  ],
  route101: [
    '########ppp.########','########ppp.########','##ggg........ggg####','##gggg......gggg####',
    'gggggg......gggggg##','..ggg........ggggg##','##gg..=====##..gg...','##=====....####..pp.',
    '##.........####.ppp.','####.s.ppp.##gg.pppp','####.ppppp.ggggg.ppp','####.ppppp.gggggg.pp',
    '####..ppp..gggggg...','##gg....====..ggg...','ggggg.......##gg..##','..gggg......##....##',
    '##gggg......########','##..........########','##########..########','##########..########',
  ],
  oldale: [
    '########.pp.########','########ppp.########','####....pppp....####','####....pppp....####',
    '##......pppp.HHHH.##','##.fHHHHpppppHHHH.##','##f.HHHHpppppHHHH.##','##.fHHHHpppppppppp##',
    '##f..pppp..fppppppp.','##.ppppppf.sppppppp.','..ppppppp.f.pppppp..','..ppppppppppppppp...',
    '##...pppppppppp...##','##.......ppppp....##','##...HHHHpppp.HHHH##','##...HHHHpppp.HHHH##',
    '####.HHHHpppp.HHHH##','####...ppppp......##','####...ppppp....####','####....pppp....####',
  ],
};
const landmark = (x, y, kind, name) => ({x, y, kind, name});
export const areas = {
  littleroot: {id:'littleroot',name:'未白鎮',spawn:{x:10,y:14},width:20,height:20,landmarks:[
    landmark(7,17,'doctor','博士'),landmark(15,13,'sign','未白鎮'),landmark(6,17,'sign','動物研究所'),
    landmark(7,8,'sign','學生宿舍'),landmark(12,8,'sign','學生宿舍'),
  ]},
  route101: {id:'route101',name:'101 號道路',spawn:{x:9,y:11},width:20,height:20,landmarks:[
    landmark(5,11,'ranger','護林員'),landmark(5,9,'sign','101 號道路'),
  ]},
  oldale: {id:'oldale',name:'古辰鎮',spawn:{x:9,y:16},width:20,height:20,landmarks:[
    landmark(11,9,'sign','古辰鎮'),landmark(13,7,'ranger','護林員'),
  ]},
};
const north = {littleroot:'route101',route101:'oldale'};
const south = {oldale:'route101',route101:'littleroot'};
const terrain = {'.':'meadow',f:'flowers',g:'grass',p:'path','#':'wall',H:'building','=':'ledge',s:'sign'};

export function tileAt(area,x,y) {
  const row = layout[area]?.[y];
  return terrain[row?.[x]] || 'wall';
}
export function canStand(area,x,y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !areas[area]) return false;
  const tile = tileAt(area,x,y);
  if (!['meadow','flowers','grass','path'].includes(tile)) return false;
  return !areas[area].landmarks.some(l => l.kind !== 'sign' && l.x === x && l.y === y);
}
export function step(area,x,y,dx,dy) {
  if (!areas[area] || !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx)+Math.abs(dy)!==1) return null;
  let dest=area, nextX=x+dx, nextY=y+dy;
  if(nextY<0) { dest=north[area]; nextY=19; }
  else if(nextY>19) { dest=south[area]; nextY=0; }
  if(!dest || nextX<0 || nextX>=20 || !canStand(area,x,y)) return null;
  // The low south-facing banks have a landing tile exactly one row below.
  if(dy===1 && tileAt(dest,nextX,nextY)==='ledge') nextY++;
  return canStand(dest,nextX,nextY) ? {area:dest,x:nextX,y:nextY} : null;
}
export function suggestSpawns(area,count) {
  if(!areas[area] || count<1) return [];
  const points=[];
  for(let y=2;y<18;y++) for(let x=1;x<19;x++) if(canStand(area,x,y)) points.push({x,y});
  const picked=[{...areas[area].spawn}];
  // Spread names horizontally as well as vertically; skip transition throats.
  while(picked.length<count && picked.length<points.length) {
    let best, bestScore=-1;
    for(const p of points) {
      let nearest=Infinity;
      for(const q of picked) nearest=Math.min(nearest,((p.x-q.x)*0.78)**2+(p.y-q.y)**2);
      if(nearest===0) continue;
      const edgePenalty=(p.x===1 || p.x===18 || p.y===2 || p.y===17) ? 0.25 : 0;
      const score=nearest-edgePenalty+(noise(p.x,p.y,36)%100)/2000;
      if(score>bestScore){best=p;bestScore=score;}
    }
    if(!best) break; picked.push(best);
  }
  return picked;
}

const T=24, margin=12;
function noise(x,y,k=0) {
  let n=Math.imul(x+879,73856093)^Math.imul(y+431,19349663)^Math.imul(k+139,83492791);
  n=Math.imul(n^(n>>>13),1274126177);
  return (n^(n>>>16))>>>0;
}
function box(c,color,x,y,w,h) {
  c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);
}
function poly(c,color,pts) {
  // Scan into whole pixels so roof lines, shrubs and hills keep their crisp edges.
  const ys=pts.map(p=>p[1]); const lo=Math.floor(Math.min(...ys)),hi=Math.ceil(Math.max(...ys));
  c.fillStyle=color;
  for(let y=lo;y<hi;y++){
    const edges=[];
    for(let i=0,j=pts.length-1;i<pts.length;j=i++) {
      const a=pts[i],b=pts[j],cy=y+.5;
      if((a[1]>cy)!==(b[1]>cy)) edges.push(a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    edges.sort((a,b)=>a-b);
    for(let i=0;i+1<edges.length;i+=2) c.fillRect(Math.round(edges[i]),y,Math.round(edges[i+1])-Math.round(edges[i]),1);
  }
}
function stamp(w,h,draw) {
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;draw(c);return canvas;
}
const greens=['#8ac875','#8ccc77','#8cc979','#87c976'];
const skyShade=['#78b774','#74b776','#86c87b','#9cd78b'];
function grassUnder(c,x,y,mapY) {
  const seed=noise(x,mapY); const ox=x*T, oy=y*T;
  box(c,greens[seed%4],ox,oy,T,T);
  for(let i=0;i<7;i++){
    const h=noise(x,mapY,i+44), px=ox+h%22,py=oy+(h>>>12)%23;
    box(c,skyShade[(h>>>7)%4],px,py,2,1);
    if(i===0){box(c,'#9ed885',px-1,py-1,1,1);box(c,'#78b878',px+2,py-1,1,1);}
  }
}
function fieldGrass(c,ox,oy,gx,gy) {
  for(let row=0;row<3;row++) for(let col=0;col<3;col++){
    const h=noise(gx*3+col,gy*3+row,9);
    const x=ox+col*8+3+(row%2),y=oy+row*8+5+(h%2);
    box(c,'#74b672',x-4,y+1,8,3);
    poly(c,'#397c58',[[x-4,y],[x-4,y-4],[x-1,y-1],[x,y-6],[x+2,y-2],[x+5,y-4],[x+4,y],[x+1,y+3],[x-1,y+3]]);
    poly(c,'#52a95f',[[x-4,y-4],[x,y-1],[x,y-6],[x+2,y],[x+5,y-4],[x+1,y+2],[x-1,y+2]]);
    box(c,'#a9db78',x,y-5,1,3);box(c,'#86d16d',x-3,y-3,1,2);
  }
}

const trees=new Map();
function tree(variant) {
  if(trees.has(variant))return trees.get(variant);
  const art=stamp(49,54,c=>{
    // Rounded broadleaf trees, assembled from six overlapping leaf clusters.
    const p=variant%3;
    const palette=[
      ['#265649','#337752','#53985b','#74b663','#97ca75'],
      ['#24574a','#367d56','#50995e','#74b768','#9acc7a'],
      ['#285747','#3a7950','#57995b','#78b662','#a1cb73'],
    ][p];
    poly(c,'#70a66a',[[0,42],[4,38],[36,37],[48,43],[46,49],[35,52],[7,51],[0,48]]);
    poly(c,'#426e52',[[8,43],[20,39],[35,40],[40,44],[35,48],[17,49],[8,47]]);
    poly(c,'#4d5c44',[[17,34],[32,33],[30,43],[34,47],[28,47],[24,45],[20,48],[14,47],[19,43]]);
    box(c,'#a88059',21,36,4,10);box(c,'#786b4c',26,36,3,9);
    const outline=[[19,1],[28,1],[34,5],[36,9],[41,11],[43,16],[46,19],[46,25],[48,29],[47,35],[44,38],[42,42],[36,43],[32,45],[25,44],[20,46],[13,44],[7,43],[5,39],[1,36],[2,31],[0,27],[3,22],[3,17],[8,14],[10,9],[15,7]];
    poly(c,palette[0],outline);
    poly(c,palette[1],[[19,4],[27,3],[32,6],[36,12],[40,13],[42,18],[44,21],[43,26],[45,29],[44,34],[41,37],[37,37],[34,41],[29,40],[25,42],[18,40],[15,42],[10,40],[8,37],[5,36],[6,32],[3,28],[6,23],[5,19],[10,16],[12,10],[16,10]]);
    function lobe(x,y,w,h,color){
      poly(c,color,[[x+w*.3,y],[x+w*.7,y],[x+w*.8,y+2],[x+w*.94,y+3],[x+w,y+h*.7],[x+w*.78,y+h-1],[x+w*.61,y+h],[x+w*.41,y+h-1],[x+w*.26,y+h],[x+1,y+h-3],[x,y+h*.48],[x+2,y+3]]);
    }
    for(const [x,y,w,h] of [[8,23,15,13],[20,27,18,12],[30,19,14,14],[4,17,18,12],[15,15,20,14],[24,9,16,13],[11,8,18,12],[17,3,14,11]]){
      lobe(x,y,w,h,palette[2]);lobe(x+1,y,w-4,h-4,palette[3]);
      box(c,palette[4],x+3,y+3,3,1);box(c,palette[4],x+5,y+1,4,2);
      box(c,palette[1],x+w-4,y+h-3,2,1);
    }
    box(c,palette[3],11,37,3,2);box(c,palette[2],18,40,2,2);
  });
  trees.set(variant,art);return art;
}
function flowerPatch(c,x,y,seed) {
  for(const [px,py] of [[4,6],[13,16],[18,8],[7,20]]) {
    const k=(seed+px)%3; const cy=y+py,cx=x+px;
    box(c,'#578e55',cx,cy+1,1,3);box(c,'#57965b',cx-2,cy+2,2,1);
    box(c,k===1?'#ffe99a':'#ffefe0',cx-1,cy-2,2,4);
    box(c,k===1?'#ffe99a':'#fff0dc',cx-2,cy-1,4,2);box(c,k===1?'#e1a855':'#db997d',cx-1,cy-1,2,1);
  }
}
function sign(c,x,y) {
  box(c,'#638e60',x+3,y+17,19,4);box(c,'#645c40',x+6,y+10,3,10);box(c,'#645c40',x+15,y+10,3,10);
  box(c,'#365c50',x+2,y+3,20,11);box(c,'#a98b59',x+3,y+4,18,9);box(c,'#f5dd99',x+4,y+5,16,7);
  box(c,'#ac8a56',x+6,y+7,9,1);box(c,'#ac8a56',x+7,y+9,11,1);
}
const roofs={
  teal:['#244e50','#347c79','#4c9f95','#87c1a9'],
  slate:['#354d60','#53778b','#6994a0','#9dbdbb'],
  rust:['#79554e','#b47059','#d38b65','#e6ae79'],
};
function building(c,x,y,w,h,color,type,door) {
  c.save();c.translate(x*T,y*T);
  const W=w*T,H=h*T,r=roofs[color],middle=Math.round(W*.49),roof=Math.round(H*.54),d=door*T+5;
  box(c,'#74a571',4,H-2,W-2,7);box(c,'#64916b',8,H,W-11,3);
  box(c,'#455d56',5,roof-3,W-10,H-roof+4);box(c,'#d9c9a2',7,roof+1,W-14,H-roof-3);
  box(c,'#e9d9af',8,roof+6,W-16,H-roof-14);box(c,'#baad8c',8,roof+1,W-16,5);
  for(let i=9;i<W-10;i+=10)box(c,'#c6b896',i,H-8,5,2);
  box(c,'#617567',4,H-3,W-8,4);box(c,'#9caa8b',7,H-3,W-14,2);
  for(let i=12;i<W-23;i+=23){
    if(i+17>=d-3 && i<=d+16)continue;
    box(c,'#8e9a86',i-1,roof+11,18,16);box(c,'#4c696b',i,roof+10,17,15);
    box(c,'#79a9a4',i+2,roof+12,13,10);box(c,'#b8d8c3',i+2,roof+12,5,4);
    box(c,'#ccdac2',i+9,roof+12,1,9);box(c,'#e2d0a3',i-2,roof+25,21,2);
  }
  box(c,'#738378',d-3,H-25,21,25);box(c,'#314e50',d,H-24,15,24);
  box(c,'#507d7a',d+2,H-22,11,19);box(c,'#8db2a5',d+3,H-21,8,7);box(c,'#edce88',d+10,H-9,2,2);
  box(c,'#ddcc9d',d-4,H-1,23,3);box(c,'#9c9878',d-6,H+2,26,2);
  const pitch=Math.max(6,Math.floor(H*.09));
  poly(c,r[0],[[0,roof],[4,pitch+3],[7,0],[W-9,0],[W-3,pitch+3],[W,roof],[W-3,roof+3],[2,roof+3]]);
  poly(c,r[1],[[3,roof-1],[7,pitch],[10,3],[W-11,3],[W-6,pitch],[W-3,roof-1]]);
  for(let yy=7;yy<roof-1;yy+=6){
    const edge=Math.max(5,9-(yy/7|0));box(c,r[2],edge,yy,W-edge*2,2);
    for(let xx=edge+6+((yy/6|0)%2)*6;xx<W-edge-4;xx+=13){
      box(c,r[0],xx,yy+2,1,3);box(c,r[3],xx-2,yy,3,1);
    }
  }
  box(c,r[3],10,2,W-21,2);box(c,r[0],1,roof-1,W-2,4);box(c,r[2],4,roof+1,W-8,1);
  if(type==='lab'||type==='clinic'||type==='shop'){
    const z=middle-11;
    box(c,'#58776d',z,roof-12,23,13);box(c,'#ece1b9',z+2,roof-10,19,9);
    if(type==='clinic'){box(c,'#b96556',z+10,roof-9,3,7);box(c,'#b96556',z+7,roof-7,9,3);}
    else if(type==='shop'){box(c,'#cca65e',z+6,roof-7,11,5);box(c,'#936f50',z+8,roof-9,6,2);}
    else {box(c,'#53836e',z+5,roof-7,4,4);box(c,'#53836e',z+14,roof-7,4,4);box(c,'#53836e',z+9,roof-8,5,2);}
  }
  c.restore();
}
const buildings={
  littleroot:[[2,4,5,5,'rust','home',3],[13,4,5,5,'teal','home',1],[3,12,7,5,'slate','lab',4]],
  oldale:[[4,4,4,4,'teal','home',1],[13,3,4,4,'slate','shop',1],[5,13,4,4,'rust','clinic',1],[14,13,4,4,'teal','home',1]],
};
function mapped(area,x,y) {
  if(x<0 || x>19)return '#';
  if(y<0)return north[area]&&y>=-20?layout[north[area]][y+20][x]:'#';
  if(y>=20)return south[area]&&y<40?layout[south[area]][y-20][x]:'#';
  return layout[area][y][x];
}
function drawPath(c,area,x,y) {
  const ox=x*T,oy=y*T,v=noise(x,y,41);
  const sides=[[0,-1],[-1,0],[1,0],[0,1]].map(([dx,dy])=>mapped(area,x+dx,y+dy)==='p');
  box(c,'#d7bb82',ox,oy,T,T);
  const sand='#e5cd91',edge='#c8ac75';
  box(c,sand,ox+(sides[1]?0:2),oy+(sides[0]?0:2),T-(sides[1]?0:2)-(sides[2]?0:2),T-(sides[0]?0:2)-(sides[3]?0:2));
  for(let u=0;u<T;u+=4){
    const j=(u/4+v)%3|0;
    if(!sides[0]){box(c,edge,ox+u,oy+j,4,1);box(c,'#8ac875',ox+u,oy,4,j);}
    if(!sides[3]){box(c,edge,ox+u,oy+T-j-1,4,1);box(c,'#8ac875',ox+u,oy+T-j,4,j);}
    if(!sides[1]){box(c,edge,ox+j,oy+u,1,4);box(c,'#8ac875',ox,oy+u,j,4);}
    if(!sides[2]){box(c,edge,ox+T-j-1,oy+u,1,4);box(c,'#8ac875',ox+T-j,oy+u,j,4);}
  }
  for(let i=0;i<4;i++){const n=noise(x,y,i+12);box(c,i%2?'#d8bd85':'#edd69e',ox+3+n%17,oy+4+(n>>>12)%16,2,1);}
}
function ledge(c,area,x,y) {
  const l=mapped(area,x-1,y)==='=',r=mapped(area,x+1,y)==='=';
  const ox=x*T,oy=y*T;const start=l?0:2,end=r?T:T-2;
  box(c,'#759b68',ox+start,oy+12,end-start,7);box(c,'#866d56',ox+start,oy+8,end-start,9);
  box(c,'#b38d6a',ox+start,oy+7,end-start,8);box(c,'#d2aa7c',ox+start,oy+6,end-start,4);
  for(const k of [3,10,18]){box(c,'#94765e',ox+k,oy+11,2,5);box(c,'#e5bd87',ox+k+2,oy+8,2,2);}
  box(c,'#519464',ox+start,oy+4,end-start,2);box(c,'#a1ce78',ox+start,oy+3,end-start,2);
}
const baseMaps=new Map();
function background(area) {
  if(baseMaps.has(area))return baseMaps.get(area);
  const canvas=stamp((20+margin*2)*T,(20+margin*2)*T,c=>{
    c.translate(margin*T,margin*T);
    const offset=area==='littleroot'?40:area==='route101'?20:0;
    for(let y=-margin;y<20+margin;y++)for(let x=-margin;x<20+margin;x++){
      const type=mapped(area,x,y);
      grassUnder(c,x,y,y+offset);
      if(type==='p')drawPath(c,area,x,y);
      if(type==='g')fieldGrass(c,x*T,y*T,x,y+offset);
      if(type==='f')flowerPatch(c,x*T,y*T,noise(x,y));
      if(type==='=')ledge(c,area,x,y);
      if(type==='s')sign(c,x*T,y*T);
    }
    for(let y=-margin;y<20+margin;y+=2) for(let x=-margin;x<20+margin;x+=2){
      const treeTiles=[[0,0],[1,0],[0,1],[1,1]].filter(([dx,dy])=>mapped(area,x+dx,y+dy)==='#');
      if(!treeTiles.length)continue;
      if(treeTiles.length===4) c.drawImage(tree(noise(x,y+offset)%3),x*T-1,y*T-4);
      else for(const [dx,dy] of treeTiles) {
        const tx=(x+dx)*T,ty=(y+dy)*T;
        c.drawImage(tree(noise(x+dx,y+dy+offset)%3),0,0,49,54,tx,ty-2,24,27);
      }
    }
    for(const [id,off] of [[north[area],-20],[area,0],[south[area],20]]){
      for(const [x,y,w,h,color,type,door] of buildings[id]||[])building(c,x,y+off,w,h,color,type,door);
    }
  });
  baseMaps.set(area,canvas);return canvas;
}

const clothes=[
  ['#3d707b','#5eacaf','#a4dacd'],['#a45b51','#d8806a','#f4b78a'],
  ['#485c83','#6f8db5','#bad5dd'],['#78648a','#a18aaf','#debecc'],
  ['#5c765a','#86a86a','#c6d993'],['#a77c44','#d8a458','#f4d18c'],
];
const hair=['#343e49','#4c403a','#625547','#333e3d','#63504e'];
const skin=[['#c78e6f','#f1be94','#ffe0ac'],['#a97359','#dba37f','#efc499'],['#b47d68','#e4ab91','#f7c9a5']];
const studentStamps=new Map();
function avatar(appearance,dir,walk=0,role='') {
  appearance=Math.abs(Math.trunc(appearance)||0)%72;
  if(!['up','down','left','right'].includes(dir))dir='down';
  const key=[appearance,dir,walk,role].join(':');
  if(studentStamps.has(key))return studentStamps.get(key);
  const sprite=stamp(22,27,c=>{
    const side=dir==='left'||dir==='right', back=dir==='up';
    if(dir==='left'){c.translate(22,0);c.scale(-1,1);}
    const h=role==='doctor'?'#b5b4a3':hair[(appearance*3+Math.floor(appearance/6))%hair.length];
    const [shadow,cloth,edge]=role==='doctor'?['#8ca59a','#e4e3c6','#fff4d7']:role==='ranger'?['#576c50','#79945c','#a9ba7b']:clothes[appearance%6];
    const [shade,face,lit]=skin[(appearance*5+Math.floor(appearance/4))%3];
    const outline='#354a48',pants=['#435465','#555774','#495d55'][appearance%3];
    const style=role==='ranger'?0:role==='doctor'?1:Math.floor(appearance/2)%5;
    const f=walk===1?1:0, ff=walk===2?1:0;
    // Ground shadow and feet.
    box(c,'rgba(48,73,51,.32)',4,24,14,2);box(c,'rgba(48,73,51,.22)',3,23,16,1);
    if(side){
      box(c,outline,7-f,20,5,5);box(c,pants,8-f,20,3,4-f);box(c,outline,11+ff,20,4,5);box(c,'#e0c49f',11+ff,24-f,5,1);
    }else{
      box(c,outline,5,20-f,5,5);box(c,pants,6,20-f,3,3);box(c,outline,12,20-ff,5,5);box(c,pants,13,20-ff,3,3);
      box(c,'#e2c8a1',5,24-f,4,1);box(c,'#e2c8a1',13,24-ff,4,1);
    }
    // School shirt, neckerchief and pack.
    poly(c,outline,[[5,14],[15,14],[18,17],[18,20],[16,21],[15,22],[6,22],[5,20],[3,20],[3,17]]);
    box(c,shadow,6,15,9,6);box(c,role?'#e6ddbc':'#f7e9ca',6,15,8,4);box(c,cloth,7,20,8,1);
    box(c,face,3,18,2,2);box(c,face,16,18,2,2);
    if(back || side){const pos=back?7:4;box(c,outline,pos-1,15,8,7);box(c,cloth,pos,15,6,6);box(c,edge,pos,16,5,1);box(c,shadow,pos+1,19,4,2);}
    else {box(c,cloth,8,15,5,2);box(c,shadow,10,17,2,2);box(c,shadow,5,15,2,4);box(c,edge,6,15,1,3);box(c,shadow,14,15,2,5);}
    // Hair contour, face and fringe.
    poly(c,outline,[[6,2],[14,2],[17,4],[18,7],[17,11],[15,14],[12,15],[6,14],[3,11],[3,6]]);
    poly(c,h,[[6,3],[14,3],[17,5],[17,10],[16,12],[14,14],[7,14],[4,11],[4,6]]);
    if(!back){
      const x=side?8:5;
      box(c,shade,x,8,side?9:11,5);box(c,face,x+1,8,side?8:9,4);box(c,face,x+2,12,side?5:7,1);
      box(c,lit,x+3,8,side?4:6,1);
      if(side){box(c,outline,15,9,1,2);box(c,face,17,10,1,2);box(c,h,7,7,3,4);}
      else {box(c,outline,7,9,1,2);box(c,outline,13,9,1,2);}
      box(c,h,5,6,11,2);box(c,h,6,7,2,2);box(c,h,10,7,2,1);
    }else {box(c,'rgba(245,218,174,.18)',6,5,6,1);box(c,h,5,12,10,2);}
    if(style===0 || style===3){
      const light=style===0?edge:'#ede1b7',base=style===0?cloth:'#c9bb93';
      poly(c,outline,[[4,5],[7,1],[13,1],[16,3],[18,7],[18,8],[3,8]]);
      box(c,base,5,4,11,3);box(c,base,7,2,6,3);box(c,light,7,3,5,1);
      box(c,style===3?'#9b8568':shadow,4,6,13,2);box(c,base,side?14:3,7,side?6:15,1);
    }else if(style===2){
      box(c,h,1,7,3,5);box(c,h,0,10,3,3);box(c,cloth,3,7,2,2);
      if(!side){box(c,h,17,7,3,6);box(c,cloth,16,7,2,2);}
    }else if(style===4){
      box(c,h,5,1,4,3);box(c,h,10,0,3,3);box(c,h,15,2,3,3);
    }
    if(!back && !side && appearance%7===1){
      box(c,'#504e4c',5,9,5,1);box(c,'#504e4c',11,9,5,1);box(c,'#504e4c',9,10,3,1);
    }
    if(role==='doctor'){box(c,'#8ca59a',10,16,2,3);box(c,'#f6e8c8',7,17,2,4);box(c,'#f6e8c8',13,17,2,4);}
  });
  studentStamps.set(key,sprite);return sprite;
}
function visiblePoint(p,scale,ox,oy) {
  return {x:ox+(p.x*T+T/2)*scale,y:oy+(p.y*T+T*.82)*scale};
}
function roundRect(c,x,y,w,h,r) {
  c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
}
function drawNames(c,actors,metrics) {
  const {width,height,scale}=metrics;
  const textSize=Math.max(11,Math.min(17,Math.round(scale*8.35)));
  const gap=Math.round(textSize*.3),boxH=textSize+5;
  c.font='600 '+textSize+'px "PingFang HK","Noto Sans TC","Microsoft JhengHei",sans-serif';
  c.textBaseline='middle';c.textAlign='center';
  const placed=[];
  // Place the local name first, then choose the nearest available label position.
  for(const actor of [...actors].sort((a,b)=>Number(b.local)-Number(a.local)||a.py-b.py||a.px-b.px)){
    const title=actor.className ? actor.className+' '+actor.name : actor.name;
    if(!title)continue;
    const tw=Math.ceil(c.measureText(title).width)+2*gap+(actor.observing?textSize+4:0);
    const cx=actor.px,top=actor.py-26*scale-2-boxH;
    function candidate(shiftX,shiftY){
      return {x:Math.round(Math.max(2,Math.min(width-tw-2,cx-tw/2+shiftX))),y:Math.round(Math.max(1,Math.min(height-boxH-1,top+shiftY))),w:tw,h:boxH};
    }
    const choices=[[0,0],[-tw*.3,0],[tw*.3,0],[0,-boxH],[-tw*.33,-boxH],[tw*.33,-boxH],[0,-2*boxH]];
    function overlap(a,b){return Math.max(0,Math.min(a.x+a.w+1,b.x+b.w+1)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h+1,b.y+b.h+1)-Math.max(a.y,b.y));}
    let best=null,score=Infinity;
    for(const [sx,sy] of choices){
      const rect=candidate(sx,sy);
      let weight=Math.abs(sx)*.07+Math.abs(sy)*.2;
      for(const other of placed)weight+=overlap(rect,other)*2;
      for(const other of actors)if(other!==actor)
        weight+=overlap(rect,{x:other.px-8*scale,y:other.py-23*scale,w:16*scale,h:22*scale});
      if(weight<score){best=rect;score=weight;}
      if(score===0)break;
    }
    const {x,y,w,h}=best;
    if(Math.abs(y-top)>boxH*.5 || Math.abs(x+w/2-cx)>tw*.2){
      c.strokeStyle='rgba(35,64,48,.7)';c.lineWidth=1;c.beginPath();
      c.moveTo(x+w/2,y+h);c.lineTo(cx,top+boxH+1);c.stroke();
    }
    c.fillStyle=actor.local?'#ffe39d':actor.role?'rgba(241,235,200,.94)':'rgba(27,60,54,.88)';
    roundRect(c,x,y,w,h,3);c.fill();
    if(actor.local){c.strokeStyle='#745b30';c.lineWidth=1;c.stroke();}
    c.fillStyle=actor.local||actor.role?'#283f36':'#fff8df';
    c.fillText(title,x+w/2-(actor.observing?(textSize+3)/2:0),y+h/2+.5);
    if(actor.observing){
      const sx=x+w-gap-textSize,sy=y+h*.5;
      c.strokeStyle='#bce8c3';c.lineWidth=Math.max(1,textSize*.12);c.beginPath();
      for(const offset of [.25,.76]){c.moveTo(sx+textSize*(offset+.19),sy+1);c.arc(sx+textSize*offset,sy+1,textSize*.19,0,Math.PI*2);}
      c.moveTo(sx+textSize*.31,sy-2);c.lineTo(sx+textSize*.68,sy-2);c.stroke();
    }
    placed.push(best);
  }
}
const contexts=new WeakMap();
export function renderWorld(canvas,{area,player,students=[],time=0}) {
  if(!areas[area]||!player)return;
  const width=Math.round(canvas.clientWidth||640),height=Math.round(canvas.clientHeight||480);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const pw=Math.round(width*dpr),ph=Math.round(height*dpr);
  if(canvas.width!==pw || canvas.height!==ph) {canvas.width=pw;canvas.height=ph;}
  let c=contexts.get(canvas);if(!c){c=canvas.getContext('2d',{alpha:false});contexts.set(canvas,c);}
  c.setTransform(pw/width,0,0,ph/height,0,0);c.imageSmoothingEnabled=false;
  const rows=height>width?17.4:20.9;
  const scale=Math.max(0.65,Math.min(height/(rows*T),width/(14*T)));
  const worldW=width/scale/T,worldH=height/scale/T;
  const center=(p,view)=>view>=20?10:Math.max(view/2-.5,Math.min(20-view/2+.5,p+.5));
  const ox=Math.round(width/2-center(player.x,worldW)*T*scale);
  const oy=Math.round(height/2-center(player.y,worldH)*T*scale);
  c.fillStyle='#5d9e64';c.fillRect(0,0,width,height);
  const bg=background(area);c.drawImage(bg,ox-margin*T*scale,oy-margin*T*scale,bg.width*scale,bg.height*scale);
  const list=[...students.filter(s=>(!s.area||s.area===area)&&Number.isFinite(s.x)&&Number.isFinite(s.y)),{...player,local:true}];
  for(const lm of areas[area].landmarks) if(lm.kind==='doctor'||lm.kind==='ranger')list.push({...lm,direction:'down',role:lm.kind});
  const actors=[];
  for(const s of list){
    const pt=visiblePoint(s,scale,ox,oy);
    if(pt.x<0||pt.y<0||pt.x>width||pt.y>height+16)continue;
    actors.push({...s,px:pt.x,py:pt.y});
  }
  actors.sort((a,b)=>a.y-b.y||Number(a.local)-Number(b.local));
  for(const s of actors) {
    const moving=(s.x%1!==0 || s.y%1!==0 || s.walking);
    const frame=moving?1+(Math.floor(time/105)%2):0;
    const sprite=avatar(s.appearance||0,s.direction,frame,s.role);
    const x=Math.round(s.px-11*scale),y=Math.round(s.py-25*scale);
    c.drawImage(sprite,x,y,22*scale,27*scale);
    if(s.local){
      c.fillStyle='#6d622c';c.beginPath();c.moveTo(s.px-4*scale,y-1);c.lineTo(s.px+4*scale,y-1);c.lineTo(s.px,y+3*scale);c.closePath();c.fill();
      c.fillStyle='#ffe484';c.beginPath();c.moveTo(s.px-3*scale,y-1);c.lineTo(s.px+3*scale,y-1);c.lineTo(s.px,y+2*scale);c.closePath();c.fill();
    }
  }
  drawNames(c,actors,{width,height,scale});
}

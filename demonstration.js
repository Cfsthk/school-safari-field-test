import {students} from './students.js';

// Demonstration routes are map tiles. All art is read by the native renderer.
const paths = {"hoenn-0-16":[[2,2,1,0,1],[15,2,-1,0,1],[2,17,0,-1,0],[17,15,0,-1,0],[18,8,1,0,0],[2,8,1,0,0],[10,17,0,1,0],[9,5,0,-1,0],[4,13,1,0,0],[14,11,-1,0,1],[14,6,0,-1,0],[7,8,0,-1,0],[4,5,1,0,1],[7,2,-1,0,0],[6,16,0,1,0],[11,14,-1,0,0],[11,2,1,0,0],[18,12,-1,0,0],[17,5,0,1,1],[4,10,0,-1,0],[1,14,1,0,1],[14,14,0,1,1],[8,14,0,1,0],[10,8,0,-1,0],[1,5,1,0,0],[12,4,-1,0,1],[17,10,0,1,0],[15,8,0,-1,0],[12,10,1,0,1]],"hoenn-0-9":[[2,2,1,0,0],[18,4,-1,0,0],[1,10,0,1,0],[1,17,0,-1,0],[9,7,1,0,0],[18,11,-1,0,0],[17,17,0,-1,0]],"hoenn-0-10":[[15,2,-1,0,0],[2,6,0,1,0],[18,11,0,-1,0],[10,9,0,-1,0],[2,13,1,0,0],[17,17,-1,0,0],[7,2,0,1,0]]};

export function demonstration(area,time) {
  return (paths[area] || []).map(([x,y,dx,dy,grass],i)=>{
    const phase=(Math.floor(time/2100)+i*7)%10;
    const moving=phase>=4 && phase<=7;
    const peer=students[i+1];
    return {...peer,id:'demo-'+peer.slot,area,x:x+(moving?dx:0),y:y+(moving?dy:0),
      facing:dx?(dx>0===moving?'right':'left'):(dy>0===moving?'down':'up'),observing:!!grass && phase<=2};
  });
}

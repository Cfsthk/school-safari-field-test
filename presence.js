// Invitation-only prototype. The room creator assigns seats. The relay transports
// encrypted, unretained overworld updates; it never receives the invite key.
import './vendor/paho-mqtt-1.1.0.min.js';

const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const utf8 = new TextEncoder();
const decode = new TextDecoder();
const nativeArea = /^(?:offmap|hoenn-\d{1,2}-\d{1,3})$/;
const FACINGS = new Set(['up', 'down', 'left', 'right']);
const ROOM_KEY = 'safari-room-owner-v1';
const ROOM_PATTERN = /^[a-f0-9]{32}$/;
const MAX_STUDENTS = 30;
const LEASE_MS = 25_000;
const CONNECTION_TIMEOUT = 12_000;
const PULSE_MS = 3500;
const DEFAULT_STATE = { area: 'offmap', x: 0, y: 0, facing: 'down', observing: false };

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function displayText(text, max) {
  if (typeof text !== 'string') return '';
  return [...text.slice(0, 100).normalize('NFC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/gu, ' ').trim()].slice(0,max).join('');
}

function validState(s) {
  if (!s || typeof s.area !== 'string' || !nativeArea.test(s.area) || !FACINGS.has(s.facing)) return null;
  if (![s.x,s.y].every(n => Number.isInteger(n) && n >= 0 && n < 256)) return null;
  return { area:s.area, x:s.x, y:s.y, facing:s.facing, observing:s.observing === true,
    className:displayText(s.className,8), name:displayText(s.name,12),
    look:Number.isInteger(s.look) && s.look>=0 && s.look<239 ? s.look : null };
}

function validSlot(s) { return Number.isInteger(s) && s >= 0 && s < MAX_STUDENTS; }
function validMember(m) {
  const state = validState(m);
  return state && typeof m.id === 'string' && /^(host|[a-f0-9]{32})$/.test(m.id) && validSlot(m.slot)
    ? { id:m.id, slot:m.slot, ...state } : null;
}

function roomFrom(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (ROOM_PATTERN.test(input)) return input;
  try {
    const url = new URL(input, location.href);
    const code = new URLSearchParams(url.hash.slice(1)).get('room');
    return ROOM_PATTERN.test(code || '') ? code : null;
  } catch { return null; }
}

const MESSAGES = {
  offline: '單機試玩',
  connecting: '正連接考察室…',
  waiting: '考察室已開放，等候同學加入。',
  connected: '已與同學連線。',
  reconnecting: '連線中斷，正重新連接…',
  unavailable: '暫未能連線，可繼續單機探索。請確認房主仍開啟遊戲。',
  full: '這間考察室已滿。',
};

async function roomKeys(code) {
  const secret = Uint8Array.from(code.match(/../g), pair => parseInt(pair,16));
  const material = await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey','deriveBits']);
  const algorithm = info => ({name:'HKDF',hash:'SHA-256',salt:utf8.encode('school-safari/native-v1'),info:utf8.encode(info)});
  const key = await crypto.subtle.deriveKey(algorithm('messages'),material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const channel = new Uint8Array(await crypto.subtle.deriveBits(algorithm('channel'),material,128));
  const topic = 'school-safari/native-v1/'+Array.from(channel,b=>b.toString(16).padStart(2,'0')).join('');
  return {key,topic};
}

async function pack(key, topic, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algo = {name:'AES-GCM',iv,additionalData:utf8.encode(topic)};
  const cipher = new Uint8Array(await crypto.subtle.encrypt(algo,key,utf8.encode(JSON.stringify(data))));
  const packet = new Uint8Array(12+cipher.length);
  packet.set(iv); packet.set(cipher,12);
  return packet;
}

async function unpack(key, topic, packet) {
  if (packet.byteLength < 29 || packet.byteLength > 32_768) return null;
  const algo = {name:'AES-GCM',iv:packet.slice(0,12),additionalData:utf8.encode(topic)};
  const data = await crypto.subtle.decrypt(algo,key,packet.slice(12));
  return JSON.parse(decode.decode(data));
}

export function createPresence({onStatus=()=>{},onSlot=()=>{},onPeers=()=>{},initialState,preferredSlot=0}={}) {
  let position = validState(initialState) || {...DEFAULT_STATE};
  let desiredSlot = validSlot(preferredSlot) ? preferredSlot : 0;
  let active = null;
  let statusKind;

  function status(kind) {
    if (kind === statusKind) return;
    statusKind = kind;
    onStatus({kind, detail:MESSAGES[kind]});
  }
  function show(r) { onPeers([...r.members.values()].filter(m=>m.id !== r.self)); }
  function hostStatus(r) { status(r.members.size > 1 ? 'connected' : 'waiting'); }
  function write(r, data) {
    if (!r.online || !r.client?.isConnected()) return Promise.resolve();
    const client = r.client;
    const destination = r.topic + (r.host ? '/down' : '/up');
    const message = {...data, from:r.wire, who:r.self, seq:++r.sequence};
    // Keep encrypted writes in their original order even if WebCrypto resolves out of order.
    const payload = pack(r.key,destination,message);
    r.writes = r.writes.then(async () => {
      const bytes = await payload;
      if (client.isConnected()) client.send(destination,bytes,0,false);
    }).catch(()=>{});
    return r.writes;
  }
  function beacon(r) { return write(r,{type:'beacon'}); }
  function snapshot(r) { return write(r,{type:'snapshot',fields:[...r.members.values()]}); }
  function expire(r,id) {
    const m = r.members.get(id);
    if (!m || id === 'host') return;
    r.leases.set(id,{slot:m.slot,until:Date.now()+LEASE_MS});
    r.heard.delete(id);
    r.instances.delete(id);
    r.members.delete(id);
    r.pending.delete(id);
    show(r);
    snapshot(r);
    hostStatus(r);
  }
  function joinMember(r,m) {
    const state = validState(m.state);
    if (!state) return;
    const id = m.who;
    const now = Date.now();
    let slot = r.members.get(id)?.slot;
    if (!validSlot(slot)) {
      const used = new Set([...r.members.values()].map(p=>p.slot));
      for (const [owner,lease] of r.leases) {
        if (lease.until <= now) r.leases.delete(owner);
        else if (owner !== id) used.add(lease.slot);
      }
      const wanted = r.leases.get(id)?.slot ?? m.preferred;
      slot = validSlot(wanted) && !used.has(wanted) ? wanted : 0;
      while (used.has(slot)) slot++;
      if (slot >= MAX_STUDENTS) { write(r,{type:'full',to:id}); return; }
    }
    r.leases.delete(id);
    r.members.set(id,{id,slot,...state});
    r.instances.set(id,m.from);
    r.heard.set(id,now);
    snapshot(r);
    show(r);
    hostStatus(r);
  }

  function asHost(r,m) {
    // The first public test used the connection identifier as its seat ID.
    if (m.who === undefined) m.who=m.from;
    if (typeof m.who !== 'string' || !ROOM_PATTERN.test(m.who)) return;
    if (m.type === 'find') { beacon(r); return; }
    if (m.epoch !== r.wire) return;
    if (m.type === 'join') { joinMember(r,m); return; }
    const member = r.members.get(m.who);
    if (!member || r.instances.get(m.who) !== m.from) return;
    if (m.type === 'bye') { expire(r,m.who); return; }
    const state = validState(m.state);
    if (m.type !== 'move' || !state) return;
    r.heard.set(m.who,Date.now());
    Object.assign(member,state);
    r.pending.set(member.id,member);
  }
  function requestSeat(r) {
    if (!r.epoch) return write(r,{type:'find'});
    return write(r,{type:'join',epoch:r.epoch,preferred:desiredSlot,state:position});
  }
  function asGuest(r,m) {
    if (m.type === 'beacon') {
      if (r.epoch !== m.from) {
        r.epoch = m.from;
        r.ready = false;
        r.members.clear();
        show(r);
      }
      if (!r.ready && !r.full) requestSeat(r);
      return;
    }
    if (m.from !== r.epoch) return;
    if (m.type === 'end') {
      r.epoch = null; r.ready = false; r.members.clear(); show(r); status('reconnecting'); return;
    }
    r.lastHost = Date.now();
    if (m.type === 'full' && m.to === r.self) {
      r.full = true; status('full'); return;
    }
    if (m.type !== 'snapshot' && (m.type !== 'patch' || !r.ready)) return;
    if (!Array.isArray(m.fields) || m.fields.length > MAX_STUDENTS) return;
    const fields = m.fields.map(validMember).filter(Boolean);
    if (m.type === 'snapshot') {
      let self = fields.find(p=>p.id === r.self);
      if (!self) {
        const legacySeat = fields.find(p=>p.id === r.wire);
        if (legacySeat) { r.self=r.wire; self=legacySeat; }
      }
      if (!self || !fields.some(p=>p.id==='host')) {
        if (r.ready) { r.ready=false; r.members.clear(); show(r); status('reconnecting'); requestSeat(r); }
        return;
      }
      r.members.clear();
      const notifySlot = !r.ready || self.slot !== desiredSlot;
      desiredSlot = self.slot;
      r.ready = true;
      if (notifySlot) onSlot(desiredSlot);
      status('connected');
    }
    for (const member of fields) r.members.set(member.id,member);
    show(r);
  }

  function disconnected(r) {
    if (active !== r) return;
    r.online = false; r.ready=false; r.connecting=false; r.epoch=null;
    if (r.host) {
      for (const member of r.members.values()) if (member.id !== 'host') {
        r.leases.set(member.id,{slot:member.slot,until:Date.now()+LEASE_MS});
      }
      r.members.clear();
      r.members.set('host',{id:'host',slot:desiredSlot,...position});
      r.heard.clear(); r.pending.clear(); r.instances.clear();
    } else r.members.clear();
    show(r);
    r.retryAt = Date.now() + 2500;
    status(Date.now()-r.lastHost >= CONNECTION_TIMEOUT ? 'unavailable' : 'reconnecting');
  }
  function connect(r) {
    if (active !== r || !r.key || r.connecting) return;
    r.connecting = true;
    const client = r.client = new window.Paho.Client(BROKER, 'safari-'+randomCode());
    const incoming = r.topic + (r.host ? '/up' : '/down');
    const live = () => active === r && r.client === client;
    const failed = () => { if (live()) disconnected(r); };
    client.onConnectionLost = failed;
    client.onMessageArrived = packet => {
      if (!live() || !r.online || packet.destinationName !== incoming || packet.retained) return;
      const received = unpack(r.key,incoming,packet.payloadBytes).catch(()=>null);
      r.reads = r.reads.then(async () => {
        const m = await received;
        if (!live() || !m || !ROOM_PATTERN.test(m.from || '') || !Number.isSafeInteger(m.seq)) return;
        if (m.seq <= (r.seen.get(m.from) || 0)) return;
        r.seen.set(m.from,m.seq);
        if (r.host) asHost(r,m); else asGuest(r,m);
      }).catch(()=>{});
    };
    client.connect({useSSL:true,cleanSession:true,mqttVersion:4,timeout:8,keepAliveInterval:15,
      onFailure:failed, onSuccess:() => {
        if (!live()) { client.disconnect(); return; }
        client.subscribe(incoming,{qos:0,timeout:8,onFailure:() => { client.disconnect(); failed(); },
          onSuccess:() => {
            if (!live()) return;
            r.online = true; r.connecting = false;
            if (r.host) { r.lastHost=Date.now(); hostStatus(r); beacon(r); }
            else requestSeat(r);
          }});
      }});
  }

  function tick(r) {
    if (active !== r || r.full) return;
    const now = Date.now();
    if (!r.online) {
      if (now-r.lastHost > CONNECTION_TIMEOUT) status('unavailable');
      if (now >= r.retryAt && !r.connecting) connect(r);
      return;
    }
    if (r.host && r.pending.size) {
      write(r,{type:'patch',fields:[...r.pending.values()]});
      r.pending.clear(); show(r);
    }
    if (!r.host && r.ready && now-r.lastHost > CONNECTION_TIMEOUT) {
      r.ready=false; r.epoch=null; r.members.clear(); show(r); status('reconnecting');
    }
    if (!r.host && !r.ready && now-r.lastHost > CONNECTION_TIMEOUT) status('unavailable');
    if (now-r.pulse < PULSE_MS) return;
    r.pulse=now;
    if (r.host) {
      for (const [id,time] of r.heard) if (now-time>CONNECTION_TIMEOUT) expire(r,id);
      beacon(r); snapshot(r);
    } else if (r.ready) write(r,{type:'move',epoch:r.epoch,state:position});
    else requestSeat(r);
  }
  function leave() {
    const r = active;
    active = null;
    if (r) {
      clearInterval(r.timer);
      r.unlock?.();
      const note = r.host ? {type:'end'} : {type:'bye',epoch:r.epoch};
      write(r,note).finally(() => {
        if (r.client?.isConnected()) r.client.disconnect();
      });
    }
    onPeers([]);
    status('offline');
  }
  async function run(r) {
    try {
      Object.assign(r,await roomKeys(r.code));
      if (active !== r) return;
      if (r.host) {
        r.members.set('host',{id:'host',slot:desiredSlot,...position});
        onSlot(desiredSlot);
      }
      connect(r);
      r.timer=setInterval(()=>tick(r),160);
    } catch { if (active === r) status('unavailable'); }
  }
  function runGuest(r) {
    // A refresh reclaims this tab's seat. A duplicated tab receives its own ID.
    const key = 'safari-guest-'+r.code;
    let previous;
    try { previous=sessionStorage.getItem(key); } catch { /* private browsing */ }
    const startGuest = id => {
      r.self=id;
      try { sessionStorage.setItem(key,id); } catch { /* memory only */ }
      run(r);
    };
    if (!navigator.locks) { startGuest(r.wire); return; }
    const claim = id => navigator.locks.request('safari-seat-'+r.code+'-'+id,{ifAvailable:true},async lock => {
      if (active !== r) return;
      if (!lock) return claim(randomCode());
      startGuest(id);
      await new Promise(resolve=>{ r.unlock=resolve; });
    });
    claim(ROOM_PATTERN.test(previous || '') ? previous : r.wire).catch(()=>{
      if (active===r) startGuest(r.wire);
    });
  }
  function start(code,host) {
    leave();
    const wire = randomCode(), now=Date.now();
    const r = active = {code, host, wire, self:host?'host':wire, sequence:0,
      members:new Map(),instances:new Map(),heard:new Map(),leases:new Map(),pending:new Map(),seen:new Map(),
      reads:Promise.resolve(),writes:Promise.resolve(),online:false,ready:false,full:false,
      connecting:false,lastHost:now,pulse:now,retryAt:now,epoch:null};
    status('connecting');
    // Duplicating the creator's tab may also duplicate its session storage.
    // A per-origin lock keeps exactly one tab in the creator role.
    if (host && navigator.locks) {
      navigator.locks.request('safari-host-'+code,{ifAvailable:true},async lock=>{
        if (active!==r) return;
        if (!lock) { r.host=false; runGuest(r); return; }
        run(r);
        await new Promise(resolve=>{ r.unlock=resolve; });
      }).catch(()=>{ if (active===r) run(r); });
    } else if (host) run(r);
    else runGuest(r);
  }
  function getInvite() {
    if (!active) return null;
    const url = new URL(location.href); url.hash='room='+active.code; return url.toString();
  }
  function host() {
    const code = randomCode();
    try { sessionStorage.setItem(ROOM_KEY,code); } catch { /* temporary in-memory room */ }
    start(code,true);
    return getInvite();
  }
  function join(input) {
    const code=roomFrom(input);
    if (!code) return false;
    if (active?.code===code && !active.full) return true;
    let owner=false;
    try { owner=sessionStorage.getItem(ROOM_KEY)===code; } catch { /* new guest */ }
    start(code,owner); return true;
  }
  function update(patch) {
    const state=validState({...position,...patch});
    if (!state || Object.keys(state).every(k=>state[k]===position[k])) return;
    position=state;
    const r=active;
    if (r?.host) {
      const m={id:'host',slot:desiredSlot,...position};
      r.members.set('host',m); r.pending.set('host',m);
    } else if (r?.ready) write(r,{type:'move',epoch:r.epoch,state:position});
  }
  return {host,join,leave,update,getInvite};
}

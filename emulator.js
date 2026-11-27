// The browser paints mGBA's 240×160 RGBA framebuffer. Native Emerald owns its
// camera, map, sprites, dialogue, inventory, transitions and sound mix.
const runtimeScript = new URL('./engine/mgba.js', import.meta.url);
const runtimeBinary = new URL('./engine/mgba.wasm', import.meta.url);
const buttons = { a:0, b:1, select:2, start:3, right:4, left:5, up:6, down:7, r:8, l:9 };
const width = 240, height = 160;
const audioCapacity = 4096;
let runtimePromise;
function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = runtimeScript.href;
      script.onload = () => resolve(window.createMgbaModule);
      script.onerror = () => {
        runtimePromise = null;
        script.remove();
        reject(new Error('無法載入遊戲引擎，請檢查網絡後再試。'));
      };
      document.head.append(script);
    });
  }
  return runtimePromise;
}

function toBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

// Addresses are public GBA bus addresses. mGBA's documented fixed-size
// GBASerializedState contains a coherent snapshot of these banks at VBlank.
const banks = {
  2:[0x21000,0x40000], 3:[0x19000,0x8000], 4:[0x400,0x400],
  5:[0x800,0x400], 6:[0x1000,0x18000], 7:[0xc00,0x400]
};

export async function createEmulator({canvas, rom, save, onFrame}) {
  const romBytes = toBytes(rom);
  const factory = await loadRuntime();
  const mod = await factory({locateFile:file => file.endsWith('.wasm') ? runtimeBinary.href : new URL(file, runtimeScript).href});
  mod._mgbawasm_init();
  mod._mgbawasm_set_log_level(0);

  function withBytes(bytes, operation) {
    const ptr = mod._malloc(bytes.length);
    if (!ptr) throw new Error('可用記憶體不足，請關閉其他分頁後再試。');
    try {
      mod.HEAPU8.set(bytes, ptr);
      return operation(ptr, bytes.length);
    } finally {
      mod._free(ptr);
    }
  }
  const loaded = withBytes(romBytes,(ptr,size) => mod._mgbawasm_load(ptr,size,0,0,0,0,1));
  if (!loaded) throw new Error('無法啟動這個遊戲檔。');
  const nativeSize = mod._mgbawasm_state_size();
  if (nativeSize !== 0x61000 || mod._mgbawasm_video_width() !== width || mod._mgbawasm_video_height() !== height) {
    mod._mgbawasm_unload();
    throw new Error('遊戲檔與 GBA 引擎不相容。');
  }
  if (save && !withBytes(toBytes(save),(ptr,n) => mod._mgbawasm_sram_load(ptr,n))) {
    mod._mgbawasm_unload();
    throw new Error('這個存檔未能讀取。');
  }
  const statePtr = mod._malloc(nativeSize);
  const audioPtr = mod._malloc(audioCapacity * 4);
  const fps = mod._mgbawasm_framerate_micro() / 1e6;
  const interval = 1000 / (fps || 59.7275);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d',{alpha:false});
  const image = context.createImageData(width,height);
  let frameNumber = 0, snapshotFrame = -1, snapshot = null;
  let keyMask = 0, request = 0, due = 0, disposed = false;
  let audio = null, nextAudio = 0;
  const playing = new Set();

  function getSnapshot() {
    if (snapshotFrame !== frameNumber || snapshot?.buffer !== mod.HEAPU8.buffer) {
      if (!mod._mgbawasm_state_save(statePtr)) return null;
      snapshot = new DataView(mod.HEAPU8.buffer,statePtr,nativeSize);
      snapshotFrame = frameNumber;
    }
    return snapshot;
  }
  function read(address, length) {
    if (disposed) return 0;
    const bank = address >>> 24;
    if (bank >= 8 && bank < 14) {
      const offset = address & 0x1ffffff;
      if (offset+length > romBytes.length) return 0;
      let result = romBytes[offset];
      if (length >= 2) result |= romBytes[offset+1]<<8;
      if (length === 4) result |= (romBytes[offset+2]<<16) | (romBytes[offset+3]<<24);
      return result >>> 0;
    }
    const layout = banks[bank];
    const offset = address & 0xffffff;
    if (!layout || offset+length > layout[1]) return 0;
    const view = getSnapshot();
    if (!view) return 0;
    const index = layout[0] + offset;
    if (length === 1) return view.getUint8(index);
    if (length === 2) return view.getUint16(index,true);
    return view.getUint32(index,true);
  }

  function playAudio() {
    const frames = mod._mgbawasm_read_audio(audioPtr,audioCapacity);
    if (!frames || !audio || audio.state !== 'running') return;
    if (nextAudio-audio.currentTime > .16) return;
    const rate = mod._mgbawasm_sample_rate();
    const buffer = audio.createBuffer(2,frames,rate);
    const data = mod.HEAP16, start = audioPtr >>> 1;
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i=0;i<frames;i++) {
      left[i]=data[start+i*2]/32768;
      right[i]=data[start+i*2+1]/32768;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.onended = () => { playing.delete(source); source.disconnect(); };
    playing.add(source);
    if (nextAudio < audio.currentTime) nextAudio = audio.currentTime + .035;
    source.start(nextAudio);
    nextAudio += frames/rate;
  }
  function paint() {
    const ptr = mod._mgbawasm_video_ptr();
    image.data.set(mod.HEAPU8.subarray(ptr,ptr+width*height*4));
    context.putImageData(image,0,0);
    onFrame?.(api);
  }
  function tick(now) {
    if (!request || disposed) return;
    // Resynchronise after a background tab or extended stall. This also keeps
    // 120 Hz iPads at the GBA's actual frame rate.
    if (now-due>100) due=now;
    let advanced = false;
    while (now+.3 >= due) {
      mod._mgbawasm_run_frame();
      frameNumber++;
      playAudio();
      advanced=true;
      due += interval;
    }
    if (advanced) paint();
    if (request) request=requestAnimationFrame(tick);
  }
  function pause() {
    if (request) cancelAnimationFrame(request);
    request=0;keyMask=0;
    if (!disposed) mod._mgbawasm_set_keys(0);
    for (const source of playing) source.stop();
    playing.clear();nextAudio=0;
  }
  function setKey(name,down) {
    const index = buttons[String(name).toLowerCase()];
    if (!Number.isInteger(index) || disposed) return;
    keyMask = down ? keyMask | (1<<index) : keyMask & ~(1<<index);
    mod._mgbawasm_set_keys(keyMask);
  }
  function exportSave() {
    if (disposed) return new Uint8Array();
    const size=mod._mgbawasm_sram_save(), ptr=mod._mgbawasm_sram_ptr();
    return size>0 && ptr ? mod.HEAPU8.slice(ptr,ptr+size) : new Uint8Array();
  }
  const api = {
    start() {
      if (request || disposed) return;
      due=performance.now();
      request=requestAnimationFrame(tick);
    },
    pause, setKey, exportSave,
    unlockAudio() {
      if (disposed) return;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      try {
        if (!audio) audio=new Audio();
        if (audio.state!=='running') return audio.resume().catch(()=>{});
      } catch { /* Gameplay is still available with sound disabled by the browser. */ }
    },
    read8:address=>read(address,1), read16:address=>read(address,2), read32:address=>read(address,4),
    dispose() {
      if (disposed) return;
      pause();disposed=true;
      mod._free(statePtr);mod._free(audioPtr);mod._mgbawasm_unload();
      if (audio) audio.close().catch(()=>{});
    }
  };
  return api;
}

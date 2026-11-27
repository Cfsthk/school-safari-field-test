// Native game inputs use the same press/release state for touch and keyboard.
export function createUI({onDirection,onButton,onTools,onFile,onSaveFile,onExport,onAudio} = {}) {
  const get = id => document.getElementById(id);
  const canvas = get('world'), overlay = get('players');
  const pad = get('dpad'), hardware = get('hardware');
  const menuButton = get('menu'), webTools = get('web-tools');
  const portrait = matchMedia('(orientation: portrait)');
  const setupScreen = get('setup');
  const panel = get('dialogue'), buttons = get('choices');
  const linkBlock = get('invite-link'), input = get('room-url');
  const toast = get('toast');
  let active = null, selected = -1, toastHide, nativeMenuOpen = false;
  function notify(text) {
    clearTimeout(toastHide);
    toast.textContent = text;
    toast.hidden = false;
    toastHide = setTimeout(() => { toast.hidden = true; }, 2300);
  }

  function close() {
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    active = null;
    selected = -1;
    panel.hidden = true;
    linkBlock.hidden = true;
    get('profile-form').hidden = true;
    buttons.replaceChildren();
    webTools.hidden = !nativeMenuOpen;
  }

  function pointTo(index, ensureVisible = false) {
    const next = buttons.children[index];
    if (!next || next.disabled) return;
    if (selected !== -1) buttons.children[selected]?.classList.remove('selected');
    selected = index;
    next.classList.add('selected');
    if (ensureVisible) next.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }

  function show(view) {
    releaseAll();
    close();
    const choices = view.choices?.length ? view.choices : [{label: '繼續', run: view.onBack || close}];
    active = {...view, choices};
    get('speaker').textContent = view.title || '';
    get('speaker').hidden = !view.title;
    get('message').textContent = view.text || '';
    get('message').hidden = !view.text;
    choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.textContent = choice.label;
      button.disabled = Boolean(choice.disabled);
      button.addEventListener('focus', () => pointTo(index));
      button.addEventListener('click', () => {
        if (!button.disabled) {
          pointTo(index);
          (choice.run || close)();
        }
      });
      buttons.append(button);
    });
    pointTo(choices.findIndex(choice => !choice.disabled));
    webTools.hidden = true;
    panel.hidden = false;
    panel.querySelector('.dialogue-paper').scrollTop = 0;
  }

  function moveSelection(direction) {
    const len = active.choices.length;
    if (!len) return;
    const delta = direction === 'up' || direction === 'left' ? -1 : 1;
    const columns = len > 1 && buttons.children[0].offsetTop === buttons.children[1].offsetTop ? 2 : 1;
    let index = selected;
    if (columns === 2 && (direction === 'up' || direction === 'down')) {
      index += delta * columns;
      if (index < 0 || index >= len) {
        index = selected % columns;
        if (direction === 'up') while (index + columns < len) index += columns;
      }
    } else {
      index = (selected + delta + len) % len;
    }
    for (let n = 0; n < len; n++) {
      if (!active.choices[index].disabled) { pointTo(index, true); return; }
      index = (index + delta + len) % len;
    }
  }

  function back() {
    const handler = active?.onBack;
    close();
    handler?.();
  }

  function menu() {
    releaseAll();
    if (active) back();
    else tapNative('Start');
  }

  function setStartMenuOpen(startMenu) {
    if (nativeMenuOpen !== startMenu) {
      nativeMenuOpen = startMenu;
      webTools.hidden = !startMenu || Boolean(active);
      menuButton.setAttribute('aria-expanded',String(startMenu));
    }
  }

  function resumeField() {
    close();
    if (nativeMenuOpen) tapNative('B');
  }

  function ready() {
    setupScreen.hidden = true;
    hardware.hidden = false;
    get('load-status').hidden = true;
  }

  function setup(text = '') {
    releaseAll();
    setStartMenuOpen(false);
    close();
    hardware.hidden = true;
    setupScreen.hidden = false;
    get('load-status').textContent = text;
    get('load-status').hidden = !text;
  }

  function filePicker(id) {
    releaseAll();
    const picker = get(id);
    picker.value = '';
    picker.click();
  }
  const pickROM = () => filePicker('rom-file');
  const pickSave = () => filePicker('save-file');
  const exportSave = () => onExport?.();

  // iOS can suspend audio again after returning from another application.
  function audioGesture() {
    try { Promise.resolve(onAudio?.()).catch(() => {}); } catch { /* silent mode remains playable */ }
  }
  document.addEventListener('pointerdown', audioGesture, {capture:true, passive:true});
  document.addEventListener('keydown', audioGesture, {capture:true, passive:true});
  get('choose-rom').addEventListener('click',pickROM);
  for (const [id,callback] of [['rom-file',onFile],['save-file',onSaveFile]]) {
    get(id).addEventListener('change',e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) callback?.(file);
    });
  }

  const held = new Map();
  const nativeDown = new Map();
  const padTouches = new Set();
  const elements = new Map([...hardware.querySelectorAll('[data-dir],[data-key]')]
    .map(el=>[el.dataset.dir || el.dataset.key, el]));
  const directions = new Set(['left','right','up','down']);
  function dispatch(code,pressed) {
    if (directions.has(code)) onDirection?.(code,pressed);
    else onButton?.(code,pressed);
  }
  function endNative(code) {
    const entry = nativeDown.get(code);
    if (!entry) return;
    clearTimeout(entry.timer);
    nativeDown.delete(code);
    elements.get(code)?.classList.remove('held');
    dispatch(code,false);
  }
  function release(id,force = false) {
    const code = held.get(id);
    if (!code) return;
    held.delete(id);
    if ([...held.values()].includes(code)) return;
    const entry = nativeDown.get(code);
    if (!entry) { elements.get(code)?.classList.remove('held'); return; }
    // A tap shorter than a GBA video frame must still register.
    const delay = force ? 0 : Math.max(0,34 - (performance.now() - entry.at));
    if (delay) entry.timer = setTimeout(()=>endNative(code),delay);
    else endNative(code);
  }
  function press(id,code) {
    if (held.get(id) === code) return;
    release(id,true);
    if (!code || hardware.hidden) return;
    held.set(id,code);
    elements.get(code)?.classList.add('held');
    if (active) {
      if (directions.has(code)) moveSelection(code);
      else if (code === 'B') back();
      else if (code === 'A' && selected >= 0) buttons.children[selected]?.click();
      return;
    }
    const old = nativeDown.get(code);
    if (old) {
      clearTimeout(old.timer);
      old.at = performance.now();
      return;
    }
    nativeDown.set(code,{at:performance.now()});
    dispatch(code,true);
  }
  function releaseAll() {
    padTouches.clear();
    held.clear();
    for (const code of nativeDown.keys()) endNative(code);
    for (const el of elements.values()) el.classList.remove('held');
  }
  function tapNative(code) {
    press('menu-tap',code);
    release('menu-tap');
  }
  function padDirection(e) {
    const r=pad.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    // The whole game screen turns clockwise in portrait. Slide gestures stay
    // aligned with the arrows painted on it.
    const dx=portrait.matches ? y : x, dy=portrait.matches ? -x : y;
    const edge=Math.max(Math.abs(dx),Math.abs(dy));
    if (edge<.12 || edge>.62) return null;
    return Math.abs(dx)>Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up');
  }
  pad.addEventListener('pointerdown',e=>{
    if(e.button!==0) return;
    e.preventDefault();pad.setPointerCapture(e.pointerId);padTouches.add(e.pointerId);
    press(e.pointerId,padDirection(e));
  });
  pad.addEventListener('pointermove',e=>{ if(padTouches.has(e.pointerId))press(e.pointerId,padDirection(e)); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    pad.addEventListener(type,e=>{padTouches.delete(e.pointerId);release(e.pointerId,type==='pointercancel');});
  }
  for (const [code,el] of elements) {
    if (!directions.has(code)) {
      el.addEventListener('pointerdown',e=>{
        if(e.button!==0)return;
        e.preventDefault();el.setPointerCapture(e.pointerId);press(e.pointerId,code);
      });
      for (const type of ['pointerup','pointercancel','lostpointercapture']) {
        el.addEventListener(type,e=>release(e.pointerId,type==='pointercancel'));
      }
    }
    // Keyboard and accessibility APIs can activate the button without pointer events.
    el.addEventListener('click',e=>{if(e.detail===0){press('accessible',code);release('accessible');}});
  }
  menuButton.addEventListener('click',menu);
  webTools.addEventListener('click',()=>{ if(nativeMenuOpen && !active)onTools?.(); });
  portrait.addEventListener('change',releaseAll);
  window.addEventListener('blur',releaseAll);
  window.addEventListener('pagehide',releaseAll);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
  const keyCodes={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',
    KeyA:'A',KeyZ:'A',Space:'A',KeyB:'B',KeyX:'B',Escape:'B',Enter:'Start',ShiftLeft:'Select',ShiftRight:'Select'};
  document.addEventListener('keydown',e=>{
    if (hardware.hidden || e.ctrlKey||e.metaKey||e.altKey||e.target.closest?.('input, textarea, select, [contenteditable="true"]'))return;
    if (e.code==='KeyM'){e.preventDefault();if(!e.repeat)menu();return;}
    if (e.target.closest?.('button') && (e.code==='Enter'||e.code==='Space'))return;
    const code=active && e.code==='Enter' ? 'A' : keyCodes[e.code];
    if (!code)return;
    e.preventDefault();
    if(!e.repeat)press(e.code,code);
    else if(active && directions.has(code))moveSelection(code);
  });
  document.addEventListener('keyup',e=>release(e.code));
  document.addEventListener('contextmenu',e=>{if(e.target.closest?.('.hardware,canvas'))e.preventDefault();});
  function invite(url, onBack) {
    const href = new URL(url, window.location.href).href;
    const selectLink = () => {
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(href);
        notify('已複製邀請連結');
      } catch {
        selectLink();
        try { if (document.execCommand('copy')) { notify('已複製邀請連結'); return; } } catch {}
        notify('長按已選取的連結即可複製');
      }
    };
    const options = [];
    if (navigator.share) options.push({label:'分享邀請連結', run:async () => {
      try { await navigator.share({title:'世界動物尋蹤', url:href}); }
      catch (err) { if (err.name !== 'AbortError') selectLink(); }
    }});
    options.push({label:'複製連結',run:copy}, {label:'返回',run:onBack || close});
    show({title:'邀請同學',text:'請同學用另一部 iPad 開啟這條連結，加入同一個考察區。',choices:options,onBack});
    input.value = href;
    linkBlock.hidden = false;
  }
  input.addEventListener('click', () => input.select());

  const identityForm = get('profile-form');
  const classInput = get('student-class');
  const nameInput = get('student-name');
  let saveProfile;
  identityForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!identityForm.hidden) saveProfile?.();
  });
  classInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); nameInput.focus(); }
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveProfile?.(); }
  });
  for (const field of [classInput,nameInput]) field.addEventListener('input', () => field.setCustomValidity(''));

  function profile(current, onSave, onBack) {
    function save() {
      if (identityForm.hidden) return;
      const className = classInput.value.trim();
      const name = nameInput.value.trim();
      classInput.setCustomValidity(className ? '' : '請填寫班別。');
      nameInput.setCustomValidity(name ? '' : '請填寫姓名。');
      if (!identityForm.reportValidity()) return;
      close();
      onSave?.({className, name});
    }
    show({title:'學生資料',text:'這個班別和姓名會顯示在角色上方。',
      choices:[{label:'儲存',run:save}, {label:'返回',run:back}], onBack});
    classInput.value = current.className || '';
    nameInput.value = current.name || '';
    classInput.setCustomValidity('');
    nameInput.setCustomValidity('');
    identityForm.hidden = false;
    saveProfile = save;
  }

  return {canvas,overlay,ready,setup,setStartMenuOpen,resumeField,pickROM,pickSave,exportSave,notify,show,close,
    isOpen:()=> Boolean(active),invite,profile};
}

// Controls shared by touch, keyboard and assistive-technology button activation.
export function createUI({onDirection, onA, onB, onMenu}) {
  const get = id => document.getElementById(id);
  const canvas = get('world');
  const pad = get('dpad');
  const directionButtons = [...pad.querySelectorAll('button')];
  const panel = get('dialogue');
  const buttons = get('choices');
  const linkBlock = get('invite-link');
  const input = get('room-url');
  const bannerElement = get('area-banner');
  const toast = get('toast');
  const heldDirections = new Map();
  const touches = new Set();
  let active = null;
  let selected = -1;
  let bannerExit;
  let bannerHide;
  let toastHide;

  function banner(name) {
    clearTimeout(bannerExit);
    clearTimeout(bannerHide);
    get('area-name').textContent = name;
    bannerElement.classList.remove('exit');
    bannerElement.hidden = false;
    bannerExit = setTimeout(() => {
      bannerElement.classList.add('exit');
      bannerHide = setTimeout(() => { bannerElement.hidden = true; }, 240);
    }, 1800);
  }

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
    const image = get('wildlife');
    if (view.image) {
      image.src = view.image;
      image.alt = view.imageAlt || '';
      image.hidden = false;
    } else {
      image.hidden = true;
      image.removeAttribute('src');
    }
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
    if (!active) return onB?.();
    const handler = active.onBack;
    close();
    handler?.();
  }

  function confirm() {
    if (!active) return onA?.();
    if (selected >= 0) buttons.children[selected]?.click();
  }

  function menu() {
    // Let the current interaction apply its own cancel rules (e.g. an encounter).
    if (active) back();
    else onMenu?.();
  }

  function updateHeld() {
    const held = new Set(heldDirections.values());
    for (const button of directionButtons) button.classList.toggle('held', held.has(button.dataset.dir));
  }

  function release(id) {
    const old = heldDirections.get(id);
    if (!old) return;
    heldDirections.delete(id);
    if (!active && ![...heldDirections.values()].includes(old)) onDirection?.(old, false);
    updateHeld();
  }

  function press(id, dir) {
    if (heldDirections.get(id) === dir) return;
    release(id);
    if (!dir) return;
    const alreadyHeld = [...heldDirections.values()].includes(dir);
    heldDirections.set(id, dir);
    updateHeld();
    if (active) moveSelection(dir);
    else if (!alreadyHeld) onDirection?.(dir, true);
  }

  function releaseAll() {
    touches.clear();
    for (const id of [...heldDirections.keys()]) release(id);
    get('a-button').classList.remove('held');
    get('b-button').classList.remove('held');
  }

  function padDirection(e) {
    const rect = pad.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width - .5;
    const dy = (e.clientY - rect.top) / rect.height - .5;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < .12 || Math.max(Math.abs(dx), Math.abs(dy)) > .62) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }

  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    touches.add(e.pointerId);
    press(e.pointerId, padDirection(e));
  });
  pad.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) press(e.pointerId, padDirection(e));
  });
  function releaseTouch(e) {
    touches.delete(e.pointerId);
    release(e.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, releaseTouch);
  // Browsers synthesize detail=0 clicks for keyboard and VoiceOver.
  for (const button of directionButtons) button.addEventListener('click', e => {
    if (e.detail === 0) {
      press('accessible', button.dataset.dir);
      release('accessible');
    }
  });
  get('a-button').addEventListener('click', confirm);
  get('b-button').addEventListener('click', back);
  get('menu').addEventListener('click', menu);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  const keys = {ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right'};
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Element) || e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (keys[e.key]) {
      e.preventDefault();
      if (!e.repeat) press(e.code, keys[e.key]);
      else if (active) moveSelection(keys[e.key]);
      return;
    }
    const key = e.key.toLowerCase();
    const nativeButton = e.target.closest('button');
    if (nativeButton && (key === 'enter' || key === ' ')) return;
    if (!['a','z',' ','enter','b','x','escape','m'].includes(key)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (key === 'm') menu();
    else if (key === 'b' || key === 'x' || key === 'escape') {
      get('b-button').classList.add('held'); back();
    } else {
      get('a-button').classList.add('held'); confirm();
    }
  });
  document.addEventListener('keyup', e => {
    if (keys[e.key]) release(e.code);
    get('a-button').classList.remove('held');
    get('b-button').classList.remove('held');
  });
  document.addEventListener('contextmenu', e => { if (e.target.closest('.dpad, .action-keys, canvas')) e.preventDefault(); });

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

  return {canvas, banner, notify, show, close, isOpen: () => Boolean(active), invite, profile};
}

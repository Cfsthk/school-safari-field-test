import {animals} from './animals.js';

export const berries = [
  ['甜莓', 1], ['酸莓', 2], ['草莓', 128]
];
const lookup = Object.fromEntries(animals.map(animal => [animal.id, animal]));
export const getAnimal = id => lookup[id];
export function freshResearch() {
  return {hp:10, coins:0, basket:[3, 2, 2], pad:2, journal:{}, encounter:null};
}
export function recordFor(state, id) {
  return state.journal[id] ??= {seen:false, filed:false, level:0, filedLevel:0};
}
export function startEncounter(state, random = Math.random, now = Date.now()) {
  if (state.encounter) return;
  const minute = Math.floor(now / 60000) % 90;
  const phase = minute < 22 ? 0 : minute < 50 ? 1 : minute < 65 ? 2 : 3;
  const weights = animals.map(a => (6 - a.stars) * (a.phase === phase ? 1.6 : 1));
  let draw = random() * weights.reduce((a,b) => a + b, 0);
  const animal = animals[animals.findIndex((_, i) => (draw -= weights[i]) < 0)] ?? animals.at(-1);
  const entry = recordFor(state, animal.id);
  state.encounter = {id:animal.id, angry:false, attempts:0, first:!entry.seen, initialLevel:entry.level};
  entry.seen = true;
}
export function takeTurn(state, action, index = 0, random = Math.random) {
  const e = state.encounter;
  if (!e) return null;
  const a = lookup[e.id], entry = recordFor(state, e.id);
  let message = '', pad = false, berry = 0;
  const finish = (text, blackout = false) => {
    state.encounter = null;
    return {text, ended:true, blackout, note:!blackout && (e.first || entry.level > e.initialLevel)};
  };
  if (action === 'escape') {
    if (e.attempts >= 2 || random() < (e.angry ? .48 : .78)) return finish('你安全離開了。');
    e.attempts++;
    message = '這次未能撤離。';
  } else if (action === 'observe') {
    if (entry.level < 5) {
      entry.level++;
      message = '對動物的認識提高了！';
    }
  } else if (action === 'berry') {
    if (!state.basket[index] || !berries[index]) return null;
    state.basket[index]--;
    berry = berries[index][1];
    message = a.favourites & berry ? '牠喜歡這種莓果！' : a.curiosity & berry ? '牠好奇地靠近莓果，仔細端詳。' : '牠看了看莓果，沒有走近。';
  } else if (action === 'pad') {
    if (state.pad <= 0) return null;
    state.pad--;
    pad = true;
    message = '你用上了護墊。';
  } else return null;
  if (entry.level === 5) return finish(message + '你已達最大熟悉度，動物離開了。');
  const tier = a.stars - 1;
  let attack = 24 + 6 * tier + Math.floor(a.risk * (9 - tier) / 15);
  let flee = 28 + 3 * tier - Math.floor(a.risk / 7);
  if (!e.angry && berry) {
    if (a.favourites & berry) { attack /= 4; flee /= 4; }
    else if (a.favourites) attack *= .7;
    else if (a.curiosity & berry) flee /= 2;
  }
  const roll = random() * 100;
  if (roll < flee) return finish(message + '牠跑遠了。');
  if (e.angry || roll < flee + attack) {
    message += e.angry ? '牠持續攻擊！' : '牠開始攻擊了！';
    e.angry = true;
    state.hp = Math.max(0, state.hp - (pad ? Math.max(1, Math.ceil(a.damage / 2)) : a.damage));
    if (!state.hp) {
      for (const [id, r] of Object.entries(state.journal)) {
        if (!r.filed) delete state.journal[id];
        else { r.seen = true; r.level = r.filedLevel; }
      }
      state.hp = 10;
      return finish('你暈倒了。你在古辰鎮醒來，體力已恢復。尚未上報的發現已遺失。', true);
    }
  } else message += '牠留在原處。';
  return {text:message, ended:false};
}
export function report(state) {
  let first = 0, updates = 0, coins = 0;
  for (const r of Object.values(state.journal)) {
    if (!r.seen) continue;
    if (!r.filed) { first++; coins += 6; }
    else if (r.level > r.filedLevel) updates++;
    coins += 3 * (r.level - r.filedLevel);
    r.filed = true;
    r.filedLevel = r.level;
  }
  state.coins += coins;
  return {first, updates, coins};
}

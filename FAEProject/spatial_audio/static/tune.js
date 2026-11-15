/* Tune for my ears: a 30-second pointing game.
   Short noise bursts are played from different directions with each effect strength (Subtle, Clear, Dramatic).
   You click where each one came from; the setting with the smallest average miss is chosen for you.
   Every head hears slightly differently, so the best setting differs from person to person. */
const Tune = (() => {
  const STORE = 'roundtable.tune.v1';
  const ANGLES = [0, 45, 90, 135, 180, -135, -90, -45];
  const NAMES = { 0: 'Front', 45: 'Front right', 90: 'Right', 135: 'Back right', 180: 'Back', '-135': 'Back left', '-90': 'Left', '-45': 'Front left' };
  const SETTINGS = ['natural', 'enhanced', 'immersive'];
  const LABEL = { natural: 'Subtle', enhanced: 'Clear', immersive: 'Dramatic' };
  const wrap = a => ((a + 540) % 360) - 180;
  const rand = n => Math.floor(Math.random() * n);
  const shuffle = a => { a = [...a]; for (let k = a.length - 1; k > 0; k--) { const j = rand(k + 1); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  let dlg = null, trials = [], index = 0, answers = [], previousHead = 0, busy = false;

  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e[k] = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach(c => e.append(c && c.nodeType ? c : document.createTextNode(c ?? '')));
    return e;
  }
  const mount = (...kids) => dlg.replaceChildren(...kids);
  const closeButton = () => h('button', { class: 'lv-ghost', type: 'button', onclick: close }, 'Close');

  function open() {
    dlg = document.querySelector('#tune');
    if (typeof Live !== 'undefined') { Live.stop(); previousHead = Live.head; Live.setHead(0); }
    // The same four directions are tested with every strength, so the only difference is the setting.
    const four = shuffle(ANGLES).slice(0, 4);
    trials = shuffle(SETTINGS.flatMap(setting => four.map(angle => ({ setting, angle })))); index = 0; answers = [];
    intro(); if (!dlg.open) dlg.showModal();
    dlg.onclose = () => { if (typeof Live !== 'undefined') Live.setHead(previousHead); };
  }
  function close() { if (dlg.open) dlg.close(); }

  function intro() {
    mount(h('div', { class: 'eyebrow' }, 'ABOUT 30 SECONDS'), h('h2', { id: 'tune-title' }, 'Tune it for your ears'),
      h('p', {}, 'Everyone hears direction a little differently. A short sound will play from somewhere around you. Click where you think it came from. A guess is fine.'),
      h('ul', { class: 'lt-list' }, h('li', {}, 'Wear headphones and look straight ahead.'), h('li', {}, 'There are 12 short sounds.'), h('li', {}, 'At the end the best setting for you is chosen automatically.')),
      h('div', { class: 'lt-actions' }, h('button', { class: 'primary', type: 'button', onclick: () => trial() }, 'Start'), closeButton()));
  }

  async function play() {
    if (busy) return; busy = true;
    const t = trials[index];
    try { await Live.probe(t.angle, t.setting); } finally { busy = false; }
  }

  function trial() {
    const ring = h('div', { class: 'tune-ring' }, h('div', { class: 'tune-you' }, h('span', {}, '♧'), h('small', {}, 'You')));
    ANGLES.forEach(a => {
      const r = a * Math.PI / 180, label = NAMES[a];
      ring.append(h('button', { class: 'tune-spot', type: 'button', 'aria-label': label, style: `left:calc(50% + ${Math.sin(r) * 112}px);top:calc(50% - ${Math.cos(r) * 112}px)`, onclick: () => answer(a) }, label));
    });
    mount(h('div', { class: 'eyebrow' }, `SOUND ${index + 1} OF ${trials.length}`), h('h2', { id: 'tune-title' }, 'Where did it come from?'), ring,
      h('div', { class: 'lt-actions' }, h('button', { class: 'lv-ghost', type: 'button', onclick: play }, 'Hear it again'), closeButton()),
      h('div', { class: 'lt-progress' }, h('i', { style: `width:${Math.round(100 * index / trials.length)}%` })));
    setTimeout(play, 350);
  }

  function answer(angle) {
    answers.push({ ...trials[index], answer: angle }); index++;
    index < trials.length ? trial() : finish();
  }

  // Average miss (degrees), front/back mix-ups (answer is the mirror image of the target across the ear axis) and exact hits per setting.
  function score(rows) {
    const stats = {};
    for (const s of SETTINGS) {
      const r = rows.filter(x => x.setting === s);
      stats[s] = {
        miss: r.reduce((sum, x) => sum + Math.abs(wrap(x.angle - x.answer)), 0) / Math.max(1, r.length),
        flips: r.filter(x => Math.abs(x.angle) !== 90 && Math.abs(wrap(x.answer - wrap(180 - x.angle))) < 1).length,
        exact: r.filter(x => x.angle === x.answer).length, n: r.length
      };
    }
    const order = [...SETTINGS].sort((a, b) => stats[a].miss - stats[b].miss || stats[a].flips - stats[b].flips);
    const similar = stats[order[1]].miss - stats[order[0]].miss < 8;
    return { stats, best: order[0], similar, choice: similar ? 'enhanced' : order[0] };
  }

  function finish() {
    const { stats, similar, choice } = score(answers);
    if (typeof Live !== 'undefined') Live.setFx(choice);
    try { const all = JSON.parse(localStorage.getItem(STORE) || '[]'); all.push({ time: new Date().toISOString(), stats, choice }); localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {}
    mount(h('div', { class: 'eyebrow' }, 'DONE'), h('h2', { id: 'tune-title' }, similar ? 'All three worked about equally for you' : `${LABEL[choice]} works best for you`),
      h('p', {}, similar ? 'Clear is a good everyday choice and has been selected.' : `${LABEL[choice]} has been selected. You can change it any time under More controls.`),
      h('table', { class: 'lt-table' }, h('thead', {}, h('tr', {}, ['Strength', 'Average miss', 'Front/back mix-ups', 'Exactly right'].map(x => h('th', {}, x)))),
        h('tbody', {}, SETTINGS.map(s => h('tr', { class: s === choice ? 'best' : '' }, h('td', {}, LABEL[s] + (s === choice ? ' ✓' : '')), h('td', {}, Math.round(stats[s].miss) + '°'), h('td', {}, `${stats[s].flips} of ${stats[s].n}`), h('td', {}, `${stats[s].exact} of ${stats[s].n}`))))),
      h('p', { class: 'lv-status' }, 'Only 4 sounds per setting, so this is a quick guide, not a medical test.'),
      h('div', { class: 'lt-actions' }, h('button', { class: 'primary', type: 'button', onclick: close }, 'Done'), h('button', { class: 'lv-ghost', type: 'button', onclick: open }, 'Try again')));
  }

  return { open, score };
})();

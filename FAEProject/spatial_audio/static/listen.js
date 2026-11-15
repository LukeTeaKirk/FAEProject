/* Listening test: does spatial separation help you pick out one voice among three?
   Coordinate-response-measure style: three voices speak at once, each saying "<Name>, go to <colour> <number>".
   The volunteer is told whose message to follow and reports the colour and number.
   Conditions (blind to the volunteer): mono (all voices at the centre) vs spatial (voices at -60, 0, +60 degrees, HRTF).
   Both conditions are loudness-matched. Results stay on this computer (localStorage) and can be exported as CSV. */
const Listen = (() => {
  const STORE = 'roundtable.sessions.v1', RATE = 48000, TARGET_RMS = .05, PER_CONDITION = 6, SEATS = [-60, 0, 60];
  const SWATCH = { red: '#d9534f', blue: '#3b6fd4', green: '#3f9b5f', white: '#f6f6f0' };
  const NUMBER_LABEL = { one: '1', three: '3', five: '5', seven: '7' };
  let man = null, actx = null, root = null, session = null, index = 0;
  const cache = new Map();
  const rand = n => Math.floor(Math.random() * n);
  const shuffle = a => { a = [...a]; for (let k = a.length - 1; k > 0; k--) { const j = rand(k + 1); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const stored = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { return []; } };
  const store = list => { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) {} };
  const mount = (...kids) => root.replaceChildren(...kids);

  // Small DOM helper: text is always added as text nodes, never as HTML.
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e[k] = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach(c => e.append(c && c.nodeType ? c : document.createTextNode(c ?? '')));
    return e;
  }

  // ---- trial design --------------------------------------------------------------------------
  function makeTrial(cond, practice) {
    const ids = shuffle(Object.keys(man.people)).slice(0, 3), colors = shuffle(man.colors).slice(0, 3), nums = shuffle(man.numbers).slice(0, 3), seats = shuffle(SEATS);
    const voices = ids.map((id, k) => ({ id, color: colors[k], number: nums[k], angle: cond === 'spatial' ? seats[k] : 0 }));
    return { cond, practice, voices, target: voices[rand(3)] };
  }
  const makePlan = () => [...['spatial', 'mono'].map(c => makeTrial(c, true)),
    ...shuffle([...Array(PER_CONDITION).fill('mono'), ...Array(PER_CONDITION).fill('spatial')]).map(c => makeTrial(c, false))];

  async function clip(c, v) {
    const url = `/static/voices/crm_${v.id}_${v.color}_${v.number}.wav`;
    if (!cache.has(url)) { const r = await fetch(url); if (!r.ok) throw new Error('Missing voice file ' + url); cache.set(url, await c.decodeAudioData(await r.arrayBuffer())); }
    return cache.get(url);
  }
  async function render(t) {
    const o = new OfflineAudioContext(2, Math.round(RATE * 2.4), RATE);
    for (const v of t.voices) {
      const src = o.createBufferSource(); src.buffer = await clip(o, v); let tail = src;
      if (t.cond === 'spatial') {
        const p = o.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0;
        const a = v.angle * Math.PI / 180; p.positionX.value = 1.5 * Math.sin(a); p.positionY.value = 0; p.positionZ.value = -1.5 * Math.cos(a);
        src.connect(p); tail = p;
      }
      tail.connect(o.destination); src.start(0);
    }
    const out = await o.startRendering(); let sum = 0, count = 0, peak = 0;
    for (let ch = 0; ch < 2; ch++) for (const x of out.getChannelData(ch)) { sum += x * x; count++; if (Math.abs(x) > peak) peak = Math.abs(x); }
    const k = Math.min(TARGET_RMS / Math.sqrt(sum / count), .95 / peak);   // equal loudness for mono and spatial
    for (let ch = 0; ch < 2; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= k; }
    return out;
  }

  // ---- statistics and export -------------------------------------------------------------------
  function stats(trials) {
    const out = {};
    for (const cond of ['mono', 'spatial']) {
      const t = trials.filter(x => !x.practice && x.cond === cond);
      out[cond] = { n: t.length, both: pct(t.filter(x => x.colorOk && x.numberOk).length, t.length), color: pct(t.filter(x => x.colorOk).length, t.length),
        number: pct(t.filter(x => x.numberOk).length, t.length), rt: t.length ? t.reduce((s, x) => s + x.rtMs, 0) / t.length / 1000 : 0 };
    }
    return out;
  }
  function csv() {
    const rows = [['volunteer', 'session_time', 'trial', 'practice', 'condition', 'target', 'target_seat_deg', 'correct_color', 'correct_number', 'answer_color', 'answer_number', 'color_ok', 'number_ok', 'rt_ms']];
    stored().forEach(s => s.trials.forEach((t, i) => rows.push([s.label, s.time, i + 1, t.practice, t.cond, t.target, t.targetAngle, t.color, t.number, t.respColor, t.respNumber, t.colorOk, t.numberOk, Math.round(t.rtMs)])));
    return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  }
  function download() {
    const a = h('a', { href: URL.createObjectURL(new Blob([csv()], { type: 'text/csv' })), download: 'roundtable-listening-test.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  // ---- screens ---------------------------------------------------------------------------------
  function dataPanel() {
    const all = stored(), diff = all.map(s => { const x = stats(s.trials); return x.spatial.both - x.mono.both; });
    const mean = diff.length ? diff.reduce((a, b) => a + b, 0) / diff.length : 0;
    return h('div', { class: 'panel lt-card' },
      h('div', { class: 'eyebrow' }, 'SAVED ON THIS COMPUTER'),
      h('h2', {}, `${all.length} volunteer${all.length === 1 ? '' : 's'} tested`),
      all.length ? h('p', {}, `Average across volunteers: spatial minus mono = ${mean >= 0 ? '+' : ''}${mean.toFixed(0)} percentage points of fully correct answers (colour and number). Small samples are only indicative.`)
        : h('p', {}, 'No data yet. Run the test with classmates and the results will be collected here.'),
      all.length ? h('table', { class: 'lt-table' }, h('thead', {}, h('tr', {}, ['Volunteer', 'Mono', 'Spatial', 'Difference'].map(x => h('th', {}, x)))),
        h('tbody', {}, all.map((s, i) => { const x = stats(s.trials); return h('tr', {}, h('td', {}, s.label), h('td', {}, x.mono.both + '%'), h('td', {}, x.spatial.both + '%'), h('td', {}, (diff[i] >= 0 ? '+' : '') + diff[i])); }))) : '',
      h('div', { class: 'lt-actions' },
        h('button', { class: 'lv-ghost', onclick: download, disabled: !all.length }, 'Download CSV'),
        h('button', { class: 'lv-ghost', onclick: () => { if (confirm('Delete all saved listening-test data on this computer?')) { store([]); setup(); } }, disabled: !all.length }, 'Clear data')));
  }

  function setup() {
    const name = h('input', { id: 'lt-name', type: 'text', placeholder: 'Volunteer name or code', 'aria-label': 'Volunteer name or code', maxlength: 40 });
    const start = h('button', { class: 'primary', onclick: () => begin(name.value.trim() || 'Volunteer ' + (stored().length + 1)).catch(e => alert('Could not start: ' + e.message)) }, 'Start test');
    mount(h('div', { class: 'panel lt-card' },
      h('div', { class: 'eyebrow' }, 'BEFORE YOU START'), h('h2', {}, 'A 3-minute listening test'),
      h('p', {}, 'Three people speak at once. Each says “Name, go to colour number”. You are told whose message to follow, then you choose the colour and number that person said.'),
      h('ul', { class: 'lt-list' }, h('li', {}, 'Use headphones in a quiet room.'), h('li', {}, 'Each clip plays once, so listen carefully.'), h('li', {}, '14 short trials: 2 for practice, then 12 that count.'), h('li', {}, 'Guessing is fine. By chance you would get 25% right for each of colour and number.')),
      h('div', { class: 'lt-actions' }, name, h('button', { class: 'lv-ghost', onclick: () => Live.headphoneCheck && Live.headphoneCheck() }, 'Headphone check'), start)), dataPanel());
  }

  async function begin(label) {
    if (!man) man = await (await fetch('/static/voices/manifest.json')).json();
    if (!actx) actx = new AudioContext({ sampleRate: RATE });
    await actx.resume();
    session = { label, time: new Date().toISOString(), trials: [] }; session.plan = makePlan(); index = 0; showTrial();
  }

  function showTrial() {
    const t = session.plan[index], real = session.plan.filter(x => !x.practice), number = t.practice ? index + 1 : index - 1;
    const prepared = render(t); let chosenColor = null, chosenNumber = null, endedAt = 0;
    const title = t.practice ? `Practice ${number} of 2` : `Trial ${number} of ${real.length}`;
    const submit = h('button', { class: 'primary', disabled: true, onclick: () => {
      const rec = { practice: t.practice, cond: t.cond, target: t.target.id, targetAngle: t.target.angle, color: t.target.color, number: t.target.number,
        respColor: chosenColor, respNumber: chosenNumber, colorOk: chosenColor === t.target.color, numberOk: chosenNumber === t.target.number, rtMs: performance.now() - endedAt };
      session.trials.push(rec); index++; index < session.plan.length ? showTrial() : finish();
    } }, 'Submit answer');
    const check = () => { submit.disabled = !(chosenColor && chosenNumber); };
    const pick = (group, value, btn, set) => { group.querySelectorAll('button').forEach(b => b.classList.remove('on')); btn.classList.add('on'); set(value); check(); };
    const colorBtns = h('div', { class: 'lt-choices' }), numberBtns = h('div', { class: 'lt-choices' });
    man.colors.forEach(c => { const b = h('button', { class: 'lt-choice', 'aria-label': c, onclick: () => pick(colorBtns, c, b, v => chosenColor = v) }, h('i', { style: `background:${SWATCH[c]}` }), c); colorBtns.append(b); });
    man.numbers.forEach(n => { const b = h('button', { class: 'lt-choice', 'aria-label': NUMBER_LABEL[n], onclick: () => pick(numberBtns, n, b, v => chosenNumber = v) }, NUMBER_LABEL[n]); numberBtns.append(b); });
    const answer = h('div', { class: 'lt-answer', hidden: true }, h('p', { class: 'lt-q' }, `What did ${man.people[t.target.id].name} say?`),
      h('div', { class: 'lt-row' }, h('span', {}, 'Colour'), colorBtns), h('div', { class: 'lt-row' }, h('span', {}, 'Number'), numberBtns), submit);
    const play = h('button', { class: 'primary', disabled: true, onclick: () => {
      play.disabled = true; play.textContent = 'Playing…';
      prepared.then(buf => { const s = actx.createBufferSource(); s.buffer = buf; s.connect(actx.destination);
        s.onended = () => { endedAt = performance.now(); play.textContent = 'Played'; answer.hidden = false; }; s.start(); });
    } }, 'Preparing…');
    prepared.then(() => { play.disabled = false; play.textContent = '▶  Play once'; }).catch(e => { play.textContent = 'Error: ' + e.message; });
    mount(h('div', { class: 'panel lt-card' }, h('div', { class: 'eyebrow' }, title),
      h('h2', {}, 'Listen for ', h('span', { class: 'lt-name' }, man.people[t.target.id].name)),
      h('p', {}, 'Three voices will speak at once. Follow the one that says this name.'), h('div', { class: 'lt-actions' }, play), answer,
      h('div', { class: 'lt-progress' }, h('i', { style: `width:${Math.round(100 * index / session.plan.length)}%` }))));
  }

  function finish() {
    const all = stored(); all.push({ label: session.label, time: session.time, trials: session.trials }); store(all);
    const x = stats(session.trials), bar = (label, v, cls) => h('div', { class: 'lt-bar' }, h('span', {}, label), h('div', {}, h('i', { class: cls, style: `width:${v}%` })), h('b', {}, v + '%'));
    mount(h('div', { class: 'panel lt-card' }, h('div', { class: 'eyebrow' }, 'YOUR RESULT'), h('h2', {}, `Thank you, ${session.label}`),
      h('p', {}, 'Fully correct answers (colour and number both right). Chance level is about 6%.'),
      bar('Mono', x.mono.both, 'mono'), bar('Spatial', x.spatial.both, 'spatial'),
      h('table', { class: 'lt-table' }, h('thead', {}, h('tr', {}, ['', 'Colour right', 'Number right', 'Both right', 'Average time'].map(c => h('th', {}, c)))),
        h('tbody', {}, ['mono', 'spatial'].map(c => h('tr', {}, h('td', {}, c === 'mono' ? 'Mono' : 'Spatial'), h('td', {}, x[c].color + '%'), h('td', {}, x[c].number + '%'), h('td', {}, x[c].both + '%'), h('td', {}, x[c].rt.toFixed(1) + ' s'))))),
      h('div', { class: 'lt-actions' }, h('button', { class: 'primary', onclick: setup }, 'Next volunteer'), h('button', { class: 'lv-ghost', onclick: download }, 'Download CSV'))), dataPanel());
  }

  document.addEventListener('DOMContentLoaded', () => { root = document.querySelector('#lt-root'); if (root) setup(); });
  return { stats, makePlan, render, csv };
})();

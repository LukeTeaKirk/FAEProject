/* Live studio: real-time spatial audio in the browser.
   - Web Audio API PannerNode with the HRTF panning model (gives left/right AND front/back cues)
   - changes are heard instantly (no rebuild), including seat moves, volume, mute and mode
   - focus mode (+5 dB for one voice, -5 dB for the rest), speaking highlight, level meters
   - mono vs spatial loudness matching, presets, keyboard seat control, saved settings, self-test
   Shares the state declared in app.js (people, selected, spatial, source, focusId, files, draw, invalidate). */
const Live = (() => {
  const RATE = 48000, DIST = 1.5, SEATS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180], STORE = 'roundtable.settings.v1';
  const PRESETS = { round: [-60, 0, 60, 120], row: [-60, -30, 30, 60], wide: [-120, -60, 60, 120], surround: [-90, 0, 90, 180] };
  // Spatial effect strength: how much the rear is dulled/softened, and how much room sound is added.
  const FX = {
    natural:   { cut: 20000, rear: 1,   wet: .75, rt60: .45 },
    enhanced:  { cut: 5500,  rear: .85, wet: 1.0, rt60: .65 },
    immersive: { cut: 3200,  rear: .65, wet: 1.3, rt60: .95 }
  };
  let ctx = null, graph = null, playing = false, raf = 0, timer = 0, monoComp = 1, fx = 'enhanced', head = 0;
  const orbit = { on: false, id: null, a0: 0, t0: 0, angle: 0, raf: 0 };
  const cache = new Map();
  const $ = s => document.querySelector(s);
  const dB = v => 20 * Math.log10(Math.max(v, 1e-6));
  const mixGain = p => p.muted ? 0 : p.volume * (focusId ? (focusId === p.id ? 1.8 : .55) : 1);
  const pos = a => [DIST * Math.sin(a * Math.PI / 180), 0, -DIST * Math.cos(a * Math.PI / 180)];
  const wrap = a => ((a + 540) % 360) - 180;
  const angleOf = p => orbit.on && orbit.id === p.id ? orbit.angle : p.angle;
  // 0 for sources in front or at the sides, 1 for a source directly behind the listener's head.
  const rearness = a => Math.max(0, -Math.cos(wrap(a - head) * Math.PI / 180));
  const cutoff = a => 20000 * Math.pow(FX[fx].cut / 20000, rearness(a));
  const rearGain = a => 1 - (1 - FX[fx].rear) * rearness(a);
  const gainFor = p => mixGain(p) * rearGain(angleOf(p));

  // Listener orientation: when the head turns, the room stays still and every voice moves relative to you.
  function orient(c, smooth) {
    const l = c.listener, h = head * Math.PI / 180, fxv = Math.sin(h), fzv = -Math.cos(h);
    if (l.forwardX) {
      const t = c.currentTime;
      for (const [p, v] of [[l.forwardX, fxv], [l.forwardY, 0], [l.forwardZ, fzv], [l.upX, 0], [l.upY, 1], [l.upZ, 0]]) { if (smooth) p.setTargetAtTime(v, t, .03); else p.value = v; }
    } else l.setOrientation(fxv, 0, fzv, 0, 1, 0);
  }

  // Synthetic room: a handful of early wall reflections plus a dense tail that decays and darkens over time.
  // Adding this "space" is what lets voices sound outside the head instead of inside it.
  function roomIR(c, rt60) {
    const key = `ir:${rt60}:${c.sampleRate}`; if (cache.has(key)) return cache.get(key);
    const rate = c.sampleRate, n = Math.floor(rate * Math.min(2.4, rt60 * 1.7)), b = c.createBuffer(2, n, rate);
    const early = [[[.009, .14], [.014, -.12], [.021, .10], [.029, -.09], [.038, .07], [.052, -.06]], [[.011, -.13], [.017, .12], [.024, -.10], [.033, .08], [.041, -.07], [.057, .06]]];
    let s = 20260101; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0, energy = 0;
      for (let i = 0; i < n; i++) { const t = i / rate, k = .08 + .8 * Math.exp(-t * 5); lp += (rnd() - lp) * k; d[i] = lp * Math.exp(-6.91 * t / rt60) * Math.min(1, t / .012); energy += d[i] * d[i]; }
      const norm = 1 / Math.sqrt(energy);
      for (let i = 0; i < n; i++) d[i] *= norm;
      early[ch].forEach(([t, a]) => { const i = Math.floor(t * rate); if (i < n) d[i] += a; });
    }
    cache.set(key, b); return b;
  }

  // Same pulsed test tones as the Python renderer (audio.py: test_tone).
  function toneBuffer(c, index, seconds = 5) {
    const n = RATE * seconds, buffer = c.createBuffer(1, n, RATE), d = buffer.getChannelData(0);
    const f = [220, 277.18, 329.63, 440, 523.25, 659.25, 783.99, 880][index % 8];
    for (let i = 0; i < n; i++) {
      const t = i / RATE, phase = (((t - index * .55) % 2.5) + 2.5) % 2.5;
      const env = phase < .8 ? Math.sin(Math.PI * Math.min(phase / .8, 1)) ** 2 : 0;
      d[i] = .28 * env * (Math.sin(2 * Math.PI * f * t) + .2 * Math.sin(4 * Math.PI * f * t));
    }
    return buffer;
  }

  async function bufferFor(c, p, i) {
    if (files.has(p.id)) {
      const f = files.get(p.id), k = `file:${f.name}:${f.size}:${f.lastModified}`;
      if (!cache.has(k)) cache.set(k, await c.decodeAudioData(await f.arrayBuffer()));
      return cache.get(k);
    }
    if (source === 'speech') {
      const url = `/static/voices/chat_${p.id}.wav`;
      if (!cache.has(url)) {
        const r = await fetch(url);
        cache.set(url, r.ok ? await c.decodeAudioData(await r.arrayBuffer()) : null);
      }
      if (cache.get(url)) return cache.get(url);
    }
    const k = `tone:${i}`;
    if (!cache.has(k)) cache.set(k, toneBuffer(c, i));
    return cache.get(k);
  }

  const spec = c => Promise.all(people.map(async (p, i) => ({ id: p.id, angle: angleOf(p), gain: gainFor(p), buf: await bufferFor(c, p, i) })));

  // One graph builder serves the live context and the offline calibration and self-test renders.
  function build(c, dest, list, spatialMode, live) {
    orient(c);
    const bus = c.createGain();
    bus.channelCount = 2; bus.channelCountMode = 'explicit'; bus.channelInterpretation = 'speakers';   // mono sources feed both ears equally
    bus.gain.value = spatialMode ? 1 : monoComp;
    bus.connect(dest);
    let room = null;
    if (spatialMode) {
      room = c.createConvolver(); room.buffer = roomIR(c, FX[fx].rt60);
      const wet = c.createGain(); wet.gain.value = FX[fx].wet; room.connect(wet); wet.connect(bus);
    }
    const nodes = list.map(s => {
      const src = c.createBufferSource(); src.buffer = s.buf; src.loop = true;
      const g = c.createGain(); g.gain.value = s.gain; src.connect(g);
      let pan = null, lp = null, tail = g;
      if (spatialMode) {
        lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .5; lp.frequency.value = cutoff(s.angle); g.connect(lp);   // sources behind the head sound duller
        pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1; pan.rolloffFactor = 0;
        const [x, y, z] = pos(s.angle); pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
        lp.connect(pan); lp.connect(room); tail = pan;   // direct sound is directional; the room sound is diffuse
      }
      let ana = null;
      if (live) { ana = c.createAnalyser(); ana.fftSize = 1024; g.connect(ana); }
      tail.connect(bus); src.start(0);
      return { id: s.id, src, g, lp, pan, ana };
    });
    return { nodes, bus };
  }

  // Push the current angles, head turn and gains to the running graph.
  function applyParams() {
    if (!graph || !ctx) return;
    const t = ctx.currentTime;
    people.forEach(p => {
      const n = graph.nodes.find(x => x.id === p.id); if (!n) return;
      const a = angleOf(p);
      n.g.gain.setTargetAtTime(gainFor(p), t, .04);
      if (n.pan) {
        const [x, y, z] = pos(a);
        n.pan.positionX.setTargetAtTime(x, t, .05); n.pan.positionY.setTargetAtTime(y, t, .05); n.pan.positionZ.setTargetAtTime(z, t, .05);
        n.lp.frequency.setTargetAtTime(cutoff(a), t, .05);
      }
    });
  }

  function setHead(v) {
    head = Math.max(-180, Math.min(180, Number(v) || 0));
    const slider = $('#head-turn'); if (slider) slider.value = head;
    const out = $('#head-val'); if (out) out.textContent = head + '°';
    const icon = document.querySelector('.listener'); if (icon) icon.style.transform = `rotate(${head}deg)`;
    if (ctx) orient(ctx, true);
    applyParams();
  }

  // "8D" demo: the selected voice circles around the listener once every 8 seconds.
  function setOrbit(on) {
    orbit.on = on; cancelAnimationFrame(orbit.raf);
    const dot = document.querySelector('.orbit-dot'), btn = $('#orbit-toggle');
    if (btn) btn.textContent = on ? '■  Stop orbit' : '▶  8D orbit';
    if (on) {
      const me = people.find(p => p.id === selected); orbit.id = me.id; orbit.a0 = me.angle; orbit.t0 = performance.now();
      if (dot) dot.hidden = false;
      const step = () => {
        if (!orbit.on) return;
        orbit.angle = wrap(orbit.a0 + (performance.now() - orbit.t0) / 8000 * 360);
        applyParams();
        if (dot) dot.style.transform = `translate(${Math.sin(orbit.angle * Math.PI / 180) * 133}px, ${-Math.cos(orbit.angle * Math.PI / 180) * 133}px)`;
        orbit.raf = requestAnimationFrame(step);
      };
      step();
      status(`Orbit: ${me.name} circles around you. Listen for the voice passing in front, to the sides and behind you.`);
    } else { if (dot) dot.hidden = true; applyParams(); }
  }

  // Mono and spatial renders would otherwise differ in loudness, which biases any comparison.
  // Render both offline and scale the mono path so their RMS matches.
  async function calibrate() {
    const list = await spec(ctx), length = RATE * 4;
    const rms = async mode => {
      const o = new OfflineAudioContext(2, length, RATE);
      build(o, o.destination, list, mode, false);
      const out = await o.startRendering(); let s = 0;
      for (let ch = 0; ch < 2; ch++) for (const v of out.getChannelData(ch)) s += v * v;
      return Math.sqrt(s / (2 * length));
    };
    const [spatialRms, monoRms] = await Promise.all([rms(true), rms(false)]);
    monoComp = monoRms > 1e-6 ? Math.min(4, spatialRms / monoRms) : 1;
    if (graph && !graph.spatial) graph.bus.gain.setTargetAtTime(monoComp, ctx.currentTime, .05);
  }
  const scheduleCalibration = () => { clearTimeout(timer); timer = setTimeout(() => playing && calibrate(), 400); };
  const keyOf = () => JSON.stringify([spatial, source, fx, [...files].map(([k, f]) => k + f.name + f.size)]);

  async function start() {
    if (!ctx) ctx = new AudioContext({ sampleRate: RATE });
    await ctx.resume(); stop(true);
    status('Loading voices…');
    const list = await spec(ctx);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .003; limiter.release.value = .1;
    const master = ctx.createGain(); master.gain.value = .9;
    master.connect(limiter); limiter.connect(ctx.destination);
    const split = ctx.createChannelSplitter(2), L = ctx.createAnalyser(), R = ctx.createAnalyser();
    L.fftSize = R.fftSize = 1024; master.connect(split); split.connect(L, 0); split.connect(R, 1);
    const built = build(ctx, master, list, spatial, true);
    graph = { ...built, master, L, R, spatial, key: keyOf() };
    playing = true; ui();
    status(spatial ? 'Playing live · spatial (HRTF). Click a seat or press ← → to move the selected person.' : 'Playing live · mono (same signal in both ears).');
    loop(); await calibrate();
  }

  function stop(keepContext) {
    cancelAnimationFrame(raf);
    if (graph) { graph.nodes.forEach(n => { try { n.src.stop(); } catch (e) {} }); try { graph.master.disconnect(); } catch (e) {} }
    graph = null; playing = false; ui();
    if (!keepContext && orbit.on) setOrbit(false);
    document.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    ['#out-l', '#out-r'].forEach(s => { const b = $(s + ' i'); if (b) b.style.transform = 'scaleX(0)'; });
    if (!keepContext) status('Stopped.');
  }

  function loop() {
    if (!graph) return;
    const buf = new Float32Array(1024);
    const level = a => { a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
    graph.nodes.forEach(n => {
      const v = level(n.ana);
      document.querySelectorAll(`[data-id="${n.id}"]`).forEach(el => { if (!el.classList.contains('meter')) el.classList.toggle('speaking', v > .01); });
      const bar = document.querySelector(`.meter[data-id="${n.id}"] i`);
      if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (dB(v) + 60) / 60))})`;
    });
    const l = level(graph.L), r = level(graph.R);
    [['#out-l', l], ['#out-r', r]].forEach(([s, v]) => { $(s + ' i').style.transform = `scaleX(${Math.max(0, Math.min(1, (dB(v) + 60) / 60))})`; $(s + ' b').textContent = v > 1e-4 ? dB(v).toFixed(0) + ' dB' : '-∞'; });
    $('#out-diff').textContent = l > 1e-4 && r > 1e-4 ? `Left ear vs right ear: ${(dB(l) - dB(r)).toFixed(1)} dB` : 'Left ear vs right ear: –';
    raf = requestAnimationFrame(loop);
  }

  function sync() {
    save();
    if (!playing || !graph) return;
    if (graph.key !== keyOf()) { clearTimeout(timer); timer = setTimeout(() => { if (playing) start(); }, 120); return; }
    applyParams();
    scheduleCalibration();
  }

  function status(text) { const e = $('#live-status'); if (e) e.textContent = text; }
  function ui() {
    const b = $('#live-toggle'); if (!b) return;
    b.textContent = playing ? '■  Stop live' : '▶  Play live'; b.classList.toggle('stop', playing); b.setAttribute('aria-pressed', String(playing));
  }

  async function headphoneCheck() {
    if (!ctx) ctx = new AudioContext({ sampleRate: RATE });
    await ctx.resume();
    const beep = (pan, when) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
      o.frequency.value = 440; p.pan.value = pan; g.gain.setValueAtTime(0, ctx.currentTime + when);
      g.gain.linearRampToValueAtTime(.2, ctx.currentTime + when + .03); g.gain.linearRampToValueAtTime(0, ctx.currentTime + when + .5);
      o.connect(g); g.connect(p); p.connect(ctx.destination); o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + .55);
    };
    beep(-1, 0); beep(1, .8);
    status('You should hear a beep in your LEFT ear, then one in your RIGHT ear. If not, check your headphones.');
  }

  // ---- saved settings, presets, keyboard -----------------------------------------------------
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ people: people.map(p => ({ id: p.id, angle: p.angle, volume: p.volume, muted: p.muted })), spatial, source, focusId, fx })); } catch (e) {}
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!s) return;
      s.people.forEach(x => { const p = people.find(q => q.id === x.id); if (p) Object.assign(p, { angle: x.angle, volume: x.volume, muted: x.muted }); });
      fx = FX[s.fx] ? s.fx : 'enhanced'; $('#fx-select').value = fx;
      source = s.source === 'speech' ? 'speech' : 'tones'; focusId = people.some(p => p.id === s.focusId) ? s.focusId : null;
      if (s.spatial === false) document.querySelector('[data-mode="mono"]').click();
      $('#source-select').value = source; draw();
    } catch (e) {}
  }
  function applyPreset(name) { PRESETS[name].forEach((a, i) => { if (people[i]) people[i].angle = a; }); invalidate(); draw(); }
  function moveSelected(step) {
    const me = people.find(p => p.id === selected); let i = SEATS.indexOf(me.angle);
    for (let k = 0; k < SEATS.length; k++) {
      i = (i + step + SEATS.length) % SEATS.length;
      if (!people.some(p => p !== me && p.angle === SEATS[i])) { me.angle = SEATS[i]; invalidate(); draw(); return; }
    }
  }

  // ---- self-test: verifies the spatial engine with measurements ------------------------------
  async function selfTest() {
    const render = async (angle, impulse) => {
      const n = Math.round(RATE * .5), o = new OfflineAudioContext(2, n, RATE), b = o.createBuffer(1, n, RATE), d = b.getChannelData(0);
      if (impulse) d[100] = .9; else { let s = 12345; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296 * 2 - 1) * .5; } }
      const src = o.createBufferSource(); src.buffer = b; const p = o.createPanner(); p.panningModel = 'HRTF'; p.rolloffFactor = 0;
      const [x, y, z] = pos(angle); p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      src.connect(p); p.connect(o.destination); src.start(); const out = await o.startRendering();
      return [out.getChannelData(0), out.getChannelData(1)];
    };
    const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const hf = a => rms(a.map((v, i) => v - (a[i - 1] || 0)));
    const ild = async a => { const [l, r] = await render(a, false); return dB(rms(l)) - dB(rms(r)); };
    const peakAt = a => a.reduce((best, v, i) => Math.abs(v) > Math.abs(a[best]) ? i : best, 0);
    const results = [];
    const left = await ild(-90), right = await ild(90), center = await ild(0), m60 = await ild(-60), p60 = await ild(60);
    results.push(['Source at −90° is louder in the left ear', `${left.toFixed(1)} dB`, left > 3]);
    results.push(['Source at +90° is louder in the right ear', `${(-right).toFixed(1)} dB`, right < -3]);
    results.push(['Source straight ahead is balanced', `${center.toFixed(1)} dB`, Math.abs(center) < 1.5]);
    results.push(['−60° and +60° mirror each other', `${(m60 + p60).toFixed(1)} dB error`, Math.abs(m60 + p60) < 1.5]);
    const [il, ir] = await render(-90, true), lag = (peakAt(ir) - peakAt(il)) / RATE * 1000;
    results.push(['Interaural time difference at −90° (real heads: up to ~0.7 ms)', `${lag.toFixed(2)} ms`, lag > .2 && lag < 1]);
    const [fl, fr] = await render(0, false), [bl, br] = await render(180, false);
    const fb = (dB(hf(fl)) + dB(hf(fr))) / 2 - (dB(hf(bl)) + dB(hf(br))) / 2;
    results.push(['Front and back sound different (high-frequency energy)', `${fb.toFixed(1)} dB`, Math.abs(fb) > 1]);
    // System-level checks: the full chain with rear cue, room and head turn.
    const sys = async (angle, o = {}) => {
      const sf = fx, sh = head; fx = o.fx || 'enhanced'; head = o.head || 0;
      const n = Math.round(RATE * (o.len || .6)), ctx2 = new OfflineAudioContext(2, n, RATE), b = ctx2.createBuffer(1, n, RATE), d = b.getChannelData(0);
      if (o.impulse) d[100] = .9; else { let s = 12345; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296 * 2 - 1) * .5; } }
      try { build(ctx2, ctx2.destination, [{ id: 't', angle, gain: rearGain(angle), buf: b }], true, false); } finally { fx = sf; head = sh; }
      const out = await ctx2.startRendering(); return [out.getChannelData(0), out.getChannelData(1)];
    };
    const ildOf = ([l, r]) => dB(rms(l)) - dB(rms(r));
    const turned0 = ildOf(await sys(90, { fx: 'natural' })), turned90 = ildOf(await sys(90, { fx: 'natural', head: 90 }));
    results.push(['Head turn: a source at +90° is off to the right with head forward', `${(-turned0).toFixed(1)} dB`, turned0 < -3]);
    results.push(['Head turn: after turning 90° right it is straight ahead (balanced)', `${turned90.toFixed(1)} dB`, Math.abs(turned90) < 2]);
    const [frontL, frontR] = await sys(0), [backL, backR] = await sys(180);
    const rearCue = (dB(hf(frontL)) + dB(hf(frontR))) / 2 - (dB(hf(backL)) + dB(hf(backR))) / 2;
    results.push(['Enhanced mode: sound from behind is clearly duller than from the front', `${rearCue.toFixed(1)} dB`, rearCue > 6]);
    const tail = x => { const a = Math.round(RATE * .15), b = Math.round(RATE * .6); return dB(rms(x[0].slice(a, b))); };
    const tn = tail(await sys(0, { fx: 'natural', impulse: true, len: 1 })), ti = tail(await sys(0, { fx: 'immersive', impulse: true, len: 1 }));
    results.push(['Room sound: the immersive setting has a longer reverb tail than natural', `${(ti - tn).toFixed(1)} dB`, ti - tn > 2]);
    const drN = await directToReverb('natural'), drE = await directToReverb('enhanced'), drI = await directToReverb('immersive');
    results.push(['Room balance (direct vs room sound): natural is mostly direct', `${drN.toFixed(1)} dB`, drN > 9 && drN < 16]);
    results.push(['Room balance: enhanced keeps the voice well above the room sound', `${drE.toFixed(1)} dB`, drE > 5 && drE < 10]);
    results.push(['Room balance: immersive is roomier but the voice is still louder than the room', `${drI.toFixed(1)} dB`, drI > 1 && drI < 6]);
    return results;
  }
  async function runSelfTest() {
    const out = $('#selftest-out'); out.innerHTML = '<p class="lv-status">Running…</p>';
    try {
      const r = await selfTest();
      out.innerHTML = '<table class="lt-table"><tbody>' + r.map(([n, v, ok]) => `<tr><td>${n}</td><td>${v}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'FAIL'}</td></tr>`).join('') + `</tbody></table><p class="lv-status">${r.filter(x => x[2]).length} of ${r.length} checks passed · browser: ${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] || 'unknown'}</p>`;
    } catch (e) {
      const p = document.createElement('p'); p.className = 'lv-status'; p.textContent = 'Self-test could not run: ' + e.message;
      out.replaceChildren(p);
    }
  }

  // Direct-to-reverberant ratio (dB) of the full chain for a source straight ahead: energy of the direct
  // sound (first 12 ms) against everything after it. Higher = drier and more clearly directional.
  async function directToReverb(name, wet) {
    const saved = { fx, wet: FX[name].wet }; fx = name; if (wet != null) FX[name].wet = wet;
    try {
      const n = Math.round(RATE * 1.4), c = new OfflineAudioContext(2, n, RATE), b = c.createBuffer(1, n, RATE); b.getChannelData(0)[100] = .9;
      build(c, c.destination, [{ id: 't', angle: 0, gain: 1, buf: b }], true, false);
      const out = await c.startRendering(), e = (a, z) => { let s = 0; for (let ch = 0; ch < 2; ch++) { const d = out.getChannelData(ch); for (let i = a; i < z; i++) s += d[i] * d[i]; } return s; };
      const split = 100 + Math.round(RATE * .012);
      return 10 * Math.log10(e(0, split) / Math.max(e(split, n), 1e-20));
    } finally { fx = saved.fx; FX[name].wet = saved.wet; }
  }

  // ---- wiring --------------------------------------------------------------------------------
  function init() {
    $('#live-toggle').onclick = () => playing ? stop() : start().catch(e => status('Could not start audio: ' + e.message));
    $('#headphone-check').onclick = headphoneCheck;
    $('#source-select').onchange = e => { source = e.target.value; invalidate(); draw(); };
    document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => applyPreset(b.dataset.preset));
    $('#selftest').onclick = runSelfTest;
    $('#fx-select').onchange = e => { fx = e.target.value; invalidate(); };
    $('#head-turn').oninput = e => setHead(e.target.value);
    $('#head-reset').onclick = () => setHead(0);
    $('#orbit-toggle').onclick = async () => {
      try { if (!playing) await start(); } catch (e) { status('Could not start audio: ' + e.message); return; }
      setOrbit(!orbit.on);
    };
    const dot = document.createElement('div'); dot.className = 'orbit-dot'; dot.hidden = true; dot.textContent = '♪'; $('#room').append(dot);
    document.addEventListener('keydown', e => {
      if ((e.target.matches && e.target.matches('input,select,textarea')) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ($('#studio').hidden) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelected(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelected(1); }
      else if (e.key === 'q' || e.key === 'Q') setHead(head - 15);
      else if (e.key === 'e' || e.key === 'E') setHead(head + 15);
      else if (e.key === 'f' || e.key === 'F') { focusId = focusId === selected ? null : selected; invalidate(); draw(); }
    });
    document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { if (b.dataset.page !== 'studio' && playing) stop(); }));
    restore();
  }
  document.addEventListener('DOMContentLoaded', init);
  return { sync, stop, start, selfTest, headphoneCheck, directToReverb, get playing() { return playing; } };
})();

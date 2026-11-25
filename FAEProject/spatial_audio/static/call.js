/* Live call: real people in a room, each voice arriving as its own WebRTC audio stream.
   Browsers talk to each other directly. The Flask server (signaling.py) only passes the setup messages.
   Each remote stream becomes a person at the table, and live.js places that voice in space like any other.
   Your own microphone is sent to the others and never played back to you. Everything stays on this network. */
const Call = (() => {
  const $ = s => document.querySelector(s);
  const COLORS = ['#e9d7c2', '#dedec8', '#d5dfeb', '#e9d9dc', '#d9e6d6', '#e6dcef', '#efe3c8'];
  const SEAT_ORDER = [-60, 60, 0, 120, -120, 180, -90, 90, -30, 30, 150, -150];
  // No outside (STUN/TURN) servers: calls work between tabs and computers on the same network.
  // For callers on different networks, add { urls: 'stun:...' } here.
  const ICE = { iceServers: [] };
  const NAME_KEY = 'roundtable.callname';

  let me = null, room = '', run = 0, version = -1;
  let local = null, testCtx = null;
  const peers = new Map();      // id -> { pc, pending, name, state, rtt, audio, stream }
  const names = new Map();      // id -> display name from the room list
  let statsTimer = 0;

  const active = () => !!me;
  const streamFor = id => peers.get(id)?.stream || null;
  const status = text => { const e = $('#call-status'); if (e) e.textContent = text; };

  // ---- signalling over HTTP -------------------------------------------------------------------
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'The call server refused the request.');
    return d;
  }
  const post = (to, type, data) => api('/api/rtc/send', { room, id: me.id, token: me.token, to, type, data }).catch(() => {});

  // ---- audio in -------------------------------------------------------------------------------
  // A "test voice" plays one of the built-in speech clips into the call instead of a microphone,
  // so you can try a call with two tabs and no microphone (or without feedback from your speakers).
  async function testStream(voice) {
    testCtx = new (window.AudioContext || window.webkitAudioContext)();
    const bytes = await (await fetch(`/static/voices/chat_${voice}.wav`)).arrayBuffer();
    const src = testCtx.createBufferSource(), dest = testCtx.createMediaStreamDestination();
    src.buffer = await testCtx.decodeAudioData(bytes); src.loop = true; src.connect(dest); src.start();
    await testCtx.resume();
    return dest.stream;
  }
  async function localStream(voice) {
    if (voice !== 'mic') return testStream(voice);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('The microphone needs localhost or HTTPS.');
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
  }

  // ---- peer connections -----------------------------------------------------------------------
  function makePeer(id) {
    const pc = new RTCPeerConnection(ICE), entry = { pc, pending: [], name: names.get(id) || 'Guest', state: 'connecting', rtt: null, audio: null, stream: null };
    peers.set(id, entry);
    local.getTracks().forEach(t => pc.addTrack(t, local));
    pc.onicecandidate = e => { if (e.candidate) post(id, 'ice', e.candidate.toJSON()); };
    pc.ontrack = e => {
      entry.stream = e.streams[0] || new MediaStream([e.track]);
      // Chrome only delivers a remote stream to Web Audio if a media element is also attached to it.
      entry.audio = new Audio(); entry.audio.srcObject = entry.stream; entry.audio.muted = true; entry.audio.play().catch(() => {});
      refreshTable();
    };
    pc.onconnectionstatechange = () => {
      entry.state = pc.connectionState;
      if (entry.state === 'failed') { status(`The connection to ${entry.name} failed.`); drop(id); }
      renderList();
    };
    return entry;
  }

  async function offerTo(id) {
    const { pc } = makePeer(id);
    await pc.setLocalDescription(await pc.createOffer());
    await post(id, 'offer', { type: 'offer', sdp: pc.localDescription.sdp });
  }

  async function flush(entry) {
    for (const c of entry.pending.splice(0)) { try { await entry.pc.addIceCandidate(c); } catch (e) { /* stale candidate */ } }
  }

  async function handle(m) {
    let entry = peers.get(m.from);
    if (m.type === 'offer') {
      if (!entry) entry = makePeer(m.from);
      await entry.pc.setRemoteDescription({ type: 'offer', sdp: m.data.sdp });
      await flush(entry);
      await entry.pc.setLocalDescription(await entry.pc.createAnswer());
      await post(m.from, 'answer', { type: 'answer', sdp: entry.pc.localDescription.sdp });
    } else if (!entry) {
      return;
    } else if (m.type === 'answer') {
      await entry.pc.setRemoteDescription({ type: 'answer', sdp: m.data.sdp });
      await flush(entry);
    } else if (m.type === 'ice') {
      if (entry.pc.remoteDescription) { try { await entry.pc.addIceCandidate(m.data); } catch (e) { /* stale candidate */ } }
      else entry.pending.push(m.data);
    }
  }

  function drop(id) {
    const e = peers.get(id); if (!e) return;
    peers.delete(id);
    try { e.pc.close(); } catch (err) {}
    if (e.audio) { e.audio.srcObject = null; }
    refreshTable(); renderList();
  }

  // ---- the table ------------------------------------------------------------------------------
  function newPerson(id, taken) {
    const name = peers.get(id)?.name || names.get(id) || 'Guest';
    const angle = SEAT_ORDER.find(a => !taken.has(a)) ?? 0;
    return { id, name, initials: name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?', angle, volume: 1, muted: false,
      color: COLORS[peers.size % COLORS.length], remote: true };
  }
  // The table shows exactly the people whose voice has arrived.
  function refreshTable() {
    if (!me) return;
    const have = new Map(people.filter(p => p.remote).map(p => [p.id, p]));
    const taken = new Set([...have.values()].map(p => p.angle));
    const ids = [...peers].filter(([, e]) => e.stream).map(([id]) => id);
    people = ids.map(id => { if (have.has(id)) return have.get(id); const p = newPerson(id, taken); taken.add(p.angle); return p; });
    if (!people.some(p => p.id === selected)) selected = people[0] ? people[0].id : null;
    if (focusId && !people.some(p => p.id === focusId)) focusId = null;
    invalidate(); draw();
    status(people.length ? `In room “${room}” with ${people.length} other${people.length === 1 ? '' : 's'}. Put headphones on.` : `You are in room “${room}”. Waiting for others: open this page in a second tab and join the same room.`);
  }
  function resetTable() {
    const taken = new Set();
    people.forEach(p => { p.angle = SEAT_ORDER.find(a => !taken.has(a)) ?? 0; taken.add(p.angle); p.volume = 1; p.muted = false; p.distance = undefined; });
  }

  function renderList() {
    const list = $('#call-list'); if (!list) return;
    list.replaceChildren(...[...peers.values()].map(e => {
      const li = document.createElement('li');
      const ready = e.state === 'connected';
      li.textContent = `${e.name}: ${ready ? 'connected' + (e.rtt != null ? ` · round trip ${e.rtt < 1 ? '<1' : Math.round(e.rtt)} ms` : '') : e.state}`;
      li.className = ready ? 'ok' : '';
      return li;
    }));
  }
  // Round-trip time of the media path, as measured by the browser (a real, if local, latency number).
  async function measure() {
    for (const e of peers.values()) {
      try {
        for (const r of (await e.pc.getStats()).values()) {
          if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') e.rtt = r.currentRoundTripTime * 1000;
        }
      } catch (err) {}
    }
    renderList();
  }

  // ---- join, poll, leave ----------------------------------------------------------------------
  async function pollLoop(mine) {
    let failures = 0;
    while (me && run === mine) {
      try {
        const r = await fetch(`/api/rtc/poll?room=${encodeURIComponent(room)}&id=${me.id}&token=${encodeURIComponent(me.token)}&since=${version}`);
        if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || 'Disconnected.'), { fatal: true });
        const d = await r.json(); failures = 0; version = d.version;
        if (run !== mine) return;
        d.peers.forEach(p => { names.set(p.id, p.name); const e = peers.get(p.id); if (e) e.name = p.name; });
        const present = new Set(d.peers.map(p => p.id));
        [...peers.keys()].filter(id => !present.has(id)).forEach(drop);
        for (const m of d.messages) await handle(m);
        renderList();
      } catch (err) {
        if (run !== mine) return;
        if (err.fatal || ++failures > 4) { status('The call ended: ' + err.message); leave(); return; }
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async function join() {
    const name = $('#call-name').value.trim(), roomName = $('#call-room').value.trim(), voice = $('#call-voice').value;
    if (!name || !roomName) { status('Enter your name and a room name.'); return; }
    $('#call-join').disabled = true; status('Joining…');
    try {
      try { Live.start(); } catch (e) {}           // inside the click, so the browser allows sound
      local = await localStream(voice);
      const joined = await api('/api/rtc/join', { room: roomName, name });
      me = { id: joined.id, token: joined.token }; room = roomName; version = joined.version; const mine = ++run;
      try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
      joined.peers.forEach(p => names.set(p.id, p.name));
      // Replace the demo voices with the real call. People appear as their voices arrive.
      people = []; selected = null; focusId = null; files.clear();
      $('#call-form').hidden = true; $('#call-live').hidden = false; $('#demo-start').disabled = true;
      refreshTable();
      statsTimer = setInterval(measure, 2000);
      pollLoop(mine);
      for (const p of joined.peers) await offerTo(p.id);
    } catch (err) {
      status(err.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it, or pick a test voice.' : (err.message || 'Could not join.'));
      cleanup();
    } finally { $('#call-join').disabled = false; }
  }

  function cleanup() {
    run++; clearInterval(statsTimer);
    for (const id of [...peers.keys()]) { const e = peers.get(id); peers.delete(id); try { e.pc.close(); } catch (err) {} if (e.audio) e.audio.srcObject = null; }
    names.clear();
    if (local) local.getTracks().forEach(t => t.stop());
    local = null;
    if (testCtx) { testCtx.close().catch(() => {}); testCtx = null; }
    me = null;
  }

  function leave() {
    if (me) { const body = JSON.stringify({ room, id: me.id, token: me.token }); try { fetch('/api/rtc/leave', { method: 'POST', body, keepalive: true }).catch(() => {}); } catch (e) {} }
    const wasIn = !!me; cleanup();
    $('#call-form').hidden = false; $('#call-live').hidden = true; $('#demo-start').disabled = false;
    $('#call-mute').textContent = 'Mute my microphone'; renderList();
    if (wasIn) { people = defaults(); selected = 'aarav'; focusId = null; invalidate(); draw(); }
  }

  function toggleMute() {
    if (!local) return;
    const track = local.getAudioTracks()[0]; if (!track) return;
    track.enabled = !track.enabled;
    $('#call-mute').textContent = track.enabled ? 'Mute my microphone' : 'Unmute my microphone';
    status(track.enabled ? 'Your microphone is on.' : 'Your microphone is muted. The others cannot hear you.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const name = $('#call-name'); if (!name) return;
    try { name.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
    if (!name.value) name.value = 'Guest ' + Math.floor(Math.random() * 90 + 10);
    $('#call-join').onclick = join; $('#call-leave').onclick = leave; $('#call-mute').onclick = toggleMute;
    [name, $('#call-room')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') join(); }));
    addEventListener('pagehide', () => { if (me) navigator.sendBeacon('/api/rtc/leave', new Blob([JSON.stringify({ room, id: me.id, token: me.token })], { type: 'text/plain' })); });
  });
  return { join, leave, resetTable, streamFor, get active() { return active(); } };
})();

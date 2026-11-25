/* Seat table, personal mix and offline-export UI. Live audio is in live.js; the offline WAV renderer is in Python. */
const defaults = () => [
  {id:'aarav',name:'Aarav',initials:'AR',angle:-60,volume:1,muted:false,color:'#e9d7c2'},
  {id:'diya',name:'Diya',initials:'DI',angle:0,volume:.8,muted:false,color:'#dedec8'},
  {id:'kabir',name:'Kabir',initials:'KA',angle:60,volume:.9,muted:false,color:'#d5dfeb'},
  {id:'meera',name:'Meera',initials:'ME',angle:120,volume:.75,muted:false,color:'#e9d9dc'}
];
let people=defaults(), selected='aarav', spatial=true, audioURL=null, source='speech', focusId=null, voiceLines={};
const SEAT_ANGLES=[-150,-120,-90,-60,-30,0,30,60,90,120,150,180], RING_MIN=128, RING_STEP=20, MIN_DIST=.75, MAX_DIST=3.5, DEFAULT_DIST=1.5;
// A person's distance in metres sets how far from "You" they are drawn (and how loud and roomy they sound).
const radiusFor=d=>RING_MIN+((d??DEFAULT_DIST)-MIN_DIST)*RING_STEP;
const wrapAngle=a=>((a+540)%360)-180;
// Where a voice is, in plain words, relative to where the listener is facing.
function dirWord(r){r=wrapAngle(r);const a=Math.abs(r),side=r<0?'left':'right';
  if(a<=20)return 'in front of you';if(a<=70)return `front ${side}`;if(a<=110)return `on your ${side}`;if(a<=160)return `behind you, ${side}`;return 'behind you';}
const headNow=()=>typeof Live!=='undefined'?Live.head:0;
// "behind you, left · 1.5 m": direction relative to where the listener faces, plus distance.
const whereWord=(p,angle)=>`${dirWord(angle-headNow())} · ${(p.distance??DEFAULT_DIST).toFixed(2).replace(/0$/,'').replace(/\.$/,'')} m`;
const audioFile=f=>f&&(/^audio\//.test(f.type)||/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(f.name));
function placeSeat(el,angle,distance){const r=angle*Math.PI/180,rad=radiusFor(distance);el.style.left=`calc(50% + ${Math.sin(r)*rad}px)`;el.style.top=`calc(50% - ${Math.cos(r)*rad}px)`;}
function pointerAngle(e,snap){const box=$('#room').getBoundingClientRect();
  return wrapAngle(Math.round(Math.atan2(e.clientX-(box.left+box.width/2),-(e.clientY-(box.top+box.height/2)))*180/Math.PI/snap)*snap);}
// Dragging toward "You" brings a voice closer, dragging away pushes it farther (steps of 0.25 m).
function pointerDistance(e){const box=$('#room').getBoundingClientRect(),px=Math.hypot(e.clientX-(box.left+box.width/2),e.clientY-(box.top+box.height/2));
  return Math.max(MIN_DIST,Math.min(MAX_DIST,Math.round(((px-RING_MIN)/RING_STEP+MIN_DIST)*4)/4));}
// Move one person without rebuilding the page: seat, beam and the live sound follow.
function moveSeat(person,angle,distance){
  person.angle=angle;person.distance=distance;
  const button=document.querySelector(`.seat[data-id="${person.id}"]`);if(button)placeSeat(button,angle,distance);
  const beam=document.querySelector(`.beam[data-id="${person.id}"]`);if(beam)beam.style.setProperty('--a',`${angle-90}deg`);
  const seatLabel=document.querySelector(`.person[data-id="${person.id}"] .person-angle`);if(seatLabel)seatLabel.textContent=`Seat ${angleLabel(angle)}`;
  if(person.id===selected){$('#selected-label').textContent=`${person.name} · ${angleLabel(angle)} · ${distance} m`;}
  if(typeof Live!=='undefined'){Live.sync();Live.updateDistanceControl();}
}
// Drag a person anywhere around the table; the sound follows live.
function startDrag(e,person,button){
  if(e.button!==0)return;const x0=e.clientX,y0=e.clientY;let moved=false;
  try{button.setPointerCapture(e.pointerId);}catch(err){}
  const move=ev=>{
    if(!moved&&Math.hypot(ev.clientX-x0,ev.clientY-y0)<6)return;
    moved=true;button.classList.add('dragging');selected=person.id;moveSeat(person,pointerAngle(ev,15),pointerDistance(ev));
  };
  const up=()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',up);button.removeEventListener('pointercancel',up);
    button.classList.remove('dragging');if(moved){invalidate();draw();}};
  button.addEventListener('pointermove',move);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);
}
// Drop an audio file on a person (their avatar or their row in the mix) to give them that voice.
function allowDrop(el,person){
  el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('dropping');});
  el.addEventListener('dragleave',()=>el.classList.remove('dropping'));
  el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('dropping');const f=e.dataTransfer.files[0];
    if(audioFile(f)){files.set(person.id,f);selected=person.id;invalidate();draw();}});
}
const captionText=p=>p.remote?'● live voice':files.has(p.id)?'♪ your recording':(source==='speech'&&voiceLines[p.id])||'♪ test tone';
const files=new Map();
const $=s=>document.querySelector(s);
const angleLabel=a=>`${a>0?'+':''}${a}°`;
function invalidate(){
  if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}
  $('#player').pause();$('#player').removeAttribute('src');$('#player').load();
  $('#download').hidden=true;
  $('#message').classList.remove('error');
  $('#message').textContent='Controls changed · build a new mix to hear this setup.';
  if(typeof Live!=='undefined')Live.sync();
}
function draw(){
  const chosen=people.find(p=>p.id===selected)||people[0];
  if(chosen)selected=chosen.id;
  $('#selected-label').textContent=chosen?`${chosen.name} · ${angleLabel(chosen.angle)} · ${chosen.distance??DEFAULT_DIST} m`:'Nobody else is here yet';
  if(typeof Live!=='undefined')Live.updateDistanceControl();
  const layer=$('#seats');layer.innerHTML='';
  if(!chosen){$('#captions').innerHTML='';$('#people').innerHTML='<p class="empty-note">Nobody else is in the call yet. Open this page in a second tab (or another browser), join the same room, and their voice will appear here.</p>';$('#audio-source-label').textContent='Live call: waiting for others.';return;}
  people.forEach(p=>{const beam=document.createElement('span');beam.className='beam';beam.dataset.id=p.id;beam.style.setProperty('--a',`${p.angle-90}deg`);layer.append(beam);});
  SEAT_ANGLES.forEach(angle=>{
    if(people.some(p=>Math.abs(wrapAngle(p.angle-angle))<12))return;
    const button=document.createElement('button');button.className='seat empty';placeSeat(button,angle);
    button.title=`Move ${chosen.name} to ${angleLabel(angle)}`;button.setAttribute('aria-label',button.title);button.textContent='+';
    button.onclick=()=>{chosen.angle=angle;invalidate();draw();};layer.append(button);
  });
  people.forEach(person=>{
    const button=document.createElement('button');button.className=`seat ${person.id===selected?'active':''}`;placeSeat(button,person.angle,person.distance);button.dataset.id=person.id;
    button.title=`${person.name}, ${angleLabel(person.angle)}, ${person.distance??DEFAULT_DIST} m. Drag around the table to move, toward or away from You to change distance.`;
    button.setAttribute('aria-label',`${person.name} at ${angleLabel(person.angle)}. Drag to move, or press the left and right arrow keys.`);
    button.innerHTML=`<span class="avatar" style="--avatar:${person.color}">${person.initials}</span><span>${person.name}</span>`;
    button.onclick=()=>{selected=person.id;draw();};
    button.addEventListener('pointerdown',e=>startDrag(e,person,button));
    allowDrop(button,person);layer.append(button);
  });
  const caps=$('#captions');caps.innerHTML='';
  people.forEach(p=>{
    const row=document.createElement('div');row.className='cap';row.dataset.id=p.id;
    const name=document.createElement('b');name.textContent=p.name;const where=document.createElement('span');where.className='dir';where.textContent=whereWord(p,p.angle);
    const line=document.createElement('p');line.textContent=captionText(p);row.append(name,where,line);caps.append(row);
  });
  $('#people').innerHTML='';
  people.forEach(p=>{
    const element=document.createElement('div');element.className=`person ${selected===p.id?'selected':''}`;element.dataset.id=p.id;
    element.innerHTML=`<div class="person-head"><button class="person-select" aria-label="Select ${p.name}"><span class="avatar" style="--avatar:${p.color}">${p.initials}</span><span class="person-name">${p.name}<small class="person-angle">Seat ${angleLabel(p.angle)}</small></span></button><button class="focus-btn ${focusId===p.id?'on':''}" aria-pressed="${focusId===p.id}" title="Boost this voice and lower the others (F)">Focus</button><button class="mute ${p.muted?'muted':''}" aria-label="${p.muted?'Unmute':'Mute'} ${p.name}" aria-pressed="${p.muted}">${p.muted?'Unmute':'Mute'}</button></div><div class="volume-row"><input type="range" min="0" max="150" value="${Math.round(p.volume*100)}" aria-label="${p.name} volume"><span class="volume-value">${Math.round(p.volume*100)}%</span></div><div class="meter" data-id="${p.id}" aria-hidden="true"><i></i></div><label class="file-label" tabindex="0"><span></span><input type="file" accept="audio/*,.wav,.mp3,.m4a" aria-label="Upload WAV for ${p.name}"></label>`;
    element.querySelector('.person-select').onclick=()=>{selected=p.id;draw();};
    element.querySelector('.mute').onclick=()=>{p.muted=!p.muted;invalidate();draw();};
    element.querySelector('.focus-btn').onclick=()=>{focusId=focusId===p.id?null:p.id;invalidate();draw();};
    element.querySelector('input[type=range]').oninput=e=>{p.volume=Number(e.target.value)/100;element.querySelector('.volume-value').textContent=e.target.value+'%';invalidate();};
    const label=element.querySelector('.file-label');
    label.querySelector('span').textContent=files.has(p.id)?files.get(p.id).name:'＋ Add a recording';
    label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();label.querySelector('input').click();}};
    label.querySelector('input').onchange=e=>{
      if(audioFile(e.target.files[0])){files.set(p.id,e.target.files[0]);invalidate();draw();}
    };
    allowDrop(element,p);
    $('#people').append(element);
  });
  $('#audio-source-label').textContent=people.some(p=>p.remote)?`Live call: ${people.length} other${people.length===1?'':'s'}, each arriving as a separate audio stream.`:files.size?`${files.size} recorded voice${files.size>1?'s':''} + ${4-files.size} test tone${4-files.size===1?'':'s'}. Reset to clear uploads.`:(source==='speech'?'Speech demo: four synthetic voices talking at once. No microphone needed.':'Four distinct test tones. No microphone needed.');
}
$('#reset').onclick=()=>{const inCall=typeof Call!=='undefined'&&Call.active;if(!inCall){people=defaults();selected='aarav';}focusId=null;files.clear();if(typeof Live!=='undefined')Live.resetAll();if(inCall)Call.resetTable();invalidate();draw();};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
  spatial=button.dataset.mode==='spatial';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});
  $('#render').textContent=`▶  Build ${spatial?'spatial':'mono'} demo`;invalidate();
});
document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode==='spatial')));
// The offline renderer reads 48 kHz, 16-bit WAV only. Convert any audio file the browser can play (MP3, M4A...) first.
async function toWav48(file){
  const ac=new (window.AudioContext||window.webkitAudioContext)();
  try{
    const decoded=await ac.decodeAudioData(await file.arrayBuffer());
    const n=Math.min(Math.round(decoded.duration*48000),48000*15),o=new OfflineAudioContext(1,Math.max(1,n),48000),src=o.createBufferSource();
    src.buffer=decoded;src.connect(o.destination);src.start();
    const pcm=(await o.startRendering()).getChannelData(0),view=new DataView(new ArrayBuffer(44+pcm.length*2));
    const text=(at,t)=>[...t].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
    text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
    pcm.forEach((v,i)=>view.setInt16(44+i*2,Math.max(-1,Math.min(1,v))*32767,true));
    return new Blob([view],{type:'audio/wav'});
  }catch(e){throw new Error(`Could not read "${file.name}" as audio.`);}
  finally{ac.close();}
}
$('#render').onclick=async()=>{
  const button=$('#render');button.disabled=true;
  $('#message').classList.remove('error');$('#message').textContent='Rendering your mix in Python…';
  // Freeze controls so the visible setup always matches the returned audio.
  const controls=[...document.querySelectorAll('#studio button, #studio input')];
  controls.forEach(c=>c.disabled=true);
  try{
    const data=new FormData();data.append('settings',JSON.stringify({participants:people,spatial,source,focus:focusId}));
    for(const [id,file] of files)data.append(id,await toWav48(file),'voice.wav');
    const response=await fetch('/api/mix',{method:'POST',body:data});
    if(!response.ok){const error=await response.json();throw new Error(error.error||'Unable to render audio.');}
    const blob=await response.blob();
    if(audioURL)URL.revokeObjectURL(audioURL);
    audioURL=URL.createObjectURL(blob);$('#player').src=audioURL;
    $('#download').href=audioURL;$('#download').download=`roundtable-${spatial?'spatial':'mono'}.wav`;$('#download').hidden=false;
    $('#message').textContent=`${spatial?'Spatial':'Mono'} mix ready · press play to listen. Audio is rendered locally.`;
  }catch(error){$('#message').textContent=error.message;$('#message').classList.add('error');}
  finally{controls.forEach(c=>c.disabled=false);button.disabled=false;}
};
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>{
  document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==button.dataset.page);
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b===button));
  $('#crumb').textContent=button.textContent.trim().replace(/^[^\w]+/,'');
});
draw();
// Drag the "You" circle to turn your head; double-click to face front again.
(()=>{const you=document.querySelector('.listener');if(!you)return;
  you.addEventListener('pointerdown',e=>{e.preventDefault();try{you.setPointerCapture(e.pointerId);}catch(err){}
    const move=ev=>{if(typeof Live!=='undefined')Live.setHead(pointerAngle(ev,5));};
    const up=()=>{you.removeEventListener('pointermove',move);you.removeEventListener('pointerup',up);you.removeEventListener('pointercancel',up);};
    you.addEventListener('pointermove',move);you.addEventListener('pointerup',up);you.addEventListener('pointercancel',up);});
  you.addEventListener('dblclick',()=>{if(typeof Live!=='undefined')Live.setHead(0);});})();
try{if(localStorage.getItem('roundtable.coach')==='1')$('#coach').hidden=true;}catch(e){}
$('#coach-close').onclick=()=>{$('#coach').hidden=true;try{localStorage.setItem('roundtable.coach','1');}catch(e){}};
fetch('/static/voices/manifest.json').then(r=>r.ok?r.json():{}).then(m=>{voiceLines=m.chat||{};draw();}).catch(()=>{});
// "Larger text" switch for presenting on a projector or to someone sitting far from the screen.
(()=>{const b=$('#big-toggle');if(!b)return;
  const set=on=>{document.body.classList.toggle('big',on);b.setAttribute('aria-pressed',String(on));try{localStorage.setItem('roundtable.big',on?'1':'0');}catch(e){}};
  b.onclick=()=>set(!document.body.classList.contains('big'));
  try{if(localStorage.getItem('roundtable.big')==='1')set(true);}catch(e){}})();

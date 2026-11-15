/* Presentation controls only; all audio synthesis and mixing run in Python. */
const defaults = () => [
  {id:'aarav',name:'Aarav',initials:'AR',angle:-60,volume:1,muted:false,color:'#e9d7c2'},
  {id:'diya',name:'Diya',initials:'DI',angle:0,volume:.8,muted:false,color:'#dedec8'},
  {id:'kabir',name:'Kabir',initials:'KA',angle:60,volume:.9,muted:false,color:'#d5dfeb'},
  {id:'meera',name:'Meera',initials:'ME',angle:120,volume:.75,muted:false,color:'#e9d9dc'}
];
let people=defaults(), selected='aarav', spatial=true, audioURL=null, source='speech', focusId=null, voiceLines={};
const SEAT_ANGLES=[-150,-120,-90,-60,-30,0,30,60,90,120,150,180], RING=133;
const wrapAngle=a=>((a+540)%360)-180;
// Where a voice is, in plain words, relative to where the listener is facing.
function dirWord(r){r=wrapAngle(r);const a=Math.abs(r),side=r<0?'left':'right';
  if(a<=20)return 'in front of you';if(a<=70)return `front ${side}`;if(a<=110)return `on your ${side}`;if(a<=160)return `behind you, ${side}`;return 'behind you';}
const headNow=()=>typeof Live!=='undefined'?Live.head:0;
const audioFile=f=>f&&(/^audio\//.test(f.type)||/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(f.name));
function placeSeat(el,angle){const r=angle*Math.PI/180;el.style.left=`calc(50% + ${Math.sin(r)*RING}px)`;el.style.top=`calc(50% - ${Math.cos(r)*RING}px)`;}
function pointerAngle(e,snap){const box=$('#room').getBoundingClientRect();
  return wrapAngle(Math.round(Math.atan2(e.clientX-(box.left+box.width/2),-(e.clientY-(box.top+box.height/2)))*180/Math.PI/snap)*snap);}
// Drag a person anywhere around the table; the sound follows live.
function startDrag(e,person,button){
  if(e.button!==0)return;const x0=e.clientX,y0=e.clientY;let moved=false;
  try{button.setPointerCapture(e.pointerId);}catch(err){}
  const move=ev=>{
    if(!moved&&Math.hypot(ev.clientX-x0,ev.clientY-y0)<6)return;
    moved=true;button.classList.add('dragging');person.angle=pointerAngle(ev,15);selected=person.id;placeSeat(button,person.angle);
    const beam=document.querySelector(`.beam[data-id="${person.id}"]`);if(beam)beam.style.setProperty('--a',`${person.angle-90}deg`);
    $('#selected-label').textContent=`${person.name} · ${angleLabel(person.angle)}`;if(typeof Live!=='undefined')Live.sync();
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
const captionText=p=>files.has(p.id)?'♪ your recording':(source==='speech'&&voiceLines[p.id])||'♪ test tone';
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
  const chosen=people.find(p=>p.id===selected);
  $('#selected-label').textContent=`${chosen.name} · ${angleLabel(chosen.angle)}`;
  const layer=$('#seats');layer.innerHTML='';
  people.forEach(p=>{const beam=document.createElement('span');beam.className='beam';beam.dataset.id=p.id;beam.style.setProperty('--a',`${p.angle-90}deg`);layer.append(beam);});
  SEAT_ANGLES.forEach(angle=>{
    if(people.some(p=>Math.abs(wrapAngle(p.angle-angle))<12))return;
    const button=document.createElement('button');button.className='seat empty';placeSeat(button,angle);
    button.title=`Move ${chosen.name} to ${angleLabel(angle)}`;button.setAttribute('aria-label',button.title);button.textContent='+';
    button.onclick=()=>{chosen.angle=angle;invalidate();draw();};layer.append(button);
  });
  people.forEach(person=>{
    const button=document.createElement('button');button.className=`seat ${person.id===selected?'active':''}`;placeSeat(button,person.angle);button.dataset.id=person.id;
    button.title=`${person.name}, ${angleLabel(person.angle)}. Drag to move.`;
    button.setAttribute('aria-label',`${person.name} at ${angleLabel(person.angle)}. Drag to move, or press the left and right arrow keys.`);
    button.innerHTML=`<span class="avatar" style="--avatar:${person.color}">${person.initials}</span><span>${person.name}</span>`;
    button.onclick=()=>{selected=person.id;draw();};
    button.addEventListener('pointerdown',e=>startDrag(e,person,button));
    allowDrop(button,person);layer.append(button);
  });
  const caps=$('#captions');caps.innerHTML='';
  people.forEach(p=>{
    const row=document.createElement('div');row.className='cap';row.dataset.id=p.id;
    const name=document.createElement('b');name.textContent=p.name;const where=document.createElement('span');where.className='dir';where.textContent=dirWord(p.angle-headNow());
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
  $('#audio-source-label').textContent=files.size?`${files.size} recorded voice${files.size>1?'s':''} + ${4-files.size} test tone${4-files.size===1?'':'s'}. Reset to clear uploads.`:(source==='speech'?'Speech demo: four synthetic voices talking at once. No microphone needed.':'Four distinct test tones. No microphone needed.');
}
$('#reset').onclick=()=>{people=defaults();selected='aarav';focusId=null;files.clear();invalidate();draw();};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
  spatial=button.dataset.mode==='spatial';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});
  $('#render').textContent=`▶  Build ${spatial?'spatial':'mono'} demo`;invalidate();
});
document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode==='spatial')));
$('#render').onclick=async()=>{
  const button=$('#render');button.disabled=true;
  $('#message').classList.remove('error');$('#message').textContent='Rendering your mix in Python…';
  // Freeze controls so the visible setup always matches the returned audio.
  const controls=[...document.querySelectorAll('#studio button, #studio input')];
  controls.forEach(c=>c.disabled=true);
  try{
    const data=new FormData();data.append('settings',JSON.stringify({participants:people,spatial,source}));
    files.forEach((file,id)=>data.append(id,file));
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

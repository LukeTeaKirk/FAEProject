/* Presentation controls only; all audio synthesis and mixing run in Python. */
const defaults = () => [
  {id:'aarav',name:'Aarav',initials:'AR',angle:-60,volume:1,muted:false,color:'#e9d7c2'},
  {id:'diya',name:'Diya',initials:'DI',angle:0,volume:.8,muted:false,color:'#dedec8'},
  {id:'kabir',name:'Kabir',initials:'KA',angle:60,volume:.9,muted:false,color:'#d5dfeb'},
  {id:'meera',name:'Meera',initials:'ME',angle:120,volume:.75,muted:false,color:'#e9d9dc'}
];
let people=defaults(), selected='aarav', spatial=true, audioURL=null;
const files=new Map();
const $=s=>document.querySelector(s);
const angleLabel=a=>`${a>0?'+':''}${a}°`;
function invalidate(){
  if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}
  $('#player').pause();$('#player').removeAttribute('src');$('#player').load();
  $('#download').hidden=true;
  $('#message').classList.remove('error');
  $('#message').textContent='Controls changed · build a new mix to hear this setup.';
}
function draw(){
  const chosen=people.find(p=>p.id===selected);
  $('#selected-label').textContent=`${chosen.name} · ${angleLabel(chosen.angle)}`;
  $('#seats').innerHTML='';
  [-120,-60,0,60,120,180].forEach(angle=>{
    const person=people.find(p=>p.angle===angle);
    const button=document.createElement('button');
    button.className=`seat ${person?'':'empty'} ${person?.id===selected?'active':''}`;
    const rad=angle*Math.PI/180;
    button.style.left=`calc(50% + ${Math.sin(rad)*133}px)`;
    button.style.top=`calc(50% - ${Math.cos(rad)*133}px)`;
    button.title=person?`Select ${person.name}, ${angleLabel(angle)}`:`Move ${chosen.name} to ${angleLabel(angle)}`;
    button.setAttribute('aria-label',button.title);
    if(person){
      button.innerHTML=`<span class="avatar" style="--avatar:${person.color}">${person.initials}</span><span>${person.name}</span>`;
      button.onclick=()=>{selected=person.id;draw();};
    }else{
      button.textContent='+';
      button.onclick=()=>{chosen.angle=angle;invalidate();draw();};
    }
    $('#seats').append(button);
  });
  $('#people').innerHTML='';
  people.forEach(p=>{
    const element=document.createElement('div');element.className=`person ${selected===p.id?'selected':''}`;
    element.innerHTML=`<div class="person-head"><button class="person-select" aria-label="Select ${p.name}"><span class="avatar" style="--avatar:${p.color}">${p.initials}</span><span class="person-name">${p.name}<small class="person-angle">Seat ${angleLabel(p.angle)}</small></span></button><button class="mute ${p.muted?'muted':''}" aria-label="${p.muted?'Unmute':'Mute'} ${p.name}" aria-pressed="${p.muted}">${p.muted?'Unmute':'Mute'}</button></div><div class="volume-row"><input type="range" min="0" max="150" value="${Math.round(p.volume*100)}" aria-label="${p.name} volume"><span class="volume-value">${Math.round(p.volume*100)}%</span></div><label class="file-label" tabindex="0"><span></span><input type="file" accept=".wav,audio/wav" aria-label="Upload WAV for ${p.name}"></label>`;
    element.querySelector('.person-select').onclick=()=>{selected=p.id;draw();};
    element.querySelector('.mute').onclick=()=>{p.muted=!p.muted;invalidate();draw();};
    element.querySelector('input[type=range]').oninput=e=>{p.volume=Number(e.target.value)/100;element.querySelector('.volume-value').textContent=e.target.value+'%';invalidate();};
    const label=element.querySelector('.file-label');
    label.querySelector('span').textContent=files.has(p.id)?files.get(p.id).name:'＋ Add recorded voice';
    label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();label.querySelector('input').click();}};
    label.querySelector('input').onchange=e=>{
      if(e.target.files[0]){files.set(p.id,e.target.files[0]);invalidate();draw();}
    };
    $('#people').append(element);
  });
  $('#audio-source-label').textContent=files.size?`${files.size} recorded voice${files.size>1?'s':''} + ${4-files.size} test tone${4-files.size===1?'':'s'}. Reset to clear uploads.`:'Four distinct test tones. No microphone needed.';
}
$('#reset').onclick=()=>{people=defaults();selected='aarav';files.clear();invalidate();draw();};
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
    const data=new FormData();data.append('settings',JSON.stringify({participants:people,spatial}));
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

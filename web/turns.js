'use strict';
const dialogue={turns:[],active:null},batch={running:false,stop:false};
const turnColours=['#a4f4be','#efb8ff','#ffd99b','#97caff','#ffbdbd','#c1e88e'];
const LANES=[{id:'voices',name:'VOICES',colour:'#97caff',redo:'Redo the voice here'},{id:'sound',name:'SOUND',colour:'#ffd99b',redo:'Redo the sound here'}];
const tracks={stem:null,playing:[],placed:null,run:0,timer:null,lanes:Object.fromEntries(LANES.map(l=>[l.id,{db:0,mute:false,solo:false}]))};
const laneOf=mode=>mode==='sfx'?'sound':'voices',turnLane=t=>laneOf(t.mode||$('repairMode').value);
function tracksOn(){return Boolean(tracks.stem);}
// Without tracks all passages share one mix, so none may overlap. With tracks, only those on the same lane.
function passageClash(start,end,lane,except){return dialogue.turns.find(t=>t!==except&&(!tracksOn()||turnLane(t)===lane)&&start<t.end-.0001&&end>t.start+.0001);}
function turnAtSelection(){const t=activeTurn();return t&&t.source===state.sourceFile&&Math.abs(t.start-state.start)<=.001&&Math.abs(t.end-state.end)<=.001?t:null;}
const turnRange=t=>({...t.repaired.range,gainDb:clamp(Number(t.fields?.jointGainDb)||0,-12,12)});
function colourFor(label){let labels=[];for(const t of dialogue.turns)if(!labels.includes(t.speaker))labels.push(t.speaker);return turnColours[Math.max(0,labels.indexOf(label))%turnColours.length];}
function activeTurn(){return dialogue.turns.find(t=>t.id===dialogue.active)||null;}
function resetLipView(){lip.point=null;lip.track=null;lip.mask=null;lip.repaired=null;lip.refFrame=0;lip.refImage=null;updateFaceReferenceLabel();lip.pickSource=null;$('speakerArea').hidden=true;$('trackArea').hidden=true;$('lipCompare').hidden=true;$('lipTrack').disabled=true;}
const turnFade=t=>t.mode==='lip'?0:clamp(Number(t.fields?.jointFeather??200),0,500)/1000;
function crossingNote(t){const same=dialogue.turns.filter(a=>turnLane(a)===turnLane(t)),previous=same[same.indexOf(t)-1],gap=previous?t.start-previous.end:0;return previous&&gap<turnFade(previous)+turnFade(t)?`${gap.toFixed(2)} s after ${previous.speaker}: the fades cross, check this join`:'';}
function renderTurns(){
 const list=$('turnList'),markers=$('turnMarkers');list.replaceChildren();markers.replaceChildren();
 if(!dialogue.turns.length){const p=document.createElement('p');p.className='hint';p.textContent='No turns yet. Select a waveform interval, then add it.';list.append(p);}
 for(const t of dialogue.turns){
  const colour=colourFor(t.speaker),row=document.createElement('div');row.className='turn-row'+(t.id===dialogue.active?' active':'');row.style.setProperty('--turn-colour',colour);
  let dot=document.createElement('span');dot.className='turn-dot';if(t.refImage){dot=document.createElement('img');dot.className='turn-face';dot.src=t.refImage;dot.alt=`${t.speaker} face reference`;dot.title=`${t.speaker} face reference, ${((t.refFrame||0)/24).toFixed(2)} sec into the passage`;dot.onclick=()=>openTurn(t);}const info=document.createElement('div');info.className='turn-info';const title=document.createElement('b');title.textContent=t.speaker;const detail=document.createElement('small');detail.textContent=`${fmt(t.start)} – ${fmt(t.end)} · ${t.repaired?'repair ready':'awaiting repair'}`;info.append(title,detail);if(crossingNote(t)){const note=document.createElement('small');note.className='turn-line';note.textContent=crossingNote(t);info.append(note);}const said=t.mode==='sfx'?t.fields?.sfxPrompt:t.fields?.prompt;if(said){const words=document.createElement('small');words.className='turn-line';words.textContent=said;info.append(words);}
  const open=document.createElement('button');open.type='button';open.textContent=t.id===dialogue.active?'Selected':'Open';open.setAttribute('aria-label',`Open ${t.speaker} at ${fmt(t.start)}`);open.onclick=()=>openTurn(t);
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${t.speaker} at ${fmt(t.start)}`);remove.onclick=()=>{dialogue.turns=dialogue.turns.filter(a=>a.id!==t.id);if(dialogue.active===t.id){dialogue.active=null;resetLipView();}$('turnStatus').textContent='Turn removed.';renderTurns();};row.append(dot,info,open,remove);list.append(row);
  if(state.buffer){const m=document.createElement('div');m.className='turn-marker';m.style.setProperty('--turn-colour',colour);m.style.left=(t.start/state.buffer.duration*100)+'%';m.style.width=((t.end-t.start)/state.buffer.duration*100)+'%';const tag=document.createElement('span');tag.textContent=t.speaker;m.append(tag);markers.append(m);}
 }
 $('renderTurns').disabled=!batch.running&&!dialogue.turns.some(t=>!t.repaired);
 $('exportTurns').disabled=batch.running||dialogue.turns.length===0||dialogue.turns.some(t=>!t.repaired);
 refreshTracks();
 window.dispatchEvent(new Event('studio-project-changed'));
}
const TURN_FIELDS=['prompt','sfxPrompt','language','acting','actingFace','jointVoice','jointFeather','jointGainDb','seed','actingPreset','actingIntensity','referenceUse'],SPEAKER_FIELDS=['language','acting','actingFace','jointVoice','actingPreset','actingIntensity','referenceUse'];
function saveTurnFields(t){t.fields=Object.fromEntries(TURN_FIELDS.map(id=>[id,$(id).value]));t.voiceFile=$('voiceRef').files[0]||null;if(t===turnAtSelection())t.mode=$('repairMode').value;if(lip.track&&lip.track===t.track)t.mask=lip.mask?{...lip.mask}:null;}
// Moving on to other work must not count as a change to the passage that was open.
function leaveTurn(){const t=activeTurn();if(t)saveTurnFields(t);dialogue.active=null;}
function setVoiceFile(file){const dt=new DataTransfer();if(file)dt.items.add(file);$('voiceRef').files=dt.files;updateVoiceRefPreview();}
// A new turn starts from what this speaker used last: same voice, new words.
function loadTurnFields(t){const known=[...dialogue.turns].reverse().find(a=>a!==t&&a.speaker===t.speaker&&a.fields);const fields=t.fields||(known?Object.fromEntries(SPEAKER_FIELDS.map(id=>[id,known.fields[id]])):null);if(fields)for(const [id,value] of Object.entries(fields))$(id).value=value;if(!t.fields)$('prompt').value=$('sfxPrompt').value='';if(t.fields||known)setVoiceFile(t.fields?t.voiceFile:known.voiceFile);refreshPrompt();}
function openTurn(t){
 const previous=activeTurn();if(previous)saveTurnFields(previous);
 dialogue.active=t.id;state.start=t.start;state.end=t.end;syncSelection();state.chosen=t.take?state.takes.indexOf(t.take):null;if(state.chosen<0)state.chosen=null;renderTakes();$('takeOffset').value=t.offset||0;
 resetLipView();loadTurnFields(t);$('repairMode').value=t.mode||$('repairMode').value;syncRepairMode();$('lipDetector').value=t.detector||'face_yolov8m.pt';$('maskSoftness').value=t.softness??14;$('maskSoftnessValue').textContent=$('maskSoftness').value+' px';$('lipDenoise').value=t.denoise??0.6;updateLipDenoiseLabel();$('faceColorMatch').value=t.colorMatch??0.25;$('faceColorMatchValue').textContent=Number($('faceColorMatch').value).toFixed(2);
 if(t.track&&t.source===state.sourceFile){lip.point={...t.point};lip.pickSource=state.sourceFile;lip.pickStart=t.start;lip.pickEnd=t.end;lip.track=t.track;lip.refFrame=t.refFrame||0;lip.refImage=t.refImage||null;updateFaceReferenceLabel();lip.mask=t.mask?{...t.mask}:null;lip.repaired=t.repaired?{...t.repaired,chosen:state.chosen,takeIdentity:t.take}:null;$('trackVideo').src=t.track.url;$('speakerTrackVideo').src=t.track.markedUrl||'';$('trackArea').hidden=false;$('lipTrack').disabled=false;drawMask();if(lip.repaired){$('compareOriginal').src=state.sourceUrl;$('compareRepaired').src=lip.repaired.url;$('lipCompare').hidden=false;}}
 if(!t.track&&t.repaired?.joint&&t.source===state.sourceFile){lip.repaired={...t.repaired};$('compareOriginal').src=state.sourceUrl;$('compareRepaired').src=lip.repaired.url;$('lipCompare').hidden=false;}
 $('turnStatus').textContent=`${t.speaker} selected. ${voiceOnly()?'Fill in the Retake panel, then render.':'Choose a take and track this speaker’s face for this passage.'}`;renderTurns();
}
function addPassage(speaker){readRange();if(!state.sourceFile||!state.buffer||state.end<=state.start)throw Error('Load a source and select a passage on the waveform.');if(dialogue.turns.length>=8)throw Error('This first version supports up to eight turns.');const start=state.start,end=state.end,mode=$('repairMode').value;if(passageClash(start,end,laneOf(mode)))throw Error('Turns cannot overlap yet. Adjust the selected range first.');const t={id:crypto.randomUUID(),speaker,start,end,source:state.sourceFile,take:state.chosen===null?null:state.takes[state.chosen],offset:Number($('takeOffset').value)||0,detector:$('lipDetector').value,mode,repaired:null};dialogue.turns.push(t);dialogue.turns.sort((a,b)=>a.start-b.start);return t;}
$('addTurn').onclick=()=>{try{const speaker=$('speakerLabel').value.trim()||'Speaker';openTurn(addPassage(speaker));const m=speaker.match(/^Speaker (\d+)$/);if(m)$('speakerLabel').value='Speaker '+(Number(m[1])+1);}catch(e){$('turnStatus').textContent=e.message;}};
window.addEventListener('studio-source-changed',()=>{closeTracks();dialogue.turns=[];dialogue.active=null;resetLipView();renderTurns();$('turnStatus').textContent='Turn labels are manual; the studio does not identify speakers automatically.';});
function invalidateActiveTurn(){const t=activeTurn();if(t&&t.repaired&&t.source===state.sourceFile&&Math.abs(t.start-state.start)<.001&&Math.abs(t.end-state.end)<.001){t.repaired=null;$('turnStatus').textContent=`${t.speaker} changed. Render this turn again before exporting.`;renderTurns();}}
window.addEventListener('studio-lip-changed',invalidateActiveTurn);
window.addEventListener('studio-take-changed',invalidateActiveTurn);
$('takeOffset').addEventListener('input',invalidateActiveTurn);
// With tracks on, every render lands on a lane, even one made without adding a passage first.
window.addEventListener('studio-lip-rendered',()=>{if(tracksOn()&&lip.repaired&&!turnAtSelection()){try{dialogue.active=addPassage(sfxMode()?'Sound':$('speakerLabel').value.trim()||'Speaker').id;}catch(e){tracksMsg(e.message);}}const t=turnAtSelection();if(!t||!lip.repaired||(!lip.track&&!lip.repaired.joint))return;t.point={...lip.point};t.track=lip.track;t.mask={...lip.mask};t.repaired=lip.repaired;saveTurnFields(t);t.take=state.takes[state.chosen];t.offset=Number($('takeOffset').value)||0;t.detector=$('lipDetector').value;t.mode=$('repairMode').value;t.refFrame=lip.refFrame;t.refImage=lip.refImage;t.softness=Number($('maskSoftness').value);t.denoise=lipDenoiseValue();t.colorMatch=Number($('faceColorMatch').value);if(!batch.running)$('turnStatus').textContent=`Repair saved to ${t.speaker}. Add another turn or export when all are ready.`;renderTurns();});
window.addEventListener('studio-face-ref',()=>{const t=activeTurn();if(!t||!lip.track||t.source!==state.sourceFile||Math.abs(t.start-state.start)>.001||Math.abs(t.end-state.end)>.001)return;t.point={...lip.point};t.track=lip.track;t.mode=$('repairMode').value;t.detector=$('lipDetector').value;t.refFrame=lip.refFrame;t.refImage=lip.refImage;renderTurns();});
// Fades of close turns can cross. Each picture repair then stops halfway between the two lines.
function turnSpans(turns){return turns.map(t=>{const same=turns.filter(a=>turnLane(a)===turnLane(t)),i=same.indexOf(t),span=t.repaired.joint?jointSpan(t.repaired.range):t,previous=same[i-1],next=same[i+1];return {start:previous?Math.max(span.start,(previous.end+t.start)/2):span.start,end:next?Math.min(span.end,(t.end+next.start)/2):span.end};});}
async function blendTake(out,turn){
 if(!turn.take)throw Error(`${turn.speaker} has no audio take.`);const sr=out.sampleRate,take=await decodeBlob(turn.take.blob),offset=turn.offset||0,start=Math.round(turn.start*sr),end=Math.min(out.length,Math.round(turn.end*sr)),len=end-start,fade=Math.min(Math.round(clamp(Number($('fade').value)||0,0,1000)/1000*sr),Math.floor(len/2));
 for(let c=0;c<out.numberOfChannels;c++){const dest=out.getChannelData(c),samples=take.getChannelData(Math.min(c,take.numberOfChannels-1));for(let j=0;j<len;j++){const pos=(offset+j/sr)*take.sampleRate,i=Math.floor(pos),f=pos-i,v=(samples[i]||0)*(1-f)+(samples[Math.min(i+1,samples.length-1)]||0)*f,g=fade?Math.min(1,j/fade,(len-1-j)/fade):1;dest[start+j]=dest[start+j]*(1-g)+v*g;}}
}
async function mixDialogueTurns(){
 if(!state.buffer)throw Error('Load the source again.');if(tracksOn())return mixTracks();const out=copyBuffer(state.buffer);
 for(const [i,turn] of dialogue.turns.entries()){if(turn.repaired?.joint)await jointMixInto(out,turn.repaired,turnRange(turn),dialogue.turns.slice(i+1));else await blendTake(out,turn);}
 return out;
}
// Puts a finished mix on the source video. Only a line with a new mouth changes the picture.
async function deliverMix(mixed,turns,name){
 const audio=await uploadStudio(wav(mixed),'turns_audio_'+crypto.randomUUID()+'.wav'),spans=turnSpans(turns),pictures=turns.map((t,i)=>({repair:t.repaired.voiceOnly?null:t.repaired.file.filename,...spans[i],clipStart:t.repaired.range.clipStart})).filter(p=>p.repair),source=turns[0]?.repaired.sourceName||turns[0]?.track?.sourceName||(await jointSource()).name;
 const result=await(await api('/studio/export-turns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,audio,turns:pictures.length?pictures:[{repair:null,start:0,end:state.buffer.duration,clipStart:0}],matchColors:$('matchColors').checked})})).json();
 const a=document.createElement('a');a.href=result.url;a.download=name;a.click();
}
// Renders what is missing in time order. A turn that is not ready is reported, and the others still run.
$('renderTurns').onclick=async()=>{
 if(batch.running){batch.stop=true;$('renderTurns').disabled=true;$('renderTurns').textContent='Stopping after this turn…';return;}
 const pending=dialogue.turns.filter(t=>!t.repaired),failed=[];let done=0;
 batch.running=true;batch.stop=false;$('renderTurns').textContent='■ Stop after this turn';$('exportTurns').disabled=true;
 try{for(const t of pending){if(batch.stop)break;openTurn(t);$('turnStatus').textContent=`Rendering turn ${done+failed.length+1} of ${pending.length}: ${t.speaker} at ${fmt(t.start)}…`;await $('lipRender').onclick();if(t.repaired)done++;else failed.push(`${t.speaker} at ${fmt(t.start)}: ${$('lipStatus').textContent}`);}}
 finally{batch.running=false;$('renderTurns').textContent='▶ Render all turns';renderTurns();}
 $('turnStatus').textContent=failed.length?`${done} rendered, ${failed.length} not. ${failed.join(' ')}`:batch.stop?`Stopped after ${done} ${done===1?'turn':'turns'}.`:`${done} ${done===1?'turn':'turns'} rendered. Listen to each one before exporting.`;
};
$('exportTurns').onclick=async()=>{try{if(!dialogue.turns.length||dialogue.turns.some(t=>!t.repaired||(!t.track&&!t.repaired.joint)||t.source!==state.sourceFile))throw Error('Each turn needs a completed lip-sync repair for this source.');$('exportTurns').disabled=true;$('turnStatus').textContent='Mixing the turns and exporting the complete video…';await deliverMix(await mixDialogueTurns(),dialogue.turns,'dialogue-repaired.mp4');$('turnStatus').textContent='Complete dialogue video exported. Review both speakers and transitions.';}catch(e){$('turnStatus').textContent=e.message;}finally{renderTurns();}};
// Tracks: the source split into voices and everything else. Sound is the source minus Voices, so at 0 dB they add back to the source exactly.
const tracksMsg=s=>{$('tracksStatus').textContent=s;},eachLane=()=>LANES.map(l=>tracks.lanes[l.id]);
function audibleLanes(){const solo=eachLane().some(l=>l.solo);return eachLane().filter(l=>solo?l.solo:!l.mute);}
function stopTracks(){for(const node of tracks.playing)node.stop();tracks.playing=[];}
function startTracks(){if(tracks.playing.length||!tracksOn()||$('tracksSource').checked||video.paused||state.previewPlayer)return;audioContext.resume();tracks.playing=eachLane().map(l=>{const node=audioContext.createBufferSource();node.buffer=l.buffer;node.playbackRate.value=video.playbackRate;node.connect(l.node);node.start(0,video.currentTime);return node;});}
function restartTracks(){stopTracks();startTracks();}
function applyLevels(){const on=audibleLanes();for(const l of eachLane()){l.node.gain.value=on.includes(l)?10**(l.db/20):0;l.row.classList.toggle('silent',!on.includes(l));}}
function drawLanes(){if(tracksOn())for(const l of LANES)drawWave(tracks.lanes[l.id].canvas,tracks.lanes[l.id].buffer?.getChannelData(0),l.colour,10**(tracks.lanes[l.id].db/20));}
function drawBlocks(){
 for(const l of LANES)tracks.lanes[l.id].blocks.replaceChildren(...dialogue.turns.filter(t=>turnLane(t)===l.id).map(t=>{
  const block=document.createElement('div'),open=document.createElement('button');block.className='lane-block'+(t.repaired?'':' pending');block.style.setProperty('--turn-colour',colourFor(t.speaker));block.style.left=(t.start/state.buffer.duration*100)+'%';block.style.width=((t.end-t.start)/state.buffer.duration*100)+'%';
  open.type='button';open.textContent=t.repaired?t.speaker:t.speaker+' · not rendered';open.onclick=()=>openTurn(t);block.append(open);return block;
 }));
}
// Each retake goes on its own lane, so the other lane keeps the original sound.
async function placeTurns(){
 const placed=dialogue.turns.flatMap(t=>[t.repaired,t.fields?.jointGainDb]);if(tracks.placed&&placed.length===tracks.placed.length&&placed.every((x,i)=>x===tracks.placed[i]))return;
 const run=++tracks.run,lanes=Object.fromEntries(LANES.map(l=>[l.id,copyBuffer(tracks.lanes[l.id].base)]));
 for(const t of dialogue.turns){if(!t.repaired)continue;if(t.repaired.joint)await placeRetake(lanes,t.repaired,turnRange(t),dialogue.turns.filter(a=>a.start>t.start&&turnLane(a)===turnLane(t)));else await blendTake(lanes.voices,t);}
 if(run!==tracks.run)return;
 tracks.placed=placed;for(const l of LANES)tracks.lanes[l.id].buffer=lanes[l.id];drawLanes();restartTracks();
}
function refreshTracks(){if(!tracksOn())return;drawBlocks();clearTimeout(tracks.timer);tracks.timer=setTimeout(()=>placeTurns().catch(e=>tracksMsg(e.message)),50);}
const laneLevels=()=>Object.fromEntries(LANES.map(l=>{const {db,mute,solo}=tracks.lanes[l.id];return [l.id,{db,mute,solo}];}));
function monitorTracks(){video.muted=tracksOn()&&!$('tracksSource').checked;restartTracks();}
function syncLaneHead(l){const lane=tracks.lanes[l.id];lane.muteButton.setAttribute('aria-pressed',lane.mute);lane.soloButton.setAttribute('aria-pressed',lane.solo);lane.level.value=lane.db;lane.levelText.textContent=`${lane.db>0?'+':''}${lane.db.toFixed(1)} dB`;}
async function openTracks(stem,levels){
 const src=state.buffer,voices=await decodeBlob(stem),base={voices:copyBuffer(src),sound:copyBuffer(src)};
 for(let c=0;c<src.numberOfChannels;c++){const from=voices.getChannelData(Math.min(c,voices.numberOfChannels-1)),v=base.voices.getChannelData(c),s=base.sound.getChannelData(c);for(let i=0;i<v.length;i++){v[i]=from[i]||0;s[i]-=v[i];}}
 for(const l of LANES){const lane=tracks.lanes[l.id];lane.base=base[l.id];Object.assign(lane,levels?.[l.id]);syncLaneHead(l);}
 tracks.stem=stem;tracks.placed=null;$('lanes').hidden=$('waveTag').hidden=$('tracksActions').hidden=false;$('splitTracks').hidden=true;$('lipPanel').classList.add('tracks');
 drawBlocks();await placeTurns();applyLevels();monitorTracks();
}
function closeTracks(){stopTracks();clearTimeout(tracks.timer);tracks.stem=null;tracks.run++;for(const l of eachLane())Object.assign(l,{db:0,mute:false,solo:false,base:null,buffer:null});$('lanes').hidden=$('waveTag').hidden=$('tracksActions').hidden=true;$('splitTracks').hidden=false;$('tracksSource').checked=false;$('lipPanel').classList.remove('tracks');video.muted=false;}
async function mixTracks(){
 await placeTurns();const out=audioContext.createBuffer(state.buffer.numberOfChannels,state.buffer.length,state.buffer.sampleRate);
 for(const l of audibleLanes()){const gain=10**(l.db/20);for(let c=0;c<out.numberOfChannels;c++){const from=l.buffer.getChannelData(c),to=out.getChannelData(c);for(let i=0;i<to.length;i++)to[i]+=from[i]*gain;}}
 return out;
}
function bufferPeak(buffer){let peak=0;for(let c=0;c<buffer.numberOfChannels;c++)for(const v of buffer.getChannelData(c))if(Math.abs(v)>peak)peak=Math.abs(v);return peak;}
// What you hear is what you export: levels, Mute and Solo all count.
async function exportTracks(){
 const say=s=>{tracksMsg(s);lipMsg(s);},button=$('tracksExport');
 try{
  button.disabled=true;say('Mixing the tracks…');const mixed=await mixTracks(),peak=bufferPeak(mixed),waiting=dialogue.turns.filter(t=>!t.repaired).length,kept=LANES.filter(l=>audibleLanes().includes(tracks.lanes[l.id])).map(l=>l.name.toLowerCase()),notes=[kept.length<LANES.length?`Only ${kept.join(' and ')||'silence'} is in this mix.`:'',waiting?`${waiting} ${waiting===1?'passage has':'passages have'} no render yet and stayed original.`:'',peak>1?`The mix peaks ${(20*Math.log10(peak)).toFixed(1)} dB over full scale and clips: lower a track.`:''].filter(Boolean).join(' ');
  if(video.videoWidth)await deliverMix(mixed,dialogue.turns.filter(t=>t.repaired&&(t.track||t.repaired.joint)),'mix.mp4');else download(wav(mixed),'mix.wav');
  say(('Mix exported. '+notes).trim());
 }catch(e){say(e.message);}finally{button.disabled=false;}
}
function redoOnLane(l){
 try{
  readRange();if(!state.buffer||state.end<=state.start)throw Error('Drag on the waveform or a track to select the passage first.');
  const clash=passageClash(state.start,state.end,l.id);if(clash)return openTurn(clash);
  leaveTurn();
  setRepairMode(l.id==='sound'?'sfx':['joint','offscreen'].includes($('repairMode').value)?$('repairMode').value:'voice');
  openTurn(addPassage(l.id==='sound'?'Sound':$('speakerLabel').value.trim()||'Speaker'));tracksMsg(`${l.name[0]+l.name.slice(1).toLowerCase()} passage added. Fill in the Retake panel, then render.`);$('lipPanel').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){tracksMsg(e.message);}
}
for(const l of LANES){
 const lane=tracks.lanes[l.id],row=document.createElement('div');row.className='lane';row.style.setProperty('--lane',l.colour);
 row.innerHTML=`<div class="lane-head"><b>${l.name}</b><button type="button" class="lane-toggle" title="Mute" aria-pressed="false">M</button><button type="button" class="lane-toggle" title="Solo" aria-pressed="false">S</button><input type="range" min="-24" max="12" step="0.5" value="0" aria-label="${l.name} level"><output></output><button type="button" class="textbutton">${l.redo}</button></div><div class="lane-body"><canvas></canvas><div class="lane-blocks"></div></div>`;
 const [muteButton,soloButton,redo]=row.querySelectorAll('button'),level=row.querySelector('input');Object.assign(lane,{row,muteButton,soloButton,level,levelText:row.querySelector('output'),canvas:row.querySelector('canvas'),blocks:row.querySelector('.lane-blocks'),node:audioContext.createGain()});lane.node.connect(audioContext.destination);
 const changed=()=>{syncLaneHead(l);applyLevels();drawLanes();window.dispatchEvent(new Event('studio-project-changed'));};
 muteButton.onclick=()=>{lane.mute=!lane.mute;changed();};soloButton.onclick=()=>{lane.solo=!lane.solo;changed();};level.oninput=()=>{lane.db=Number(level.value);changed();};redo.onclick=()=>redoOnLane(l);lane.canvas.onpointerdown=e=>canvas.onpointerdown(e);$('lanes').append(row);
}
$('splitTracks').onclick=async()=>{
 const button=$('splitTracks'),source=state.sourceFile;
 try{
  if(!state.buffer)throw Error('Open a source first.');button.disabled=true;tracksMsg('Separating the voices. This takes about a minute on a short clip…');
  const audio=await uploadStudio(wav(state.buffer),'tracks_source_'+crypto.randomUUID()+'.wav'),outputs=await queueLipGraph({a:{class_type:'LoadAudio',inputs:{audio:'AudioRepairStudio/'+audio}},m:{class_type:'MelBandRoFormerModelLoader',inputs:{model_name:await stemModelName()}},s:{class_type:'MelBandRoFormerSampler',inputs:{model:['m',0],audio:['a',0]}},v:{class_type:'SaveAudio',inputs:{audio:['s',0],filename_prefix:'AudioRepairStudio/track_voices'}}}),stem=await fetchComfyFile(audioOutput(outputs,'v'));
  if(source!==state.sourceFile)return;await openTracks(stem);tracksMsg('Tracks ready. Level them, or select a passage and redo one track. What you hear is what you export.');
 }catch(e){tracksMsg(e.message);}finally{button.disabled=false;}
};
$('tracksExport').onclick=exportTracks;
$('tracksStems').onclick=async()=>{try{await placeTurns();for(const l of LANES)download(wav(tracks.lanes[l.id].buffer),l.name.toLowerCase()+'.wav');tracksMsg('Tracks downloaded at full level, with your retakes in place.');}catch(e){tracksMsg(e.message);}};
$('tracksSource').onchange=monitorTracks;
$('jointGainDb').addEventListener('input',()=>{const t=activeTurn();if(t)saveTurnFields(t);refreshTracks();});
window.addEventListener('studio-wave-drawn',drawLanes);
video.addEventListener('playing',startTracks);video.addEventListener('seeked',startTracks);
for(const event of ['pause','seeking','waiting'])video.addEventListener(event,stopTracks);
video.addEventListener('ratechange',restartTracks);
renderTurns();

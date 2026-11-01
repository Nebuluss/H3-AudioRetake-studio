'use strict';
// Joint retake: voice and mouth are regenerated in one H3 pass, inside the real shot.
const JOINT_MARGIN=1,JOINT_MIN_FRAMES=124,JOINT_MAX_FRAMES=362,SFX_MIN_FRAMES=56,SFX_FRAMES=6,OLLAMA='http://127.0.0.1:11434';
function jointMode(){return $('repairMode').value!=='lip';}
function sfxMode(){return $('repairMode').value==='sfx';}
function voiceOnly(){return ['voice','offscreen','sfx'].includes($('repairMode').value);}
function jointFeather(){return clamp(Number($('jointFeather').value)||0,0,500)/1000;}
function retakeDb(){return clamp(Number($('jointGainDb').value)||0,-12,12);}
function jointWindow(start,end){const frames=5+17*Math.ceil((Math.max(JOINT_MIN_FRAMES,(end-start+2*JOINT_MARGIN)*24)-5)/17),total=Math.floor((video.duration||state.buffer.duration)*24);return {frames,total,skip:clamp(Math.round(((start+end)/2-frames/48)*24),0,total-frames)};}
// A new soundtrack needs no speech around it, so the whole clip can fill the window. Frames missing at the end repeat the last one.
function sfxRange(){
 const selected=Math.ceil((state.end-state.start)*24-.01),total=Math.floor((video.duration||state.buffer.duration)*24);
 if(selected>JOINT_MAX_FRAMES)throw Error('Select up to about 15 seconds: H3 redoes the sound of one window at a time.');
 const frames=5+17*Math.ceil((clamp(Math.min(total,selected+48),Math.max(SFX_MIN_FRAMES,selected),JOINT_MAX_FRAMES)-5)/17),skip=clamp(Math.floor(((state.start+state.end)/2-frames/48)*24),0,Math.max(0,total-frames));
 return {start:state.start,end:state.end,skip,frames,pad:Math.max(0,frames-(total-skip)),clipStart:skip/24,feather:jointFeather(),gainDb:retakeDb(),sfx:true};
}
function jointRange(){
 if(sfxMode())return sfxRange();
 const {frames,total,skip}=jointWindow(state.start,state.end);
 if(frames>JOINT_MAX_FRAMES)throw Error('Select a passage shorter than about 13 seconds for a joint retake.');
 if(frames>total)throw Error('A joint retake needs at least about 5.2 seconds of source video.');
 return {start:state.start,end:state.end,skip,frames,clipStart:skip/24,feather:jointFeather(),gainDb:retakeDb()};
}
function jointSpan(r){return {start:Math.max(r.clipStart,r.start-r.feather),end:Math.min(r.clipStart+r.frames/24,r.end+r.feather)};}
// Same curve as timed_ramp() in __init__.py.
function jointGain(t,r){if(!r.feather)return t>=r.start&&t<=r.end?1:0;const x=clamp(Math.min(t-r.start+r.feather,r.end+r.feather-t)/r.feather,0,1);return x*x*(3-2*x);}
function jointPrompt(hasReference){
 const line=$('prompt').value.trim(),language=$('language').value.trim(),acting=$('acting').value.trim()||'in a natural voice, at an easy conversational pace',face=voiceOnly()?'':$('actingFace').value.trim(),voice=$('jointVoice').value.trim(),offscreen=$('repairMode').value==='offscreen';
 const dialogue=`<d>${language?'['+language+'] ':''}${line}</d>`,timbre=hasReference?' <Audio 1> is the voice-timbre reference for <Subject 1> (S1).':'',voiceText=voice?' Their voice is '+voice+'.':'';
 const definition=offscreen?`<Subject 1> is the scene shown in <Picture 1>. An off-screen speaker (S1) talks over it.${voiceText}`.replace('<Subject 1> (S1)','(S1)'):`<Subject 1> (S1) is the speaker in <Picture 1>; the image defines their facial identity and appearance.${voiceText}${timbre}`;
 const retained=voiceOnly()?`the picture is unchanged${offscreen?'':'; the speech follows the visible lip movements'}`:`the exact face, skin, pose, lighting and camera are retained; only the ${face?'lips, mouth and described expression change':'lips and mouth change to articulate speech'}`;
 const reference=hasReference&&!offscreen?', using the voice timbre referenced from <Audio 1>':'';
 const shot=offscreen?`[Shot 1] An off-screen speaker (S1), ${acting}, says in an off-screen voiceover, ${dialogue} The on-screen character's lips remain closed.`:`[Shot 1] <Subject 1> (S1), ${acting}${reference}, says once, ${dialogue} Only the words inside the dialogue tag are spoken, once.${face?' '+face:''}`;
 return `subject_definitions:
${definition}

summary:
[reference generation${hasReference&&!offscreen?' + audio reference':''}] ${offscreen?'An off-screen voice speaks over the existing shot.':voiceOnly()?'<Subject 1> speaks the same moment again with clean speech.':'<Subject 1> speaks new dialogue inside the existing shot.'}

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - ${retained}.${hasReference&&!offscreen?`
<Audio 1>: ${$('referenceUse').value} - its vocal timbre guides the speaker's voice without copying the original signal.`:''}

detailed_description:
${shot}

overall_soundscape:
Subtle ambience continuing from the surrounding sound.

non_diegetic_music:
N/A`;
}
function sfxPrompt(){
 const sound=$('sfxPrompt').value.trim()||'The natural sound of everything happening on screen, in sync with the picture: the place itself and every visible action.';
 return `subject_definitions:
<Subject 1> is the scene shown in <Picture 1>.

summary:
[reference generation] The existing shot keeps its picture and gets a new soundtrack.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the picture is unchanged.

detailed_description:
[Shot 1] The shot plays exactly as shown, with no dialogue. ${sound}

overall_soundscape:
${sound}

non_diegetic_music:
N/A`;
}
function jointSourceSlice(r,src=state.buffer){const sr=src.sampleRate,from=Math.round(r.clipStart*sr),length=Math.ceil((r.frames/24+.1)*sr),out=audioContext.createBuffer(Math.min(2,src.numberOfChannels),length,sr);for(let c=0;c<out.numberOfChannels;c++)out.getChannelData(c).set(src.getChannelData(c).subarray(from,from+length));return out;}
async function uploadVoiceReference(){const file=$('voiceRef').files[0];return file?'AudioRepairStudio/'+await uploadStudio(file,'voice_ref_'+crypto.randomUUID()+extFor(file.name)):null;}
// Face tracking is optional for a voice-only retake; without it H3 sees the scaled full frame.
async function jointSource(){
 if(lip.track)return {name:lip.track.sourceName,path:lip.track.sourcePath};
 if(lip.upload?.file!==state.sourceFile){const name=await uploadStudio(state.sourceFile,'source_'+crypto.randomUUID()+extFor(state.sourceFile.name));lip.upload={file:state.sourceFile,name,path:await localInputPath(name)};}
 return lip.upload;
}
async function blankMask(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,64,64);return new Promise(resolve=>c.toBlob(resolve,'image/png'));}
function frameSize(){const scale=512/Math.min(video.videoWidth,video.videoHeight),snap=x=>Math.max(32,Math.round(x*scale/32)*32);return {width:snap(video.videoWidth),height:snap(video.videoHeight)};}
async function stemModelName(){const info=await(await api('/object_info/MelBandRoFormerModelLoader')).json(),item=info?.MelBandRoFormerModelLoader?.input?.required?.model_name,names=Array.isArray(item?.[0])?item[0]:item?.[1]?.options||[],name=names.find(n=>/melband.*fp16/i.test(n))||names.find(n=>/melband/i.test(n));if(!name)throw Error('Separating voices needs a Mel-Band RoFormer model. Install it, or work without tracks and the Keep options.');return name;}
async function jointGraph(r){
 const sfx=sfxMode(),stems=tracksOn()||$(sfx?'sfxKeepVoices':'keepBed').checked,source=await jointSource(),slice=jointSourceSlice(r),free=!sfx&&$('freeActing').checked,heard=free?audioContext.createBuffer(slice.numberOfChannels,slice.length,slice.sampleRate):sfx&&tracksOn()?jointSourceSlice(r,tracks.lanes.sound.buffer):slice,sourceAudio=await uploadStudio(wav(heard),'joint_audio_'+crypto.randomUUID()+'.wav'),originalAudio=stems&&heard!==slice?await uploadStudio(wav(slice),'joint_bed_'+crypto.randomUUID()+'.wav'):null,maskName=await uploadStudio(voiceOnly()?await blankMask():await maskBlob(),'joint_mask_'+crypto.randomUUID()+'.png'),reference=sfx||$('repairMode').value==='offscreen'&&!$('voiceRef').files[0]?null:await uploadVoiceReference();
 const g=await(await api('/audio-retake/lip_preset.json')).json();applyModelSettings(g);
 g['80']=sourceNode(source.path,r);g['83'].inputs.audio='AudioRepairStudio/'+sourceAudio;g['85'].inputs.image='AudioRepairStudio/'+maskName;
 if(r.pad){g['p1']={class_type:'ImageFromBatch',inputs:{image:['80',0],batch_index:4095,length:1}};g['p2']={class_type:'RepeatImageBatch',inputs:{image:['p1',0],amount:r.pad+3}};g['p3']={class_type:'ImageBatch',inputs:{image1:['80',0],image2:['p2',0]}};g['p4']={class_type:'ImageFromBatch',inputs:{image:['p3',0],batch_index:0,length:r.frames}};}
 if(lip.track)g['81']=trackerNode(r);else{const size=frameSize();g['81']={class_type:'ImageScale',inputs:{image:[r.pad?'p4':'80',0],upscale_method:'lanczos',width:size.width,height:size.height,crop:'disabled'}};Object.assign(g['11'].inputs,size,{length:r.frames});}
 delete g['86'];g['87'].inputs.image=['85',0];
 g['95']={class_type:'AudioRetakeTimedMask',inputs:{mask:['87',0],frames:r.frames,start_seconds:r.start-r.clipStart,end_seconds:r.end-r.clipStart,feather_seconds:r.feather}};
 g['88'].inputs.video_mask=['95',0];g['88'].inputs.audio_mask=['95',1];
 g['93']={class_type:'ImageFromBatch',inputs:{image:['81',0],batch_index:lip.track?lip.refFrame:Math.floor(r.frames/2),length:1}};g['11'].inputs['ref_images.ref_image_0']=['93',0];
 if(reference){g['71']={class_type:'LoadAudio',inputs:{audio:reference}};g['11'].inputs['ref_audios.ref_audio_0']=['71',0];}
 g['11'].inputs.prompt=sfx?sfxPrompt():jointPrompt(Boolean(reference));
 g['98']={class_type:'VAEDecodeAudio',inputs:{samples:['14',0],vae:['7',0]}};g['91'].inputs.audio=['98',0];
 if(voiceOnly()){delete g['89'];delete g['90'];g['91'].inputs.images=['80',0];}
 else{g['90'].inputs.masks=['95',0];g['90'].inputs.mask_dilation=2;g['90'].inputs.feather=Number($('maskSoftness').value);g['90'].inputs.colour_match=Number($('faceColorMatch').value);}
 g['97']={class_type:'SaveAudio',inputs:{audio:['98',0],filename_prefix:'AudioRepairStudio/joint_audio'}};
 g['92'].inputs.filename_prefix='AudioRepairStudio/joint_repair';
 if(stems){
  g['s1']={class_type:'MelBandRoFormerModelLoader',inputs:{model_name:await stemModelName()}};
  g['s2']={class_type:'MelBandRoFormerSampler',inputs:{model:['s1',0],audio:['98',0]}};if(originalAudio)g['s6']={class_type:'LoadAudio',inputs:{audio:'AudioRepairStudio/'+originalAudio}};g['s3']={class_type:'MelBandRoFormerSampler',inputs:{model:['s1',0],audio:[originalAudio?'s6':'83',0]}};
  // A line puts the new voice over the original sound. The SFX put the new sound under the original voices.
  g['s4']={class_type:'SaveAudio',inputs:{audio:sfx?['s3',0]:['s2',0],filename_prefix:'AudioRepairStudio/joint_voice'}};g['s5']={class_type:'SaveAudio',inputs:{audio:sfx?['s2',1]:['s3',1],filename_prefix:'AudioRepairStudio/joint_bed'}};
  if(sfx){g['m1']={class_type:'AudioMerge',inputs:{audio1:['s3',0],audio2:['s2',1],merge_method:'add'}};g['91'].inputs.audio=['m1',0];}
 }
 if(!sfx){const margin=Math.max(.1,r.feather);g['t1']={class_type:'TrimAudioDuration',inputs:{audio:['98',0],start_index:Math.max(0,r.start-r.clipStart-margin),duration:r.end-r.start+2*margin}};
 g['t2']={class_type:'AudioRetakeTranscribe',inputs:{audio:['t1',0],language:$('language').value.trim()}};}
 return {graph:g,sourceName:source.name};
}
function wordsOf(text){return String(text).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s']/gu,' ').split(/\s+/).filter(Boolean);}
// Share of the expected words heard in the take, from their word-level edit distance.
function wordMatch(expected,heard){const a=wordsOf(expected),b=wordsOf(heard);if(!a.length)return 0;let row=b.map((_,j)=>j+1);row.unshift(0);a.forEach((w,i)=>{let previous=row[0];row[0]=i+1;b.forEach((v,j)=>{const cost=Math.min(row[j+1]+1,row[j]+1,previous+(w===v?0:1));previous=row[j+1];row[j+1]=cost;});});return Math.max(0,1-row[b.length]/a.length);}
function heardWords(outputs){try{return JSON.parse(outputs.t2.transcript[0]).map(w=>w.word).join(' ');}catch{return '';}}
const audioOutput=(outputs,id)=>outputs[id]?.audio?.[0];
function useVariant(variant){if(lip.repaired?.url&&!lip.variants.some(v=>v.url===lip.repaired.url))URL.revokeObjectURL(lip.repaired.url);lip.repaired=variant;$('compareOriginal').src=state.sourceUrl;$('compareRepaired').src=variant.url;$('lipCompare').hidden=false;renderVariants();window.dispatchEvent(new Event('studio-lip-rendered'));}
function renderVariants(){
 const list=$('jointVariants');list.replaceChildren();list.hidden=lip.variants.length<2&&!lip.variants[0]?.heard;
 for(const variant of lip.variants){const row=document.createElement('label');row.className='variant'+(variant===lip.repaired?' selected':'');const radio=document.createElement('input');radio.type='radio';radio.name='variant';radio.checked=variant===lip.repaired;radio.onchange=()=>useVariant(variant);const text=document.createElement('span');text.textContent=variant.range.sfx?`Seed ${variant.seed}`:`Seed ${variant.seed} · ${Math.round(variant.score*100)}% words · ${variant.heard||'nothing heard'}`;row.append(radio,text);list.append(row);}
}
async function renderJoint(){
 const r=lipRange(),sfx=sfxMode(),line=$(sfx?'sfxPrompt':'prompt').value.trim(),voice=voiceOnly();
 if(!line&&!sfx)throw Error('Enter the words to speak under Audio takes.');
 const clash=tracksOn()&&passageClash(r.start,r.end,laneOf($('repairMode').value),turnAtSelection());if(clash)throw Error(`This passage overlaps ${clash.speaker} on the same track. Open that passage or change the selection.`);
 if($('repairMode').value==='joint'||lip.track){if(!lip.track||lip.track.source!==state.sourceFile||lip.track.key!==lipKey(r))throw Error('The passage or speaker changed. Track the face again.');}
 if(!voice&&!lip.mask)throw Error('Draw a mouth mask on the tracked face first.');
 lipMsg('Preparing the retake…');const maskKey=maskFingerprint(),refFrame=lip.refFrame,seed=Number($('seed').value)||0,count=Number($('jointCount').value)||1,{graph,sourceName}=await jointGraph(r);
 lip.variants=[];renderVariants();
 for(let i=0;i<count;i++){
  lipMsg(`Rendering variation ${i+1} of ${count} · seed ${seed+i}. This can take a few minutes…`);
  const g=structuredClone(graph);g['13'].inputs.noise_seed=seed+i;
  const outputs=await queueLipGraph(g),file=videoFile(outputs,'92'),sound=audioOutput(outputs,'97');if(!sound)throw Error('ComfyUI returned no generated audio.');
  if(lip.track&&lip.track.key!==lipKey(lipRange())||!lip.track&&(r.start!==state.start||r.end!==state.end)||maskKey!==maskFingerprint()||refFrame!==lip.refFrame)throw Error('The selection changed while rendering. Render again.');
  const heard=heardWords(outputs),blob=await fetchComfyFile(file),variant={seed:seed+i,heard,score:sfx?1:wordMatch(line,heard),file,blob,url:URL.createObjectURL(blob),range:r,joint:await fetchComfyFile(sound),voice:audioOutput(outputs,'s4')?await fetchComfyFile(audioOutput(outputs,'s4')):null,bed:audioOutput(outputs,'s5')?await fetchComfyFile(audioOutput(outputs,'s5')):null,voiceOnly:voice,sourceName,chosen:state.chosen,takeIdentity:state.takes[state.chosen],offset:Number($('takeOffset').value)||0,maskKey,refFrame,graph:g};
  lip.variants.push(variant);lip.variants.sort((a,b)=>b.score-a.score);useVariant(lip.variants[0]);
 }
 lipMsg(sfx?'Sound ready. Listen to each variation before exporting.':'Retake ready. The best word match is selected; listen to each variation before exporting.');
}
const decodeBlob=async blob=>audioContext.decodeAudioData((await blob.arrayBuffer()).slice(0));
function sampleAt(buffer,channel,time){const data=buffer.getChannelData(Math.min(channel,buffer.numberOfChannels-1)),pos=time*buffer.sampleRate,j=Math.floor(pos),f=pos-j;return (data[j]||0)*(1-f)+(data[Math.min(j+1,data.length-1)]||0)*f;}
// Typical loudness of the voiced frames, ignoring pauses.
function speechLevel(data,sr){const size=Math.round(.02*sr),levels=[];for(let i=0;i+size<=data.length;i+=size){let sum=0;for(let j=i;j<i+size;j++)sum+=data[j]*data[j];const level=Math.sqrt(sum/size);if(level>.004)levels.push(level);}return levels.length>=10?levels.sort((a,b)=>a-b)[Math.floor(levels.length*.8)]:0;}
// What is left of a window once these spans are taken out.
function clearParts(from,to,spans){const parts=[];let at=from;for(const s of [...spans].sort((a,b)=>a.start-b.start)){if(s.end<=at||s.start>=to)continue;if(s.start>at)parts.push([at,s.start]);at=Math.max(at,s.end);}return at<to?[...parts,[at,to]]:parts;}
// Gain that brings the retake to the speech just around it, within 6 dB. A passage still waiting for its repair is no reference.
function matchedGain(out,voice,r,span,pending){const sr=out.sampleRate,data=out.getChannelData(0),target=Math.max(0,...clearParts(r.clipStart,r.clipStart+r.frames/24,[span,...pending]).map(([a,b])=>speechLevel(data.subarray(Math.round(a*sr),Math.round(b*sr)),sr))),own=speechLevel(voice.getChannelData(0).subarray(Math.round((r.start-r.clipStart)*voice.sampleRate),Math.round((r.end-r.clipStart)*voice.sampleRate)),voice.sampleRate);return target&&own?clamp(target/own,.5,2):1;}
function retakeGain(out,voice,r,pending){return 10**((r.gainDb||0)/20)*($('matchLevel').checked&&!r.sfx?matchedGain(out,voice,r,jointSpan(r),pending):1);}
// Keeps the original samples outside the retake, not their VAE reconstruction.
function blendInto(out,sample,r){const span=jointSpan(r),sr=out.sampleRate,from=Math.round(span.start*sr),to=Math.min(out.length,Math.round(span.end*sr));for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=from;i<to;i++){const t=i/sr,w=jointGain(t,r);d[i]=d[i]*(1-w)+sample(c,t-r.clipStart)*w;}}}
async function jointMixInto(out,repaired,r,pending=[]){
 const voice=await decodeBlob(repaired.voice||repaired.joint),bed=repaired.bed?await decodeBlob(repaired.bed):null,gain=retakeGain(out,voice,r,pending),voiceGain=r.sfx&&bed?1:gain,bedGain=r.sfx&&bed?gain:1;
 blendInto(out,(c,t)=>sampleAt(voice,c,t)*voiceGain+(bed?sampleAt(bed,c,t)*bedGain:0),r);
}
// A retake changes one track. One rendered without stems holds the whole mix, so it replaces both.
async function placeRetake(lanes,repaired,r,pending){
 const audio=await decodeBlob(r.sfx?repaired.bed||repaired.joint:repaired.voice||repaired.joint),target=lanes[r.sfx?'sound':'voices'],gain=retakeGain(target,audio,r,pending);
 blendInto(target,(c,t)=>sampleAt(audio,c,t)*gain,r);if(!repaired.bed)blendInto(lanes[r.sfx?'voices':'sound'],()=>0,r);
}
async function exportJoint(){
 if(tracksOn())return exportTracks();
 const r={...lip.repaired.range,gainDb:retakeDb()},out=copyBuffer(state.buffer);
 lipMsg('Mixing the retake and exporting the full video…');await jointMixInto(out,lip.repaired,r,dialogue.turns.filter(t=>t.id!==dialogue.active));
 const audioName=await uploadStudio(wav(out),'full_audio_'+crypto.randomUUID()+'.wav'),span=jointSpan(r);
 const response=await(await api('/studio/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:lip.repaired.sourceName,repair:lip.repaired.voiceOnly?null:lip.repaired.file.filename,audio:audioName,start:span.start,end:span.end,clipStart:r.clipStart,matchColors:$('matchColors').checked})})).json();
 const a=document.createElement('a');a.href=response.url;a.download=r.sfx?'new-sound.mp4':'joint-retake.mp4';a.click();lipMsg(r.sfx?'Full video exported. Watch it through: check that the sounds land on the actions.':'Full video exported. Review the words, the mouth and the transitions.');
}
function syncRepairMode(){const joint=jointMode(),voice=voiceOnly(),sfx=sfxMode();$('jointFields').hidden=!joint;$('sfxFields').hidden=!sfx;$('faceDirection').hidden=voice;$('lipRender').textContent=sfx?'Render sound':voice?'Render voice':'3  Render lip-sync';$('voiceTrackHint').hidden=!voice||sfx;$('lipPanel').classList.toggle('sfx',sfx);$('lipPanel').classList.toggle('no-track',voice);document.querySelectorAll('[data-redo]').forEach(b=>b.classList.toggle('active',(b.dataset.redo==='sfx')===sfx));if(sfx)loadVisionModels();}
$('repairMode').addEventListener('change',()=>{syncRepairMode();$('keepBed').checked=$('repairMode').value==='joint';window.dispatchEvent(new Event('studio-lip-changed'));lip.track=null;lip.repaired=null;lip.variants=[];renderVariants();$('trackArea').hidden=true;$('lipCompare').hidden=true;lipMsg({joint:'Joint retake: enter the words under Audio takes, then choose and track the speaker.',voice:'Voice only: enter the words, then render. Tracking the face is optional and gives H3 a closer view of the lips.',offscreen:'Off-screen voice: enter the words, then render. The picture stays untouched.',lip:'Lip-sync: choose a take, then choose and track the speaker.',sfx:'Redo the SFX: render as it is for the natural sound of the shot, or describe what you want first. Drag on the waveform to redo only one passage.'}[$('repairMode').value]);});
let lineMode='lip';
function selectClip(){if(!state.buffer)return;state.start=0;state.end=Math.min(state.buffer.duration,JOINT_MAX_FRAMES/24);syncSelection();}
function setRepairMode(mode){if(mode===$('repairMode').value)return;if(mode==='sfx')lineMode=$('repairMode').value;$('repairMode').value=mode;$('repairMode').dispatchEvent(new Event('change'));}
document.querySelectorAll('[data-redo]').forEach(b=>b.onclick=()=>{const sfx=b.dataset.redo==='sfx';if(sfx===sfxMode())return;leaveTurn();setRepairMode(sfx?'sfx':lineMode);renderTurns();if(sfx)selectClip();});
$('sfxWhole').onclick=selectClip;
const sfxMsg=s=>{$('sfxStatus').textContent=s;};
const sfxVisionPrompt=`These are frames from one video shot, in time order.
You are a film sound designer. Write the sound this shot needs, based only on what is clearly visible: first the ambience of the place, then the sounds of the actions you can see, in order. Name the materials and surfaces.
Do not describe the picture. Do not mention speech, music, decibels or exact times. Do not invent objects or actions.
Answer in at most 50 words, as one plain paragraph.`;
// Gemma reads a video as a sequence of frames, so the page sends frames spread across the selection.
async function clipFrames(r){
 const v=document.createElement('video'),c=document.createElement('canvas'),frames=[];v.muted=true;v.preload='auto';v.src=state.sourceUrl;await seekFrame(v,r.start);
 const scale=Math.min(1,768/Math.max(v.videoWidth,v.videoHeight));c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);
 for(let i=0;i<SFX_FRAMES;i++){await seekFrame(v,r.start+(r.end-r.start)*(i+.5)/SFX_FRAMES);c.getContext('2d').drawImage(v,0,0,c.width,c.height);frames.push(c.toDataURL('image/jpeg',.85).split(',')[1]);}
 return frames;
}
// Ollama vision models, Gemma and the largest first.
async function loadVisionModels(){
 const list=$('sfxVision'),chosen=list.value;
 try{const tags=await(await fetch(OLLAMA+'/api/tags')).json(),names=tags.models.filter(m=>m.capabilities?m.capabilities.includes('vision'):/gemma|vision|llava|moondream/i.test(m.name)).map(m=>m.name).sort((a,b)=>Number(/gemma/i.test(b))-Number(/gemma/i.test(a))||b.localeCompare(a,undefined,{numeric:true}));list.replaceChildren(...names.map(name=>new Option(name)));if(names.includes(chosen))list.value=chosen;if(!names.length)sfxMsg('Ollama has no vision model. Add one such as gemma3:4b, or write the sound yourself.');}
 catch{list.replaceChildren();sfxMsg('Ollama is not running, so suggestions are off. You can still write the sound yourself.');}
}
$('sfxSuggest').onclick=async()=>{
 const button=$('sfxSuggest');
 try{
  button.disabled=true;const r=lipRange(),model=$('sfxVision').value;if(!model)throw Error('Start Ollama with a vision model such as gemma3:4b, or write the sound yourself.');
  sfxMsg('Reading frames from the selection…');const images=await clipFrames(r);
  sfxMsg(`${model} is watching the clip. This can take a minute…`);
  const reply=await fetch(OLLAMA+'/api/generate',{method:'POST',body:JSON.stringify({model,prompt:sfxVisionPrompt,images,stream:false,keep_alive:0,options:{temperature:.3,num_predict:200}})});
  if(!reply.ok)throw Error('Ollama returned '+reply.status+': '+(await reply.text()).slice(0,300));
  $('sfxPrompt').value=(await reply.json()).response.trim();sfxMsg('Suggestion ready. Check it against the picture and edit it before rendering.');
 }catch(e){sfxMsg(e instanceof TypeError?'Could not reach Ollama. Start it, or write the sound yourself.':e.message);}
 finally{button.disabled=false;}
};

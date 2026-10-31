'use strict';
// Word transcript of the source: click a word to select it, shift-click to extend.
const transcript={words:[],anchor:null};
const WORD_PAD=.03;
async function speechBuffer(){const sr=16000,offline=new OfflineAudioContext(1,Math.ceil(state.buffer.duration*sr),sr),node=offline.createBufferSource();node.buffer=state.buffer;node.connect(offline.destination);node.start();return offline.startRendering();}
function selectWords(from,to){const a=transcript.words[Math.min(from,to)],b=transcript.words[Math.max(from,to)];state.start=Math.max(0,a.start-WORD_PAD);state.end=Math.min(state.buffer.duration,b.end+WORD_PAD);syncSelection();$('prompt').value=transcript.words.slice(Math.min(from,to),Math.max(from,to)+1).map(w=>w.word).join(' ');$('prompt').dispatchEvent(new Event('input'));}
function markTranscript(){const buttons=$('transcript').children;transcript.words.forEach((w,i)=>buttons[i]?.classList.toggle('selected',w.start<state.end&&w.end>state.start&&state.end>state.start));}
function renderTranscript(){const box=$('transcript');box.replaceChildren();box.hidden=!transcript.words.length;transcript.words.forEach((w,i)=>{const b=document.createElement('button');b.type='button';b.textContent=w.word;b.title=`${fmt(w.start)} – ${fmt(w.end)}`;b.onclick=e=>{const from=e.shiftKey&&transcript.anchor!==null?transcript.anchor:i;if(!e.shiftKey)transcript.anchor=i;selectWords(from,i);};box.append(b);});markTranscript();}
$('transcribe').onclick=async()=>{if(!state.buffer)return message('Load a source first.');const button=$('transcribe');button.disabled=true;try{message('Transcribing the source locally…');const name=await uploadStudio(wav(await speechBuffer()),'transcript_'+crypto.randomUUID()+'.wav');const outputs=await queueLipGraph({'1':{class_type:'LoadAudio',inputs:{audio:'AudioRepairStudio/'+name}},'2':{class_type:'AudioRetakeTranscribe',inputs:{audio:['1',0],language:$('language').value.trim()}}});transcript.words=JSON.parse(outputs['2'].transcript[0]);transcript.anchor=null;renderTranscript();checkLine();message('Transcript ready. Click a word to select it; shift-click to extend the selection.');}catch(e){message('Transcription failed: '+e.message);}finally{button.disabled=false;}};
function syllables(text){return text.toLowerCase().split(/\s+/).reduce((total,word)=>{const letters=word.replace(/[^\p{L}]/gu,'');return letters?total+Math.max(1,(letters.replace(/(?<=[^aeiouy])es?$/,'').match(/[aeiouyàâäéèêëîïôöùûüœ]+/g)||[]).length):total;},0);}
// Speaker pace from the transcript, otherwise an ordinary speaking rate.
function speakingRate(){const rates=transcript.words.filter(w=>w.end-w.start>=.1).map(w=>syllables(w.word)/(w.end-w.start)).sort((a,b)=>a-b);return rates.length>=5?clamp(rates[Math.floor(rates.length/2)],3,8):5.5;}
function checkLine(){
 const line=$('prompt').value.trim(),note=$('lineCheck'),issues=[];
 if(line){
  if(/\.\.\.|…/.test(line))issues.push('Ellipses often hurt clarity.');
  if(/["“”«»]/.test(line))issues.push('Remove quotation marks.');
  if(!/[.?!]$/.test(line))issues.push('End the line with . ? or !');
  const length=state.end-state.start,needed=syllables(line)/speakingRate();
  if(state.buffer&&length>0){const text=`About ${needed.toFixed(1)} s to speak · selection ${length.toFixed(1)} s.`;issues.unshift(needed>length*1.25?text+' It may sound rushed.':needed<length*.6?text+' The mouth may keep moving after the line, and a voice reference can add invented speech.':text);}
 }
 note.hidden=!issues.length;note.textContent=issues.join(' ');
}
$('prompt').addEventListener('input',checkLine);
window.addEventListener('studio-selection-changed',()=>{markTranscript();checkLine();});
window.addEventListener('studio-source-changed',()=>{transcript.words=[];transcript.anchor=null;renderTranscript();});

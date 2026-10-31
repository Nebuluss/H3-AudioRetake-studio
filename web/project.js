'use strict';
// Keeps the current project in this browser, so a refresh does not lose renders.
const projectStore={db:null,timer:null,restoring:false};
function openProjectDb(){if(projectStore.db)return projectStore.db;projectStore.db=new Promise((resolve,reject)=>{const request=indexedDB.open('audio-retake',1);request.onupgradeneeded=()=>request.result.createObjectStore('project');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return projectStore.db;}
async function projectAccess(mode,action){const db=await openProjectDb();return new Promise((resolve,reject)=>{const tx=db.transaction('project',mode),request=action(tx.objectStore('project'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);});}
function plainTurn(t){const repaired=t.repaired?.blob?{...t.repaired,url:null,takeIdentity:null}:null;return {...t,source:null,take:state.takes.indexOf(t.take),track:t.track?{...t.track,source:null,url:null,markedUrl:null}:null,repaired};}
async function saveProject(){
 if(projectStore.restoring||!state.sourceFile||(!dialogue.turns.length&&!state.takes.length))return; // Opening a file alone must not replace saved work.
 const active=activeTurn();if(active)saveTurnFields(active);
 const data={source:state.sourceFile,start:state.start,end:state.end,chosen:state.chosen,takes:state.takes.map(({blob,name,meta})=>({blob,name,meta})),turns:dialogue.turns.map(plainTurn),active:dialogue.active,words:transcript.words,mode:$('repairMode').value,fields:Object.fromEntries(TURN_FIELDS.map(id=>[id,$(id).value])),voiceFile:$('voiceRef').files[0]||null,savedAt:Date.now()};
 await projectAccess('readwrite',store=>store.put(data,'current'));
}
function queueProjectSave(){clearTimeout(projectStore.timer);projectStore.timer=setTimeout(()=>saveProject().catch(e=>message('Could not save the project in this browser: '+e.message)),800);}
function reviveTurn(t,source){
 const take=t.take>=0?state.takes[t.take]:null,track=t.track&&{...t.track,source,url:URL.createObjectURL(t.track.blob),markedUrl:URL.createObjectURL(t.track.markedBlob)};
 return {...t,source,take,track,repaired:t.repaired&&{...t.repaired,url:URL.createObjectURL(t.repaired.blob),takeIdentity:take}};
}
async function restoreProject(){
 const data=await projectAccess('readonly',store=>store.get('current'));if(!data)return;
 projectStore.restoring=true;$('restoreProject').hidden=true;
 try{
  await loadSource(data.source);
  state.takes=[];state.chosen=null;for(const take of data.takes)addTake(take.blob,take.name,take.meta);state.chosen=data.chosen;renderTakes();
  for(const [id,value] of Object.entries(data.fields))$(id).value=value;$('repairMode').value=data.mode;syncRepairMode();setVoiceFile(data.voiceFile);refreshPrompt();
  transcript.words=data.words||[];renderTranscript();
  dialogue.turns=data.turns.map(t=>reviveTurn(t,state.sourceFile));dialogue.active=null;renderTurns();
  const active=dialogue.turns.find(t=>t.id===data.active);if(active)openTurn(active);else{state.start=data.start;state.end=data.end;syncSelection();}
  message(`Project restored: ${data.source.name}.`);
 }finally{projectStore.restoring=false;}
}
$('restoreProject').onclick=()=>restoreProject().catch(e=>message('Could not restore the project: '+e.message));
window.addEventListener('studio-project-changed',queueProjectSave);
window.addEventListener('studio-lip-rendered',queueProjectSave);
window.addEventListener('studio-face-ref',queueProjectSave);
projectAccess('readonly',store=>store.get('current')).then(data=>{if(data&&!state.sourceFile){$('restoreProject').hidden=false;$('restoreProject').textContent=`↺ Restore ${data.source.name} · ${data.turns.length} ${data.turns.length===1?'turn':'turns'}`;}}).catch(()=>{});

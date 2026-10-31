'use strict';
// Acting presets. The voice text goes before <d>, the face text after </d>.
const ACTING_PRESETS=[
 ['Retake',[['Match the original','in the same voice and delivery as the surrounding lines, at an easy conversational pace','']]],
 ['Calm',[['Calm','in a calm, even voice, at an easy conversational pace','Their face stays relaxed.'],['Intimate','in a low, intimate voice, close and unhurried','Their gaze softens.'],['Whispered','in a soft breathy whisper, barely voiced','Their lips barely part.'],['Tender','in a warm, gentle voice, softly and slowly','A small tender smile stays on their lips.']]],
 ['Humor',[['Dry amusement','with dry, understated amusement, a smile audible in the voice','One corner of their mouth lifts.'],['Teasing','in a teasing, lilting voice, stretching the words playfully','A playful smile spreads across their face.'],['Joyful','in a bright, lively voice, with quick happy energy','They smile broadly.']]],
 ['Tension',[['Surprised','with a sharp intake of breath, voice rising in surprise','Their eyebrows lift and their eyes widen.'],['Worried','in a tight, breathy voice, slightly hurried and worried','Their brow creases.'],['Menacing','in a low, controlled voice, slow and deliberate','Their gaze stays fixed and unblinking.'],['Restrained anger','through clenched teeth, in a hard, restrained voice','Their jaw tightens and their gaze stays fixed.'],['Shouting','shouting at full force, voice loud and strained','Their mouth opens wide and the tendons of their neck tighten.']]],
 ['Fragile',[['Sad','in a soft, heavy voice, slow and close to tears','Their eyes glisten and their lips tremble.'],['Weary','in a low, weary voice, flat and unhurried','Their eyelids droop.'],['Hesitant','haltingly, with small uncertain pauses between words','Their eyes search for the words.']]]
];
const ACTING_INTENSITY={subtle:', understated',normal:'',strong:', intense and fully committed'},ACTING_STORE='audio-retake.actingPresets';
function customActing(){try{return JSON.parse(localStorage.getItem(ACTING_STORE)||'{}');}catch{return {};}}
function storeCustomActing(presets){try{localStorage.setItem(ACTING_STORE,JSON.stringify(presets));}catch{}}
function renderActingPresets(selected=''){
 const select=$('actingPreset'),option=(value,label,parent)=>{const o=document.createElement('option');o.value=value;o.textContent=label;parent.append(o);},custom=Object.keys(customActing());
 select.replaceChildren();option('','None',select);
 ACTING_PRESETS.forEach(([group,items],g)=>{const parent=document.createElement('optgroup');parent.label=group;items.forEach(([label],i)=>option(`${g}:${i}`,label,parent));select.append(parent);});
 if(custom.length){const parent=document.createElement('optgroup');parent.label='My presets';custom.forEach(name=>option('custom:'+name,name,parent));select.append(parent);}
 select.value=selected;$('deleteActingPreset').hidden=!select.value.startsWith('custom:');
}
function selectedActing(){const value=$('actingPreset').value;if(!value)return null;if(value.startsWith('custom:'))return customActing()[value.slice(7)]||null;const [g,i]=value.split(':').map(Number),[,voice,face]=ACTING_PRESETS[g][1][i];return {voice,face};}
function applyActingPreset(){$('deleteActingPreset').hidden=!$('actingPreset').value.startsWith('custom:');const preset=selectedActing();if(!preset)return;$('acting').value=preset.voice+ACTING_INTENSITY[$('actingIntensity').value];$('actingFace').value=preset.face;refreshPrompt();}
$('actingPreset').addEventListener('change',applyActingPreset);$('actingIntensity').addEventListener('change',applyActingPreset);
$('acting').addEventListener('input',()=>{$('actingPreset').value='';$('deleteActingPreset').hidden=true;});
$('saveActingPreset').onclick=()=>{const voice=$('acting').value.trim();if(!voice)return message('Enter an acting direction first.');const name=(window.prompt('Preset name')||'').trim();if(!name)return;const presets=customActing();presets[name]={voice,face:$('actingFace').value.trim()};storeCustomActing(presets);renderActingPresets('custom:'+name);};
$('deleteActingPreset').onclick=()=>{const presets=customActing();delete presets[$('actingPreset').value.slice(7)];storeCustomActing(presets);renderActingPresets();};
renderActingPresets();

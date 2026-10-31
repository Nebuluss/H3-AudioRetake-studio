"use strict";
const retakeModelDefs = [
  {id:"retakeUnet", node:"UNETLoader", input:"unet_name", graph:"1", key:"unet_name", preferred:"Minimax-h3_Singularity_ref2va_v2_int8.safetensors", hint:/minimax.*h3.*ref2va/i},
  {id:"retakeLora", node:"LoraLoaderBypassModelOnly", input:"lora_name", graph:"3", key:"lora_name", preferred:"pika_h3_flex_ref2va_comfy_bf16.safetensors", hint:/pika.*h3.*flex.*ref2va/i},
  {id:"retakeText", node:"CLIPLoader", input:"clip_name", graph:"5", key:"clip_name", preferred:"qwen3vl_32b_minimax_h3_int8_convrot.safetensors", hint:/qwen3vl.*minimax.*h3/i},
  {id:"retakeVideoVae", node:"VAELoader", input:"vae_name", graph:"6", key:"vae_name", preferred:"minimax_h3_video_vae_fp16.safetensors", hint:/minimax.*h3.*video.*vae/i},
  {id:"retakeAudioVae", node:"VAELoader", input:"vae_name", graph:"7", key:"vae_name", preferred:"minimax_h3_audio_vae_fp32.safetensors", hint:/minimax.*h3.*audio.*vae/i}
];
function retakeOptions(info,node,input){const x=info?.[node]?.input?.required?.[input];return Array.isArray(x?.[0])?x[0]:(x?.[1]?.options||[]);}
async function refreshRetakeModels(){
 $('modelStatus').textContent='Checking installed models…';
 try{
  const types=[...new Set(retakeModelDefs.map(d=>d.node))];
  const results=await Promise.all(types.map(async name=>{const r=await fetch('/object_info/'+encodeURIComponent(name));if(!r.ok)throw Error('Cannot read '+name);return [name,await r.json()];}));
  const infos=Object.fromEntries(results);let missing=0;
  for(const def of retakeModelDefs){
   const select=$(def.id),items=retakeOptions(infos[def.node],def.node,def.input);let saved='';try{saved=localStorage.getItem('audio-retake.'+def.id)||'';}catch{}
   const chosen=items.includes(select.value)?select.value:items.includes(saved)?saved:items.includes(def.preferred)?def.preferred:items.find(x=>def.hint.test(x))||'';
   select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select an installed model';select.append(placeholder);
   for(const name of items){const opt=document.createElement('option');opt.value=name;opt.textContent=name;select.append(opt);}
   select.value=chosen;if(!chosen)missing++;
   select.onchange=()=>{try{localStorage.setItem('audio-retake.'+def.id,select.value);}catch{};};
  }
  $('modelStatus').textContent=missing?`${missing} model selection(s) need your attention.`:'Models selected. Check the names if you use a different H3 setup.';
  if(missing)$('modelDetails').open=true;
 }catch(e){$('modelStatus').textContent='Could not load the model list: '+e.message;$('modelDetails').open=true;}
}
function applyModelSettings(graph){for(const def of retakeModelDefs){const value=$(def.id).value;if(!value){$('modelDetails').open=true;throw Error('Select all H3 models under H3 model setup.');}graph[def.graph].inputs[def.key]=value;}}
$('refreshModels').onclick=refreshRetakeModels;
refreshRetakeModels();

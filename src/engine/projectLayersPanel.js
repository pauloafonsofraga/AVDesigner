import {DEFAULT_LAYER_ID, LAYER_COLLECTIONS, projectLayers, layerObjects, captureLayerState, restoreLayerState, deleteProjectLayer, assignNewObjectsToLayer} from './projectLayers.js';
import {readReferencePng,loadReferencePdf,renderReferencePdfPage} from './referenceImageImport.js';
import {cloneHistoryValue} from './historyClone.js';

export function mountProjectLayersPanel(api) {
  const aside=document.querySelector('.panel.inspector');
  aside.classList.add('with-project-layers');
  const divider=document.createElement('div');divider.className='project-layers-divider';
  divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','horizontal');divider.setAttribute('aria-label','Resize Inspector and Layers');
  const panel=document.createElement('section');panel.className='project-layers-panel';panel.setAttribute('aria-label','Layers');
  panel.innerHTML='<header><h2>Layers</h2><div class="project-layer-tools"></div></header><div class="project-layer-assignment"><label>Selection layer<select aria-label="Selection layer"></select></label></div><div class="project-layer-list" role="list" aria-label="Project layers"></div><input type="file" accept=".png,.pdf,image/png,application/pdf" hidden>';
  aside.append(divider,panel);
  const list=panel.querySelector('.project-layer-list'),tools=panel.querySelector('.project-layer-tools'),fileInput=panel.querySelector('input[type=file]'),assignment=panel.querySelector('select');
  const known=new Map(layerObjects(api.state()).map(e=>[e.collection+':'+e.id,e.object.layerId || null]));
  let documentIdentity=api.documentIdentity();
  let selected=api.state().activeLayerId || DEFAULT_LAYER_ID,dragId='',lastKey='',busy=false;
  const button=(icon,title,action)=>{
    const b=document.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',title);
    b.append(window.WireNexusToolbarIcons.create(document,icon));b.onclick=action;return b;
  };
  const commit=(label,mutate)=>{
    const root=api.state(),before=captureLayerState(root,cloneHistoryValue),draft={...root};
    for(const key of LAYER_COLLECTIONS) draft[key]=(root[key] || []).map(item=>({...item}));
    draft.layers=projectLayers(root);
    mutate(draft);
    const after=captureLayerState(draft,cloneHistoryValue);
    return api.commit(label,before,after,snapshot=>{
      restoreLayerState(api.state(),snapshot,cloneHistoryValue);
      selected=snapshot.activeLayerId;lastKey='';
      known.clear();for(const e of layerObjects(api.state())) known.set(e.collection+':'+e.id,e.object.layerId || null);
    });
  };
  const entries=()=>{
    const selection=api.selection(),objects=layerObjects(api.state());
    const items=['multi','multi-core-selection'].includes(selection?.type) ? selection.items : selection ? [selection] : [];
    const collections={device:'devices','image-object':'imageObjects','led-surface':'ledSurfaces',area:'areas',comment:'comments','title-block':'titleBlocks','jump-node':'jumpNodes',wire:'connections','jump-link':'jumpLinks',loom:'looms',rack:'racks',connector:'devices'};
    Object.assign(collections,{'multi-core-end':'multiCores','multi-core-trunk':'multiCores',imageObject:'imageObjects',ledSurface:'ledSurfaces',jumpNode:'jumpNodes',titleBlock:'titleBlocks'});
    return objects.filter(entry=>items.some(item=>entry.collection===collections[item.type || item.kind] && entry.id===String(item.multiCoreId || (item.type==='connector'?item.deviceId:item.id))));
  };
  const choose=id=>{
    selected=id;api.state().activeLayerId=id;lastKey='';render();
  };
  const move=(id,to)=>commit('Reorder layers',draft=>{
    const index=draft.layers.findIndex(l=>l.id===id),[layer]=draft.layers.splice(index,1);
    draft.layers.splice(Math.max(0,Math.min(draft.layers.length,to)),0,layer);
  });
  tools.append(button('plus','New layer',()=>commit('Create layer',draft=>{
    const layer={id:'layer-'+crypto.randomUUID(),name:'Layer '+draft.layers.length,visible:true,locked:false};
    draft.layers.push(layer);draft.activeLayerId=layer.id;
  })),button('layer-import','Import venue layout (PNG or PDF)',()=>fileInput.click()),
  button('layer-up','Move layer up',()=>{const layers=projectLayers(api.state()),i=layers.findIndex(l=>l.id===selected);if(i<layers.length-1)move(selected,i+1);}),
  button('layer-down','Move layer down',()=>{const i=projectLayers(api.state()).findIndex(l=>l.id===selected);if(i>0)move(selected,i-1);}),
  button('layer-trash','Delete layer',()=>{
    const layer=projectLayers(api.state()).find(l=>l.id===selected);
    if(layer?.id!==DEFAULT_LAYER_ID && confirm(`Delete “${layer.name}”? Objects will be moved to the Default layer. Connections will be preserved.`)) commit('Delete layer',draft=>deleteProjectLayer(draft,selected));
  }));
  assignment.onchange=()=>{
    const selectedEntries=entries();if(!selectedEntries.length)return;
    commit('Assign selection to layer',draft=>{
      for(const entry of selectedEntries) {
        const object=draft[entry.collection].find(item=>String(item.instanceId || item.id)===entry.id);
        if(object)object.layerId=assignment.value;
      }
    });
  };
  let resize=null;
  const resizeTo=value=>{
    const max=Math.max(120,aside.clientHeight-120),height=Math.max(120,Math.min(max,value));
    aside.style.setProperty('--project-layers-height',height+'px');divider.setAttribute('aria-valuenow',String(Math.round(height)));
    try{localStorage.setItem('wirenexus-layers-panel-height',String(height));}catch{}
  };
  divider.onpointerdown=e=>{resize={y:e.clientY,height:panel.getBoundingClientRect().height};divider.setPointerCapture(e.pointerId);e.preventDefault();};
  divider.onpointermove=e=>{if(resize)resizeTo(resize.height+resize.y-e.clientY);};
  divider.onpointerup=divider.onpointercancel=()=>{resize=null;};
  divider.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resizeTo(panel.getBoundingClientRect().height+(e.key==='ArrowUp'?20:-20));}};
  try{const h=Number(localStorage.getItem('wirenexus-layers-panel-height'));if(h)resizeTo(h);}catch{}

  function render() {
    if (documentIdentity!==api.documentIdentity()) {
      documentIdentity=api.documentIdentity();known.clear();
      for(const entry of layerObjects(api.state()))known.set(entry.collection+':'+entry.id,entry.object.layerId || null);
      selected=api.state().activeLayerId || DEFAULT_LAYER_ID;
    }
    assignNewObjectsToLayer(api.state(),known);
    const layers=projectLayers(api.state()),selection=entries();
    if(!layers.some(layer=>layer.id===selected)) selected=DEFAULT_LAYER_ID;
    const key=JSON.stringify([layers,selected,selection.map(e=>[e.collection,e.id,e.object.layerId]),busy]);
    if(key===lastKey)return;lastKey=key;
    list.replaceChildren();
    [...layers].reverse().forEach(layer=>{
      const row=document.createElement('div');row.className='project-layer-row';row.dataset.layerId=layer.id;
      row.classList.toggle('active',selected===layer.id);row.setAttribute('role','listitem');row.draggable=true;
      row.append(button(layer.visible?'layer-eye':'layer-hidden',`${layer.visible?'Hide':'Show'} layer ${layer.name}`,()=>commit('Toggle layer visibility',draft=>{draft.layers.find(l=>l.id===layer.id).visible=!layer.visible;})),
        button(layer.locked?'layer-lock':'layer-unlock',`${layer.locked?'Unlock':'Lock'} layer ${layer.name}`,()=>commit('Toggle layer lock',draft=>{draft.layers.find(l=>l.id===layer.id).locked=!layer.locked;})));
      const name=document.createElement('input');name.value=layer.name;name.setAttribute('aria-label','Layer name');name.maxLength=120;
      name.onfocus=()=>{selected=layer.id;api.state().activeLayerId=layer.id;};
      name.onchange=()=>{const value=name.value.trim();if(value && value!==layer.name)commit('Rename layer',draft=>{draft.layers.find(l=>l.id===layer.id).name=value;});else name.value=layer.name;};
      name.onkeydown=e=>{if(e.key==='Enter')name.blur();if(e.key==='Escape'){name.value=layer.name;name.blur();}};
      row.append(name);row.onclick=e=>{if(!e.target.closest('button'))choose(layer.id);};
      row.ondragstart=e=>{if(e.target===name){e.preventDefault();return;}dragId=layer.id;e.dataTransfer.setData('application/x-wirenexus-layer',layer.id);e.dataTransfer.effectAllowed='move';row.classList.add('dragging');};
      row.ondragover=e=>{if(dragId && dragId!==layer.id){e.preventDefault();row.classList.add('drop-target');}};
      row.ondragleave=()=>row.classList.remove('drop-target');
      row.ondrop=e=>{if(!dragId || dragId===layer.id)return;e.preventDefault();const source=dragId;dragId='';move(source,layers.findIndex(l=>l.id===layer.id));};
      row.ondragend=()=>{dragId='';lastKey='';render();};list.append(row);
    });
    assignment.replaceChildren();
    const currentIds=new Set(selection.map(e=>e.object.layerId || DEFAULT_LAYER_ID));
    if(currentIds.size!==1){const option=new Option(selection.length?'Mixed':'No selection','');assignment.add(option);}
    layers.forEach(layer=>assignment.add(new Option(layer.name,layer.id)));
    assignment.value=currentIds.size===1?[...currentIds][0]:'';
    assignment.disabled=!selection.length || selection.some(e=>layers.find(l=>l.id===(e.object.layerId || DEFAULT_LAYER_ID))?.locked);
    const selectedIndex=layers.findIndex(l=>l.id===selected),buttons=tools.querySelectorAll('button');
    const target=layers[selectedIndex];
    buttons[1].disabled=busy || target.locked || !target.visible;buttons[2].disabled=selectedIndex>=layers.length-1;buttons[3].disabled=selectedIndex<=0;buttons[4].disabled=selected===DEFAULT_LAYER_ID;
  }

  async function choosePdfPage(pdf) {
    const dialog=document.createElement('dialog');dialog.className='venue-pdf-dialog';
    dialog.innerHTML='<h2>Import PDF page</h2><label>Page <input type="number" min="1" step="1" value="1" aria-label="PDF page"></label><span class="pdf-page-count"></span><img alt="PDF page preview"><p role="status"></p><footer><button type="button" class="tool-button" data-cancel>Cancel</button><button type="button" class="primary-button" data-import>Import page</button></footer>';
    dialog.querySelector('.pdf-page-count').textContent=` of ${pdf.numPages}`;
    const input=dialog.querySelector('input');input.max=pdf.numPages;
    document.body.append(dialog);dialog.showModal();
    let sequence=0,rendered=null;
    const preview=async()=>{
      const token=++sequence;rendered=null;dialog.querySelector('[data-import]').disabled=true;
      try{const number=Number(input.value),image=await renderReferencePdfPage(pdf,number);
        if(token!==sequence||!dialog.open)return;
        rendered={...image,sourcePdfPage:number};dialog.querySelector('img').src=image.image;
        dialog.querySelector('[role=status]').textContent='';dialog.querySelector('[data-import]').disabled=false;
      }catch(error){if(token===sequence)dialog.querySelector('[role=status]').textContent=error.message;}
    };
    input.onchange=preview;preview();
    return new Promise(resolve=>{
      let result=null;dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
      dialog.querySelector('[data-import]').onclick=()=>{if(rendered){result=rendered;dialog.close();}};
      dialog.onclose=()=>{sequence++;dialog.remove();resolve(result);};
    });
  }

  fileInput.onchange=async()=>{
    const file=fileInput.files[0];fileInput.value='';if(!file || busy)return;
    const destination=projectLayers(api.state()).find(layer=>layer.id===selected);
    if(!destination?.visible || destination.locked){api.error('Choose a visible, unlocked layer before importing.');return;}
    const target=api.documentIdentity(),layerId=selected;
    busy=true;render();let pdf=null;
    try{
      const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
      if(!isPdf && file.type!=='image/png' && !/\.png$/i.test(file.name))throw new Error('Choose a PNG or PDF file.');
      const image=isPdf ? await choosePdfPage(pdf=await loadReferencePdf(file)) : await readReferencePng(file);
      if(!image || api.documentIdentity()!==target)return;
      const center=api.center(),scale=Math.min(1,800/image.naturalWidth,600/image.naturalHeight);
      const id='reference-'+crypto.randomUUID();
      commit('Import venue layout',draft=>{
        const layer=draft.layers.find(l=>l.id===layerId);
        if(!layer || layer.locked || !layer.visible)throw new Error('Choose a visible, unlocked layer before importing.');
        draft.imageObjects.push({id,name:file.name,...image,referenceImage:true,
          x:center.x-image.naturalWidth*scale/2,y:center.y-image.naturalHeight*scale/2,
          width:image.naturalWidth*scale,height:image.naturalHeight*scale,rotation:0,opacity:1,layerId});
      });
      api.select(id);
    }catch(error){api.error(error.message);}finally{
      busy=false;lastKey='';render();
      pdf?.loadingTask.destroy().catch(error=>console.warn('PDF reference cleanup failed',error));
    }
  };

  function renderReferenceInspector(host, id) {
    const image=api.state().imageObjects?.find(item=>item.id===id);if(!image)return false;
    host.replaceChildren();
    const heading=document.createElement('h3');heading.textContent=image.name || 'Reference image';host.append(heading);
    const locked=projectLayers(api.state()).find(l=>l.id===(image.layerId || DEFAULT_LAYER_ID))?.locked;
    const fields=[['x','X',1],['y','Y',1],['width','Width',1],['height','Height',1],['rotation','Rotation',1],['opacity','Opacity',.01]];
    const scaleLabel=document.createElement('label');scaleLabel.className='project-reference-field';scaleLabel.textContent='Scale (%)';
    const scaleInput=document.createElement('input');scaleInput.type='number';scaleInput.min='1';scaleInput.step='1';scaleInput.value=Number((100*image.width/image.naturalWidth).toFixed(2));scaleInput.disabled=locked;
    scaleInput.setAttribute('aria-label','Reference scale');scaleInput.onchange=()=>{
      const scale=Number(scaleInput.value)/100;if(!(scale>0 && Number.isFinite(scale)))return;
      commit('Scale reference image',draft=>{const next=draft.imageObjects.find(i=>i.id===id);next.width=next.naturalWidth*scale;next.height=next.naturalHeight*scale;});
    };scaleLabel.append(scaleInput);host.append(scaleLabel);
    for(const [key,title,step] of fields){
      const label=document.createElement('label');label.className='project-reference-field';label.textContent=title;
      const input=document.createElement('input');input.type=key==='opacity'?'range':'number';input.step=step;input.value=image[key] ?? (key==='opacity'?1:0);input.disabled=locked;
      input.setAttribute('aria-label','Reference '+title);if(key==='opacity'){input.min=0;input.max=1;}
      if(key==='width'||key==='height')input.min=1;
      input.onchange=()=>{
        const value=Number(input.value);if(!Number.isFinite(value) || ((key==='width'||key==='height')&&value<=0))return;
        commit('Edit reference image',draft=>{const next=draft.imageObjects.find(i=>i.id===id);next[key]=key==='opacity'?Math.max(0,Math.min(1,value)):value;});
      };label.append(input);host.append(label);
    }
    return true;
  }
  render();return {render,renderReferenceInspector,commit,entries};
}

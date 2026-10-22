import {cloneHistoryValue} from './engine/historyClone.js';

// Compare authored JSON data without serializing/copying embedded PNG strings.
export function projectContentEqual(a, b) {
  if (a===b || Object.is(a,b)) return true;
  if (!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if(a.length!==b.length)return false;
    for(let index=0;index<a.length;index++)if(!projectContentEqual(a[index],b[index]))return false;
    return true;
  }
  const keys=Object.keys(a).filter(key=>a[key]!==undefined), other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length && keys.every(key=>Object.hasOwn(b,key) && projectContentEqual(a[key],b[key]));
}

export function createProjectUnsavedGuard({read, target=window}) {
  let generation=0, baseline, disposed=false;
  const capture=()=>({generation,value:cloneHistoryValue(read())});
  const reset=()=>{generation++;baseline=capture().value;};
  const isDirty=()=>!disposed && !projectContentEqual(read(),baseline);
  const beforeunload=event=>{
    let dirty;
    try {dirty=isDirty();} catch {dirty=!disposed;}
    if(dirty){event.preventDefault();event.returnValue='';}
  };
  reset();
  target.addEventListener('beforeunload',beforeunload);
  return {
    capture, reset, isDirty,
    markSaved(checkpoint) {
      if(disposed || !checkpoint || checkpoint.generation!==generation)return false;
      baseline=checkpoint.value;
      return true;
    },
    dispose(){disposed=true;target.removeEventListener('beforeunload',beforeunload);baseline=null;}
  };
}

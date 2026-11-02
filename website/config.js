// Relative by default so local preview opens the existing application, not staging.
// Set an approved absolute application URL here only when hosting is authorized.
export const appUrl = typeof VIDEOCORE_APP_URL==='string'?VIDEOCORE_APP_URL:'../index.html';
export const products = [{name:'WireNexus',href:'./wirenexus.html',category:'AV system design',
  description:'From the first connection to the final cable schedule.'}];

export function applicationUrl(base, destination=appUrl){
  const url=new URL(destination,base);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Application links require an HTTP(S) URL without credentials.');
  return url.href;
}

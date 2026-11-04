// Relative by default so local preview opens the existing application, not staging.
// Set an approved absolute application URL here only when hosting is authorized.
export const appUrl = typeof VIDEOCORE_APP_URL==='string'?VIDEOCORE_APP_URL:'../index.html';
export const products = [{name:'WireNexus',href:'./wirenexus.html',category:'AV system design',image:'./assets/wirenexus-designer.png',
  description:'Design signal paths, connect devices and prepare the technical handover.'},
  {name:'LEDForge',href:'./ledforge.html',category:'LED screen planning',image:'./assets/ledforge-workspace.png',imageWidth:1750,imageHeight:1150,
    description:'Plan panel layouts, review screen calculations and explore 3D dimensions.'}];

export function applicationUrl(base, destination=appUrl){
  const url=new URL(destination,base);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Application links require an HTTP(S) URL without credentials.');
  return url.href;
}

export function communityEndpoint(){
  const url=new URL(typeof VIDEOCORE_COMMUNITY_API_URL==='string'?VIDEOCORE_COMMUNITY_API_URL:'/api/community-devices',globalThis.location?.href || 'http://localhost/');
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)throw Error('Invalid Community API URL.');return url.href;
}

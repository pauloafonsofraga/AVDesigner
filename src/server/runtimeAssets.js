import path from 'node:path';

const roots=new Set(['index.html','engine-prototype.html','output-viewer.html','viewer.html','VideoCoreLogo.png','data/factory-catalogue.json']);
const images=new Set(['.png','.svg','.webp','.jpg','.jpeg','.gif','.ico']);
const runtime=new Set([...images,'.js','.mjs','.json','.css','.wasm','.bcmap','.pfb','.ttf','.woff','.woff2']);
export function isPublicRuntimeAsset(file) {
  if(typeof file!=='string'||file.includes('\\')||file.split('/').some(p=>!p||p.startsWith('.')||p==='..'))return false;
  if(roots.has(file))return true;
  const extension=path.posix.extname(file).toLowerCase();
  if(file.startsWith('src/')&&!file.startsWith('src/server/'))return ['.js','.json','.mjs','.css','.wasm'].includes(extension);
  if(file.startsWith('assets/'))return runtime.has(extension);
  if(/^(Devices\/faceplates|Nodes|icons|logos)\//.test(file))return images.has(extension);
  return false;
}
export const runtimeContentType=file=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.ico':'image/x-icon','.wasm':'application/wasm',
  '.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2'}[path.posix.extname(file).toLowerCase()]||'application/octet-stream');

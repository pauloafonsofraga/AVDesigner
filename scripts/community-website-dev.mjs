import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {isPublicRuntimeAsset,runtimeContentType} from '../src/server/runtimeAssets.js';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.PORT || 8806);
const websiteNames=new Set(['site.js','site.css','config.js','library.js','library.css','wirenexus.html','ledforge.html','pricing.html']);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local.invalid');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/api/community-devices'){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Community publishing is disabled.'}));return;}
  if(url.pathname==='/account-config.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"configured":false}');return;}
  if(url.pathname==='/wirenexus/library'){res.writeHead(302,{Location:'/wirenexus/library/'});res.end();return;}
  let file;try{file=decodeURIComponent(url.pathname).slice(1);}catch{res.writeHead(400);res.end();return;}
  if(!file)file='website/index.html';
  else if(file==='wirenexus/library/' || file==='wirenexus/library/index.html')file='website/wirenexus/library/index.html';
  else if(file==='wirenexus/library/device.html')file='website/wirenexus/library/device.html';
  else if(websiteNames.has(file))file='website/'+file;
  else if(file.startsWith('assets/') && !file.includes('..')){try{await stat(path.join(root,'website',file));file='website/'+file;}catch{}}
  if(file.endsWith('/'))file+='index.html';
  if(file.includes('..') || file.includes('\\') || file.split('/').some(p=>p.startsWith('.')) || !(file.startsWith('website/') || isPublicRuntimeAsset(file))){res.writeHead(404);res.end();return;}
  try{const bytes=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':runtimeContentType(file)});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local VideoCore library: http://127.0.0.1:${port}/wirenexus/library/ (publishing disabled)`));

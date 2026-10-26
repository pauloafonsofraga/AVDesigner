import {engineConnectorCanvasLabelLines,engineConnectorPlugTypeLabel} from './connectorCompatibility.js';

export function sharedBusTypeLabels(members=[]) {
  const labels=members.map(c=>{
    const lines=engineConnectorCanvasLabelLines(c);
    return String(lines.length>1?lines.at(-1):engineConnectorPlugTypeLabel(c)).trim();
  }).filter(Boolean);
  return [...new Map(labels.map(label=>[label.toLowerCase(),label])).values()];
}

export function abbreviatedConnectorLabel(label) {
  return label.replace(/Mini[- ]Display ?Port/gi,'Mini DP').replace(/Display ?Port/gi,'DP')
    .replace(/Component Video\s*\(YPbPr\)/gi,'YPbPr').replace(/SFP\+? Cage/gi,match=>match.replace(/ Cage/i,''))
    .replace(/USB[- ]Type[- ]/gi,'USB-');
}

export function adaptiveSharedBusLabel(labels,width,measure) {
  const unique=[...new Map(labels.filter(Boolean).map(label=>[label.toLowerCase(),label])).values()];
  const fullText=unique.join(' / ');
  if(!unique.length)return {text:'',mode:'hidden',fullText};
  const candidates=[[fullText,'full'],[unique.map(abbreviatedConnectorLabel).join(' / '),'abbreviated'],
    [`${unique.length} type${unique.length===1?'':'s'}`,'summary']];
  for(const [text,mode] of candidates)if(text && measure(text)<=width)return {text,mode,fullText};
  return {text:'',mode:'hidden',fullText};
}

// Screen/world units are supplied consistently by the caller. Baselines never move.
export function resolveSharedBusLabels(rows,obstacles,measure,gap=2) {
  const result=new Map();
  for(const row of rows) {
    const direction=row.side==='right'?-1:1,pad=row.padding||0;
    let edge=direction>0?row.right:row.left;
    const overlaps=other=>row.top<other.y+other.height+gap&&row.top+row.height+gap>other.y;
    for(const other of rows)if(other!==row&&other.side!==row.side
      &&overlaps({y:other.top,height:other.height})&&(other.x-row.x)*direction>0)
      edge=direction>0?Math.min(edge,(row.x+other.x)/2-gap):Math.max(edge,(row.x+other.x)/2+gap);
    const start=Math.max(row.x*direction,(direction>0?row.left:row.right)*direction+pad),end=edge*direction-pad;
    const withinHeight=(row.minTop==null||row.top>=row.minTop)&&(row.bottom==null||row.top+row.height<=row.bottom);
    let intervals=end>start&&withinHeight?[[start,end]]:[];
    const blockers=[...obstacles,...[...result.values()].filter(p=>p.text).map(p=>p.rect)];
    for(const obstacle of blockers)if(obstacle.owner!==row.key&&overlaps(obstacle)) {
      const a=Math.min(obstacle.x*direction,(obstacle.x+obstacle.width)*direction)-gap-pad;
      const b=Math.max(obstacle.x*direction,(obstacle.x+obstacle.width)*direction)+gap+pad;
      intervals=intervals.flatMap(([lo,hi])=>b<=lo||a>=hi?[[lo,hi]]:
        [...(a>lo?[[lo,a]]:[]),...(b<hi?[[b,hi]]:[])]);
    }
    const options=intervals.map(([lo,hi])=>({...adaptiveSharedBusLabel(row.labels,hi-lo,text=>measure(text,row)),x:lo*direction}));
    const rank={full:0,abbreviated:1,summary:2,hidden:3};
    options.sort((a,b)=>rank[a.mode]-rank[b.mode]||Math.abs(a.x-row.x)-Math.abs(b.x-row.x));
    const label=options.find(o=>o.text)||{...adaptiveSharedBusLabel(row.labels,0,text=>measure(text,row)),x:row.x};
    const width=label.text?measure(label.text,row):0;
    result.set(row.key,{...label,dx:label.x-row.x,dy:0,unresolved:false,
      rect:{x:label.x-(direction<0?width:0)-pad,y:row.top,width:width?width+2*pad:0,height:row.height}});
  }
  return result;
}

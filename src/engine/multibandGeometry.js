export function multibandCableWidth(normalWidth, colors) {
  const count=Array.isArray(colors) ? colors.filter(Boolean).length : 0;
  return count>1 ? normalWidth*count*.5 : normalWidth;
}

// Adjacent bands share exact boundary vertices at every routed path sample.
// Bounded miter joins keep corners closed without long spikes at reversals.
export function multibandWirePolygons(points, width, colors) {
  const path = [];
  for (const p of points || []) if (Number.isFinite(p.x) && Number.isFinite(p.y)
    && (!path.length || Math.hypot(p.x-path.at(-1).x,p.y-path.at(-1).y)>1e-7)) path.push(p);
  if (path.length<2 || !(width>0) || !colors?.length) return [];
  const normals = path.slice(1).map((p,i)=>{
    const dx=p.x-path[i].x,dy=p.y-path[i].y,l=Math.hypot(dx,dy);return {x:-dy/l,y:dx/l};
  });
  const joins = path.map((p,i)=>{
    if (!i) return normals[0];if(i===path.length-1)return normals.at(-1);
    const a=normals[i-1],b=normals[i],x=a.x+b.x,y=a.y+b.y,length=Math.hypot(x,y);
    if(length<1e-7)return b;
    const scale=Math.min(1/Math.max(1e-8,1+a.x*b.x+a.y*b.y),2/length);
    return {x:x*scale,y:y*scale};
  });
  const boundaries=Array.from({length:colors.length+1},(_,i)=>path.map((p,j)=>{
    const offset=width*(i/colors.length-.5);return {x:p.x+joins[j].x*offset,y:p.y+joins[j].y*offset};
  }));
  return colors.flatMap((color,i)=>path.slice(1).map((_,j)=>({color,
    points:[boundaries[i][j],boundaries[i][j+1],boundaries[i+1][j+1],boundaries[i+1][j]]})));
}

function clipVertical(points, x, keepRight) {
  const result=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    const inside=p=>keepRight?p.x>=x:p.x<=x;
    if(inside(a))result.push(a);
    if(inside(a)!==inside(b)){const t=(x-a.x)/(b.x-a.x);result.push({x,y:a.y+(b.y-a.y)*t});}
  }
  return result;
}
export function multibandNodePolygons(point, radius, colors) {
  if(!(radius>0) || !colors?.length)return [];
  const circle=Array.from({length:96},(_,i)=>({x:point.x+radius*Math.cos(i*Math.PI/48),y:point.y+radius*Math.sin(i*Math.PI/48)}));
  return colors.map((color,i)=>({color,points:clipVertical(clipVertical(circle,
    point.x-radius+i*2*radius/colors.length,true),point.x-radius+(i+1)*2*radius/colors.length,false)}));
}

export function labelRectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

// Ephemeral display rectangles only. Nothing in this resolver owns node geometry.
export function resolveConnectorLabelCollisions(rows, obstacles = [], gap = 2) {
  const placed = [], result = new Map();
  const ordered = [...rows].sort((a,b) => a.rect.y-b.rect.y || a.rect.x-b.rect.x || a.key.localeCompare(b.key));
  for (const row of ordered) {
    const {rect, bounds} = row;
    const blockers = [...obstacles, ...placed];
    const translated = (dx,dy) => ({...rect,x:rect.x+dx,y:rect.y+dy});
    const available = r => !blockers.some(b=>labelRectsOverlap(r,b,gap));
    let offset = {dx:0,dy:0};
    if (!available(rect)) {
      const limit = row.maxShift ?? Math.max(54,rect.height*4);
      const near = blockers.filter(b=>b.y+b.height>=rect.y-limit && b.y<=rect.y+rect.height+limit);
      const ys = new Set([0]), xs = new Set([0]);
      for(const b of near) {
        ys.add(b.y+b.height+gap-rect.y);ys.add(b.y-gap-rect.y-rect.height);
        xs.add(b.x+b.width+gap-rect.x);xs.add(b.x-gap-rect.x-rect.width);
      }
      const candidates = [...ys].map(dy=>({dx:0,dy}));
      // A second column is useful when a dense short card has no vertical gap.
      for(const dx of [...xs].sort((a,b)=>Math.abs(a)-Math.abs(b)).slice(0,8)) {
        candidates.push({dx,dy:0});
        for(const dy of [...ys].sort((a,b)=>Math.abs(a)-Math.abs(b)).slice(0,8)) candidates.push({dx,dy});
      }
      candidates.sort((a,b)=>Math.abs(a.dy)+1.5*Math.abs(a.dx)-Math.abs(b.dy)-1.5*Math.abs(b.dx) || a.dy-b.dy || a.dx-b.dx);
      for(const candidate of candidates) {
        if(Math.abs(candidate.dx)>(row.maxHorizontalShift ?? Math.max(limit,rect.width+gap)) || Math.abs(candidate.dy)>limit)continue;
        const r=translated(candidate.dx,candidate.dy);
        if(bounds && (r.x<bounds.x || r.y<bounds.y || r.x+r.width>bounds.x+bounds.width || r.y+r.height>bounds.y+bounds.height))continue;
        if(available(r)){offset=candidate;break;}
      }
    }
    const resolved=translated(offset.dx,offset.dy);
    result.set(row.key,{...offset,rect:resolved,unresolved:!available(resolved)});
    placed.push(resolved);
  }
  return result;
}

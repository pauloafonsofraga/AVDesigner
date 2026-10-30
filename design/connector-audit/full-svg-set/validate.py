#!/usr/bin/env python3
"""Check review geometry, provenance, counts, alias consistency and size-render records."""
import json,re,subprocess,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];NS='{http://www.w3.org/2000/svg}'
rows=json.loads((HERE/'index.json').read_text());inv=json.loads((ROOT/'connector-inventory.json').read_text())['connectors'];expected={c['type']:c for c in inv}
assert len(rows)==len(expected)==78 and len({r['type'] for r in rows})==78
assert set(expected)=={p.stem for p in HERE.glob('*.svg')}=={r['type'] for r in rows}
GEOM={'x','y','cx','cy','r','rx','ry','width','height','d','points','x1','x2','y1','y2','transform'}
SHAPES={'g','path','circle','ellipse','rect','polygon','polyline','line'}
def signature(root,groups=True):
 return [(e.tag.split('}')[-1],tuple(sorted((k,v) for k,v in e.attrib.items() if k in GEOM))) for e in root.iter() if e.tag.split('}')[-1] in SHAPES and (groups or e.tag!=NS+'g')]
trees={};studies=set();retained=set();bytype={r['type']:r for r in rows}
statuses={'review-needed','source-observed','abstract-configuration','family-reference-checked','model-reference-checked'}
for r in rows:
 assert {'type','name','source_basis','output_svg','notes','verification_status','source_urls','remaining_issues','checked_aspects','framing','thumbnail_sizes_px','reviewed_against','thumbnail_status'}<=set(r)
 assert r['name']==expected[r['type']]['name'] and r['reviewed_against']==expected[r['type']]['thumbnail_source_path']
 assert r['verification_status'] in statuses and r['notes'] and r['remaining_issues']
 assert r['source_urls'] and all(u.startswith('https://') and 'search?' not in u for u in r['source_urls'])
 assert r['thumbnail_sizes_px']==[32,64,128]
 p=ROOT/r['output_svg'];assert p==HERE/(r['type']+'.svg')
 raw=p.read_text();tree=ET.fromstring(raw);trees[r['type']]=tree
 assert tree.get('viewBox')=='0 0 256 256' and tree.get('preserveAspectRatio')=='xMidYMid meet'
 assert tree.get('width')==tree.get('height')=='256'
 artwork=tree.find(NS+"g[@id='artwork']");assert artwork is not None
 assert re.fullmatch(r'translate\(128 128\) scale\([0-9.]+\) translate\([-0-9.]+ [-0-9.]+\)',artwork.get('transform'))
 for e in tree.iter():
  assert e.get('preserveAspectRatio')!='none'
  for value in re.findall(r'scale\(([^)]+)\)',e.get('transform','')):
   parts=[float(x) for x in re.split('[ ,]+',value.strip())]
   assert len(parts)==1 or len(parts)==2 and abs(abs(parts[0])-abs(parts[1]))<1e-8,('Nonuniform scale',r['type'],value)
 ids=[e.get('id') for e in tree.iter() if e.get('id')];assert len(ids)==len(set(ids)),p
 assert set(re.findall(r'url\(#([^)]*)\)',raw))<=set(ids),p
 assert tree.find(NS+'title') is not None and tree.find(NS+'desc') is not None
 assert tree.find(NS+'text') is None # Captions do not consume icon pixels.
 assert not any(e.tag.split('}')[-1] in ('image','script','foreignObject','use') for e in tree.iter())
 assert not any(k.split('}')[-1]=='href' for e in tree.iter() for k in e.attrib)
 for basis in r['source_basis']:
  if ':design/connector-audit/svg/' not in basis:continue
  studies.add(basis)
  original=ET.fromstring(subprocess.check_output(['git','show',basis],cwd=ROOT))
  matches=[n for n in tree.iter(NS+'svg') if n is not tree and signature(original)==signature(n)]
  if matches:retained.add(basis)
  else:assert r['type']=='nema',('Unexpected source geometry change',r['type'],basis)
 if 'alternate_symbol_id' in r:
  assert len(list(tree.iter(NS+'symbol')))==1
  assert tree.find('.//'+NS+"symbol[@id='"+r['alternate_symbol_id']+"']") is not None
 # Source groups not being redesigned retain their primitive geometry from the previous commit.
 if r['review_action']=='preserve-and-reframe' and 'alternate_symbol_id' not in r:
  old=ET.fromstring(subprocess.check_output(['git','show','2b85236:'+r['output_svg']],cwd=ROOT))
  for d in list(old):
   if d.tag in (NS+'defs',NS+'text',NS+'title',NS+'desc'):old.remove(d)
  assert signature(old,False)==signature(artwork,False),('Unnecessary redesign',r['type'])
assert len(studies)==29 and len(retained)==28 # NEMA perimeter deliberately corrected; all other source studies remain.
for nested in [n for n in trees['socapex'].iter(NS+'svg') if n is not trees['socapex']]:
 cs=list(nested.iter(NS+'circle'))[4:];centers=Counter((e.get('cx'),e.get('cy')) for e in cs)
 assert len(cs)==38 and len(centers)==19 and set(centers.values())=={2}
counts={'ca-com':9,'domm':19,'aes':3,'xlr':3,'xlr-3pin':3,'xlr-5pin':5,'dmx-3pin':3,'dmx-5pin':5,'midi':5,'mini-din-6pin':6,'usb':4,'usb-a':4,'usb-b':4,'usb-c':24,'hdmi':19,'display-port':20,'mini-display-port':20,'dvi':29,'vga':15,'iec':3,'ethernet':8,'cat5e':8,'cat6':8,'cat6a':8,'ethercon':8,'nema':3}
for t,n in counts.items():assert sum(e.get('data-contact')=='1' for e in trees[t].iter())==n,(t,n)
assert sum(e.get('data-optical-channel')=='1' for e in trees['fiberfox'].iter())==4
for t,n in [('cxp',84),('speakon-nl2',2),('speakon-nl4',4),('speakon-nl8',8)]:
 assert bytype[t]['interface']['contact_count']==n and bytype[t]['interface']['hidden_contacts']
 assert not any(e.get('data-contact') for e in trees[t].iter()) # no invented visible pinout
for aliases in [('cat5e','cat6','cat6a','ethernet'),('usb','usb-a'),('phono','rca'),('jack','trs-ts'),('xlr','xlr-3pin','dmx-3pin'),('bnc','sdi'),('speakon','speakon-nl4')]:
 shapes=[ET.tostring(trees[t].find(NS+"g[@id='artwork']")) for t in aliases];assert len(set(shapes))==1,aliases
assert not list(trees['bnc'].iter(NS+'ellipse'))
# Ensure saved visual checks correspond exactly to current SVG bytes, not a stale contact sheet.
report=json.loads((HERE/'visual-checks.json').read_text());assert report['count']==78 and report['sizes_px']==[32,64,128]
for r in report['entries']:
 assert hashlib.sha256((HERE/(r['type']+'.svg')).read_bytes()).hexdigest()==r['svg_sha256']
 assert [s['size_px'] for s in r['renders']]==[32,64,128]
 for s in r['renders']:
  b=s['alpha_bbox'];n=s['size_px'];assert 0<b[0]<b[2]<n and 0<b[1]<b[3]<n
print(f'PASS: 78 mappings; 234 native-size renders; uniform framing, aliases, source geometry, explicit contacts and hidden-contact policy. Statuses: {dict(Counter(r["verification_status"] for r in rows))}')

#!/usr/bin/env python3
"""Review-asset checks only; no runtime behavior or wiring certification."""
import json,re,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
NS='{http://www.w3.org/2000/svg}'
rows=json.loads((HERE/'index.json').read_text())
inv=json.loads((ROOT/'connector-inventory.json').read_text())['connectors']
expected={c['type']:c for c in inv}
assert len(rows)==len(expected)==78
assert len({r['type'] for r in rows})==78
assert set(expected)=={p.stem for p in HERE.glob('*.svg')}=={r['type'] for r in rows}
GEOM={'x','y','cx','cy','r','rx','ry','width','height','d','points','x1','x2','y1','y2','transform','viewBox','preserveAspectRatio'}
SHAPES={'g','path','circle','ellipse','rect','polygon','polyline','line'}
def signature(root):
 return [(e.tag.split('}')[-1],tuple(sorted((k,v) for k,v in e.attrib.items() if k in GEOM))) for e in root.iter() if e.tag.split('}')[-1] in SHAPES]
trees={};studies=set()
for r in rows:
 assert set(r)=={'type','name','source_basis','output_svg','notes','verification_status'}
 assert r['name']==expected[r['type']]['name']
 assert r['verification_status']=='review-needed' and r['notes'] and r['source_basis']
 p=ROOT/r['output_svg'];assert p==HERE/(r['type']+'.svg')
 raw=p.read_text();tree=ET.fromstring(raw);trees[r['type']]=tree
 assert tree.get('viewBox')=='0 0 256 192'
 ids=[e.get('id') for e in tree.iter() if e.get('id')]
 assert len(ids)==len(set(ids)),p
 assert set(re.findall(r'url\(#([^)]*)\)',raw))<=set(ids),p
 assert tree.find(NS+'title') is not None and tree.find(NS+'desc') is not None
 assert not any(e.tag.split('}')[-1] in ('image','script','foreignObject','use') for e in tree.iter()),p
 assert not any(k.split('}')[-1]=='href' for e in tree.iter() for k in e.attrib),p
 nested=tree.findall(NS+'svg')
 for basis in r['source_basis']:
  if ':design/connector-audit/svg/' not in basis:continue
  studies.add(basis)
  original=ET.fromstring(subprocess.check_output(['git','show',basis],cwd=ROOT))
  assert any(signature(original)==signature(n) for n in nested),('Source geometry changed',r['type'],basis)
assert len(studies)==29
# Each source location has a rim and center circle; four preceding circles are body rings.
for nested in trees['socapex'].findall(NS+'svg'):
 cs=nested.findall('.//'+NS+'circle')[4:]
 centers=Counter((e.get('cx'),e.get('cy')) for e in cs)
 assert len(cs)==38 and len(centers)==19 and set(centers.values())=={2}
counts={'ca-com':9,'domm':19,'aes':3,'xlr':3,'xlr-3pin':3,'xlr-5pin':5,'dmx-3pin':3,'dmx-5pin':5,'midi':5,'mini-din-6pin':6,'speakon':4,'speakon-nl2':2,'speakon-nl4':4,'speakon-nl8':8,'usb':4,'usb-a':4,'usb-b':4,'usb-c':24,'hdmi':19,'display-port':20,'mini-display-port':20,'dvi':29,'vga':15,'iec':3,'ethernet':8,'cat5e':8,'cat6':8,'cat6a':8,'ethercon':8}
for t,n in counts.items():
 assert sum(e.get('data-contact')=='1' for e in trees[t].iter())==n,(t,n)
# Frontal BNC has concentric shell/dielectric; no perspective ellipses.
assert not trees['bnc'].findall('.//'+NS+'ellipse')
assert len(trees['bnc'].findall('.//'+NS+'circle'))==6
assert len(trees['powercon-true1'].findall(NS+'svg'))==2
assert trees['powercon-true1'].findall(NS+'svg')[0].get('id')=='inlet-svg1'
print('PASS: 78/78 mappings and standalone SVGs; all 29 source geometries retained; IDs, references, Socapex 19 per gender and explicit contact counts checked.')

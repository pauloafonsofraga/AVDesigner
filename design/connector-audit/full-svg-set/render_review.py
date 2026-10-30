#!/usr/bin/env python3
"""Render true-size review artifacts. Paste pixels 1:1; never resize an SVG render to fit a cell."""
import io,json,math,subprocess,hashlib,copy,xml.etree.ElementTree as ET
from framing import fit
from pathlib import Path
import cairosvg
from PIL import Image,ImageDraw
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
ROWS=json.loads((HERE/'index.json').read_text())
PREVIOUS='2b85236'
SIZES=(32,64,128)
OUT=HERE/'comparisons';OUT.mkdir(exist_ok=True)
def render(data,n):
 return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=data,output_width=n,output_height=n))).convert('RGBA')
def put(canvas,im,x,y):canvas.paste(im,(x,y),im)
def original(r,n):
 im=Image.open(ROOT/r['reviewed_against']).convert('RGBA');im.thumbnail((n,n),Image.Resampling.LANCZOS)
 o=Image.new('RGBA',(n,n));o.paste(im,((n-im.width)//2,(n-im.height)//2));return o
renders={};report=[]
for r in ROWS:
 raw=(ROOT/r['output_svg']).read_bytes();renders[r['type']]={n:render(raw,n) for n in SIZES}
 samples=[]
 for n,im in renders[r['type']].items():
  box=im.getchannel('A').getbbox();assert box and box[0]>0 and box[1]>0 and box[2]<n and box[3]<n,(r['type'],n,box)
  samples.append({'size_px':n,'alpha_bbox':list(box),'transparent_padding':True})
 report.append({'type':r['type'],'svg_sha256':hashlib.sha256(raw).hexdigest(),'renders':samples,'comparison_page':f'comparisons/page-{1+ROWS.index(r)//13:02d}.png','assessment':r['thumbnail_assessment']})
for n in SIZES:
 cellw=184;cellh=n+42;cols=6
 out=Image.new('RGB',(cols*cellw,math.ceil(len(ROWS)/cols)*cellh+32),'#202b35');d=ImageDraw.Draw(out)
 d.text((8,10),f'All 78 at {n} x {n} px | artwork pasted 1:1 | names outside SVG',fill='white')
 for i,r in enumerate(ROWS):
  x=i%cols*cellw;y=32+i//cols*cellh
  put(out,renders[r['type']][n],x+(cellw-n)//2,y)
  d.text((x+7,y+n+5),r['type'],fill='#c5d2dc')
  d.text((x+7,y+n+19),r['verification_status'],fill='#8fa5b7')
 out.save(HERE/('contact-sheet.png' if n==32 else f'contact-sheet-{n}px.png'))
for page in range(6):
 out=Image.new('RGB',(820,13*150+42),'#202b35');d=ImageDraw.Draw(out)
 for x,label in [(8,'TYPE'),(218,'ORIGINAL 128'),(360,'BEFORE 32'),(433,'AFTER 32'),(493,'AFTER 64'),(590,'AFTER 128')]:d.text((x,12),label,fill='white')
 for j,r in enumerate(ROWS[page*13:page*13+13]):
  y=42+j*150
  d.text((8,y+30),r['type'],fill='white');d.text((8,y+48),r['verification_status'],fill='#94aec1')
  put(out,original(r,128),218,y)
  old=subprocess.check_output(['git','show',PREVIOUS+':'+r['output_svg']],cwd=ROOT)
  put(out,render(old,32),374,y+48)
  for n,x in [(32,438),(64,493),(128,590)]:put(out,renders[r['type']][n],x,y+(128-n)//2)
 out.save(OUT/f'page-{page+1:02d}.png')
# Native-size dark/light comparison at 32px for every connector.
out=Image.new('RGB',(6*184,13*78+32),'#202b35');d=ImageDraw.Draw(out)
d.text((8,10),'32 px on dark and light | no interpolation or image resizing',fill='white')
for i,r in enumerate(ROWS):
 x=i%6*184;y=32+i//6*78
 d.rectangle((x+66,y,x+111,y+43),fill='#e4e9ec')
 put(out,renders[r['type']][32],x+20,y+5);put(out,renders[r['type']][32],x+73,y+5)
 d.text((x+7,y+48),r['type'],fill='#c5d2dc')
out.save(HERE/'contact-sheet-32px-backgrounds.png')
(HERE/'visual-checks.json').write_text(json.dumps({'renderer':'CairoSVG; direct rasterization at requested size, RGBA compositing 1:1','sizes_px':list(SIZES),'count':len(report),'entries':report},indent=2)+'\n')
print('Rendered 234 size samples, 4 contact sheets, six source/before/after comparison pages; no clipping.')

paired=[r for r in ROWS if 'alternate_symbol_id' in r]
out=Image.new('RGB',(800,len(paired)*90+32),'#202b35');d=ImageDraw.Draw(out)
d.text((8,10),'Embedded alternatives at 64 px | visible thumbnail form / preserved alternate',fill='white')
for i,r in enumerate(paired):
 y=32+i*90;d.text((8,y+20),r['type'],fill='white')
 d.text((180,y+20),r['visible_variant'],fill='#b8c8d4');put(out,renders[r['type']][64],290,y)
 old=ET.parse(ROOT/r['output_svg']).getroot();ns='{http://www.w3.org/2000/svg}'
 sym=next(e for e in old.iter(ns+'symbol') if e.get('id')==r['alternate_symbol_id'])
 root=ET.Element(ns+'svg',width='256',height='192',viewBox='0 0 256 192');root.append(copy.deepcopy(old.find(ns+'defs')))
 for child in sym:root.append(copy.deepcopy(child))
 fit(root);im=render(ET.tostring(root),64)
 d.text((410,y+20),r['embedded_alternate_variant'],fill='#b8c8d4');put(out,im,550,y)
out.save(HERE/'gender-variants-64px.png')

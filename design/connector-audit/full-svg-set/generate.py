#!/usr/bin/env python3
"""Rebuild the review set. Run from the repository root; no runtime files are written."""
import json, math, re, subprocess
from pathlib import Path
import xml.etree.ElementTree as ET
OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
INVENTORY=ROOT/'connector-inventory.json'
STUDY='31a93c09004a1146857db02d1389181fc1f2e7d5'
NS='http://www.w3.org/2000/svg'
ET.register_namespace('',NS)
Q=lambda t:'{'+NS+'}'+t
inventory=json.loads(INVENTORY.read_text())
def rect(x,y,w,h,fill='url(#polymer)',rx=3,extra=''):
 return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {extra}/>'
def circle(x,y,r,fill='url(#metal)',extra=''):
 return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" {extra}/>'
def path(d,fill='url(#metal)',extra=''):
 return f'<path d="{d}" fill="{fill}" {extra}/>'
def text(s,x=128,y=179,size=11,color='#c7d0d8'):
 from html import escape
 return f'<text x="{x}" y="{y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="{size}" fill="{color}">{escape(s)}</text>'
def contact(x,y,r=4,male=False):
 return f'<g data-contact="1" data-gender="{"male" if male else "female"}">'+circle(x,y,r+1,'#78818a')+circle(x,y,r,'url(#gold)' if male else '#080b0e')+(circle(x-.7,y-.7,r*.36,'#f3ddb0') if male else '')+'</g>'
def ring(n,r=32,cx=128,cy=80,offset=-90,male=False):
 return ''.join(contact(round(cx+r*math.cos(math.radians(offset+i*360/n)),3),round(cy+r*math.sin(math.radians(offset+i*360/n)),3),4,male) for i in range(n))
def roundbody():
 return circle(128,80,62)+circle(128,80,56,'url(#polymer)')+circle(128,80,47,'#141b23')+path('M 119 33 H 137 V 41 H 119 Z','#707d89')
def screws():
 return ''.join(circle(x,y,3,'#0b1016')+path(f'M {x-2} {y} h 4','none','stroke="#a9b4be" stroke-width="1"') for x,y in [(45,43),(211,117)])
def plate():
 return rect(32,30,192,100,'url(#polymer)',12,'stroke="#7d8994" stroke-width="2"')+screws()
def abstract(label,kind='config'):
 s=rect(43,38,170,88,'url(#metal)',10)+rect(48,43,160,78,'url(#polymer)',7)
 if kind=='cage':
  s+=rect(62,61,132,42,'#080d13',2,'stroke="#71808d" stroke-width="2"')
  s+=path('M 70 70 H 186 M 70 95 H 186','none','stroke="#445361" stroke-width="2" stroke-dasharray="5 5"')
 else:
  s+=path('M 72 82 H 103 M 153 82 H 184 M 128 57 V 66 M 128 98 V 108','none','stroke="#a0abb7" stroke-width="3"')+rect(108,67,40,30,'none',5,'stroke="#a0abb7" stroke-width="2" stroke-dasharray="4 3"')
 return s+text(label,128,148,10)+text('ABSTRACT • MODEL UNSPECIFIED',128,163,8,'#8e9ba8')
DEFS='''<defs>
<linearGradient id="metal" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#e1e7eb"/><stop offset=".3" stop-color="#9aa6b1"/><stop offset=".65" stop-color="#465360"/><stop offset="1" stop-color="#aab6c0"/></linearGradient>
<linearGradient id="polymer" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#56616b"/><stop offset=".45" stop-color="#252e37"/><stop offset="1" stop-color="#111820"/></linearGradient>
<radialGradient id="gold" cx=".35" cy=".25"><stop stop-color="#ffe6a6"/><stop offset=".6" stop-color="#c69d55"/><stop offset="1" stop-color="#705029"/></radialGradient>
</defs>'''
def embed_source(filename,x,y,w,h,prefix):
 raw=subprocess.check_output(['git','show',f'{STUDY}:design/connector-audit/svg/{filename}'],cwd=ROOT).decode()
 root=ET.fromstring(raw)
 # Strip editor-only metadata; preserve mechanical paths, transforms and contact coordinates.
 for parent in root.iter():
  for child in list(parent):
   if child.tag.split('}')[-1] in ['namedview','metadata']: parent.remove(child)
 for e in root.iter():
  for k in list(e.attrib):
   if k.startswith('{') and not k.startswith('{http://www.w3.org/XML/1998/namespace}'): del e.attrib[k]
 ids={e.attrib['id']:prefix+'-'+e.attrib['id'] for e in root.iter() if 'id' in e.attrib}
 for e in root.iter():
  for k,v in list(e.attrib.items()):
   if k=='id':e.set(k,ids[v])
   else:
    for old,new in ids.items():v=v.replace('url(#'+old+')','url(#'+new+')')
    e.set(k,v)
 # Apply a restrained material gradient to source solid fills without moving any geometry.
 defs=ET.SubElement(root,Q('defs'))
 palette={}
 for e in list(root.iter()):
  style=e.get('style','')
  m=re.search(r'(?:^|;)fill:(#[0-9a-fA-F]{6})(?:;|$)',style)
  if not m:continue
  color=m.group(1);rgb=[int(color[i:i+2],16) for i in (1,3,5)]
  if max(rgb)<45:continue
  if color not in palette:
   gid=prefix+'-finish-'+color[1:];palette[color]=gid
   grad=ET.SubElement(defs,Q('linearGradient'),id=gid,x1='0',y1='0',x2='.75',y2='1')
   for pos,factor in [('0',1.12),('.4',1),('1',.72)]:
    stop='#'+''.join(f'{min(255,round(v*factor)):02x}' for v in rgb)
    ET.SubElement(grad,Q('stop'),offset=pos,attrib={'stop-color':stop})
  e.set('style',style.replace('fill:'+color,'fill:url(#'+palette[color]+')'))
 root.attrib.update(x=str(x),y=str(y),width=str(w),height=str(h),preserveAspectRatio='xMidYMid meet')
 return ET.tostring(root,encoding='unicode')
def source_pair(files,labels):
 if files[0].startswith(('Harting','Powelock')):
  return ''.join(embed_source(f,18,15+i*74,220,53,'s'+str(i))+text(labels[i],128,79+i*74,9) for i,f in enumerate(files))
 return ''.join(embed_source(f,12+i*122,16,110,126,'s'+str(i))+text(labels[i],67+i*122,157,9) for i,f in enumerate(files))
def source_single(f):return embed_source(f,48,16,160,140,'s0')
def coax(color=None):
 return (circle(128,80,52,'url(#metal)')+rect(72,74,13,12,'url(#metal)',2)+rect(171,74,13,12,'url(#metal)',2)+circle(128,80,45,'#202b35')+circle(128,80,39,'url(#metal)')+circle(128,80,30,'#dfdaca')+circle(128,80,9,'url(#metal)')+circle(128,80,5,'#05090e')+(circle(128,80,48,'none',f'stroke="{color}" stroke-width="3"') if color else ''))
def rj45():
 s=rect(56,30,144,100,'url(#metal)',7)+path('M 73 45 H 183 V 109 H 154 V 122 H 102 V 109 H 73 Z','#0a1017')+rect(84,50,88,14,'#3c3427',1)
 for i in range(8):s+=rect(87+i*10,51,4,27,'url(#gold)',1,'data-contact="1"')
 return s+path('M 76 104 H 99 M 157 104 H 180','none','stroke="#83929e" stroke-width="3"')
def xlr(n,male=False):
 coords={3:[(110,66),(146,66),(128,101)],5:[(103,66),(128,58),(153,66),(110,100),(146,100)]}[n]
 return roundbody()+rect(115,20,26,10,'url(#metal)',2)+''.join(contact(x,y,6,male) for x,y in coords)
def usb(kind):
 if kind=='a':
  s=rect(47,45,162,72,'url(#metal)',3)+rect(55,52,146,58,'#090d12',1)+rect(64,79,128,21,'#343d46',1)
  for i in range(4):s+=rect(79+i*29,79,10,14,'url(#gold)',1,'data-contact="1"')
 elif kind=='b':
  s=path('M 88 30 H 168 L 192 54 V 124 H 64 V 54 Z')+path('M 93 39 H 163 L 181 58 V 114 H 75 V 58 Z','#0a1017')+rect(103,61,50,35,'#a7adb1',2)
  for x,y in [(94,53),(151,53),(94,101),(151,101)]:s+=rect(x,y,11,5,'url(#gold)',1,'data-contact="1"')
 else:
  s=rect(44,51,168,60,'url(#metal)',30)+rect(51,58,154,46,'#0a1017',23)+rect(64,75,128,12,'#64717a',6)
  for i in range(12):
   for y in (74,84):s+=rect(73+i*9.5,y,3,3,'url(#gold)',.5,'data-contact="1"')
 return s
sources={}
def use(files,labels=None):
 global current_basis
 current_basis=[f'{STUDY}:design/connector-audit/svg/{f}' for f in files]
 return source_pair(files,labels) if len(files)>1 else source_single(files[0])
rows=[]
for c in inventory['connectors']:
 t=c['type'];name=c['name'];notes=[];current_basis=[c.get('thumbnail_source_path','connector-inventory.json')];body=''
 if t[0].isdigit():
  amp=t.split('a')[0];phase='3ph' if ('3ph' in t or amp in ['63','125']) else '1ph';stem=f'{amp}-{phase}'+('110v' if '110v' in t else '')
  male=stem+('Male.svg' if stem=='32-1ph110v' else '-Male.svg')
  body=use([male,stem+'.svg'],['MALE','FEMALE']);notes+=['Both inventoried genders shown; original contact coordinates, clock/key and current markings retained. IEC CEE aliases use the same family.']
 elif t in ['socapex','harting','powerlock','powercon']:
  files,labels={'socapex':(['SocapexMale.svg','SocapexFemale.svg'],['MALE • 19','FEMALE • 19']),'harting':(['HartingMale.svg','HartingFemale.svg'],['MALE','FEMALE']),'powerlock':(['Powelock source.svg','Powelock drain.svg'],['SOURCE','DRAIN']),'powercon':(['powerCON_Blue.svg','powerCON_White.svg'],['BLUE • INPUT','WHITE • OUTPUT'])}[t]
  body=use(files,labels);notes+=['Source geometry retained, including distinct contact forms and standard source colors. Exact commercial insert/model and keying require review.']
  if t=='socapex':notes+=['19 contact locations in each gender; paired concentric circles are contact rim and center, not extra contacts.']
 elif t in ['uk-13a','schuko','nema']:
  body=use([{'uk-13a':'13A-UK.svg','schuko':'Schuko.svg','nema':'NEMA.svg'}[t]])
  notes+=['Original frontal socket geometry retained.']
  if t=='uk-13a':notes+=['Three recessed Type G slots; no added copper contacts.']
  if t=='nema':notes+=['NEMA configuration unspecified; retained source is only a visual study, not an assigned subtype.']
 elif t=='powercon-true1':
  # Combine the established keyed, gender-specific insert drawings in the real duplex panel topology.
  body=rect(19,27,218,105,'url(#polymer)',13,'stroke="#74838f" stroke-width="2"')+rect(85,20,86,10,'url(#polymer)',4)+rect(100,23,56,4,'#7c8992',1)
  for x in (29,227):
   for y in (38,121):body+=circle(x,y,4,'url(#metal)')+circle(x,y,2,'#080d12')
  body+=embed_source('powerCON_True1_Female.svg',39,37,82,82,'inlet')+embed_source('powerCON_True1_Male.svg',135,37,82,82,'outlet')+text('INLET • MALE',80,146,9)+text('OUTLET • FEMALE',177,146,9)
  current_basis+= [f'{STUDY}:design/connector-audit/svg/powerCON_True1_{g}.svg' for g in ('Male','Female')]+['https://www.neutrik.com/en/product/nac3px-top','https://www.neutrik.com/media/12881/download/st-nac3px-top.PDF?v=1','https://www.neutrik.com/uploads/media/400x/04/12844-NAC3PX-TOP.jpg?v=1-0']
  notes+=['Rebuilt as frontal combined inlet/outlet panel, using both source keyed inserts rather than a generic 3-pin circle. Source thumbnail shows duplex panel. IMPORTANT: source filenames invert the visible contact forms: the Female-named study has exposed blades (used for physical male inlet); the Male-named study has protected concentric socket structure (used for physical female outlet), reconciled against the manufacturer photo. Exact Seetronic/Neutrik generation, latch, aperture and mounting details still require model/photo verification; not a certified NAC3PX drawing.']
 elif t in ['bnc','sdi']:body=coax();notes+=['True frontal coaxial socket with concentric shell/dielectric, recessed center and opposed bayonet lugs; SDI reuses BNC geometry.']
 elif t in ['component-video','rgbhv']:
  cols=['#53a65b','#4282c6','#cf5454'] if t=='component-video' else ['#cf5454','#53a65b','#4282c6','#eeeeee','#777777']
  labels=['Y','Pb','Pr'] if len(cols)==3 else ['R','G','B','H','V']
  body=''
  for i,col in enumerate(cols):
   x=12+i*(232/len(cols));sc=232/len(cols)/114
   body+=f'<g transform="translate({x} 50) scale({sc}) translate(-71 -25)">'+coax(col)+'</g>'+text(labels[i],x+sc*57,145,10,col)
  notes+=['Grouped frontal BNC family; Y/Pb/Pr green/blue/red; RGBHV red/green/blue/white/gray. Separate hardware count preserved.']
 elif t in ['cat5e','cat6','cat6a','ethernet']:body=rj45();notes+=['8-position RJ45/8P8C socket rebuilt frontally from source; speed/category aliases do not change contact geometry.']
 elif t=='ethercon':body=roundbody()+f'<g transform="translate(56 37) scale(.56)">{rj45()}</g>';notes+=['Front-facing circular etherCON shell around an 8P8C aperture; exact latch/model requires review.']
 elif t in ['xlr','xlr-3pin','xlr-5pin','dmx-3pin','dmx-5pin','aes']:
  n=5 if '5pin' in t else 3;body=xlr(n,t=='aes');notes+= [f'{n} contacts; '+('male example retained from XLR_Output thumbnail.' if t=='aes' else 'female example follows source thumbnail; signal direction does not establish gender.')]
 elif t in ['usb','usb-a','usb-b','usb-c']:body=usb('b' if t=='usb-b' else 'c' if t=='usb-c' else 'a');notes+=['Front-facing receptacle; USB-A legacy 4, USB-B legacy 4, USB-C 24 contact positions. Exact USB generation/configuration unresolved.']
 elif t in ['rca','phono']:body=circle(128,80,51)+circle(128,80,40,'#bbc0ba')+circle(128,80,30,'url(#metal)')+circle(128,80,13,'#e2dfcf')+circle(128,80,6,'#080c11');notes+=['Frontal RCA female geometry shared by phono alias; no arbitrary channel color assigned.']
 elif t in ['jack','trs-ts']:body=circle(128,80,53,'url(#gold)')+circle(128,80,43,'#313941')+circle(128,80,34,'url(#gold)')+circle(128,80,25,'#090e14')+circle(128,80,16,'#252b32')+circle(128,80,12,'#03070b');notes+=['Frontal 6.35 mm jack socket family from TRS thumbnail; TS/TRS internal switching cannot be inferred from front view.']
 elif t in ['hdmi','display-port','mini-display-port']:
  hd=t=='hdmi';mini=t=='mini-display-port'
  silhouette='M 46 46 H 210 V 94 L 190 118 H 66 L 46 94 Z' if hd else 'M 48 43 H 208 V 118 H 69 L 48 97 Z'
  if mini:silhouette='M 48 43 H 208 V 118 H 48 Z'
  body=path(silhouette)+f'<g transform="translate(128 80) scale(.9) translate(-128 -80)">'+path(silhouette,'#0b1117')+'</g>'+rect(65,69,126,22,'#4c4e49',2)
  n=19 if hd else 20
  for i in range(n):body+=rect(71+i*114/(n-1),70 if i%2 else 84,2.8,6,'url(#gold)',.5,'data-contact="1"')
  if mini:body=f'<g transform="translate(128 80) scale(.8 .85) translate(-128 -80)">{body}</g>'
  notes+= [f'Frontal {n}-contact family study derived from thumbnail. Exact tongue, pitch and key/chamfer dimensions require model review.']
 elif t in ['vga','dvi']:
  body=path('M 50 44 Q 42 44 44 56 L 54 115 Q 55 122 64 122 H 192 Q 201 122 202 115 L 212 56 Q 214 44 206 44 Z')+path('M 57 52 H 199 L 190 113 H 66 Z','#1e344e' if t=='vga' else '#d0cdbb')
  if t=='vga':
   for row in range(3):
    for i in range(5):body+=contact(78+i*24+(4 if row%2 else 0),65+row*19,3)
  else:
   for y in (64,82,100):
    for i in range(8):body+=rect(65+i*13,y-3,5,6,'#12191e',0,'data-contact="1"')
   body+=rect(177,76,15,4,'#12191e',0,'data-contact="1"')
   for x in (178,190):
    for y in (64,96):body+=contact(x,y,2)
  for x in (30,226):body+=circle(x,82,10)+circle(x,82,4,'#0b1016')
  notes+=['15-contact VGA female.' if t=='vga' else 'DVI-I dual-link example follows source: 24 digital + 4 analog contacts + flat blade. Catalogue does not specify DVI variant.']
 elif t in ['midi','mini-din-6pin']:
  body=roundbody()
  coords=[(98,82),(107,103),(128,112),(149,103),(158,82)] if t=='midi' else [(105,65),(151,65),(105,91),(151,91),(116,110),(140,110)]
  body+=''.join(contact(x,y,4) for x,y in coords)
  if t=='mini-din-6pin':body+=rect(119,74,18,13,'#080b10',1)
  notes+=['5-contact 180-degree DIN MIDI frontal example.' if t=='midi' else '6-contact mini-DIN frontal example; source shows green/purple PS/2 alternatives. No signal-role color chosen.']
 elif t in ['speakon','speakon-nl2','speakon-nl4','speakon-nl8']:
  n=2 if t.endswith('nl2') else 8 if t.endswith('nl8') else 4
  body=plate()+circle(128,80,48,'#285da2')+circle(128,80,40,'url(#polymer)')+circle(128,80,31,'#131c25')+path('M 120 39 H 136 V 49 H 120 Z','#0a1117')+ring(n,23)
  notes+= [f'{n} contact positions; source circular shell/latch language retained. NL2/NL4/NL8 insert shapes and exact bayonet keying need part-specific verification.']
 elif t=='iec':
  body=plate()+path('M 95 41 H 161 L 181 63 V 117 H 75 V 63 Z')+path('M 99 48 H 157 L 172 66 V 109 H 84 V 66 Z','#0c1218')
  for x,y in [(124,60),(100,87),(148,87)]:body+=rect(x,y,8,17,'#03080c',0,'stroke="#667079" stroke-width="1" data-contact="1"')
  notes+=['IEC C13 female front, matching C13 source; 3 recessed rectangular contacts. Exact dimensions require model review.']
 elif t in ['fiber-lc','fiber-sc']:
  n=2 if t=='fiber-lc' else 1;body=''
  for i in range(n):
   x=62+i*70 if n==2 else 91
   body+=rect(x,31,64,99,'#397aaf',3,'stroke="#8db5d5" stroke-width="2"')+rect(x+7,39,50,81,'#12283c',1)+rect(x+17,58,30,44,'#03090f',1)+rect(x+21,39,22,10,'#74a4c9',1)
  notes+=['LC duplex blue adapter example.' if n==2 else 'SC simplex blue adapter example.'];notes+=['Front-facing source family; no visible electrical contacts. Blue is source finish, not a claim about all fiber/polish variants.']
 elif t in ['ca-com','domm']:
  n=9 if t=='ca-com' else 19
  body=plate()+roundbody()
  coords=[(128,80)]
  for count,radius in ([(8,31)] if n==9 else [(6,18),(12,36)]):
   coords += [(128+radius*math.cos(math.radians(-90+i*360/count)),80+radius*math.sin(math.radians(-90+i*360/count))) for i in range(count)]
  for x,y in coords:
   body+='<g data-contact="1">'+circle(x,y,4.7,'url(#gold)')+circle(x,y,2.5,'#080d12')+'</g>'
  if t=='domm':body+=path('M 167 76 H 179 V 85 H 167 Z','#080e14')
  notes += [f'{n} visible source-thumbnail contact locations rebuilt as a frontal circular insert; arrangement regularized from perspective artwork. Contact gender, exact key clocking and manufacturer insert require review.']
 elif t=='cxp':
  body=rect(40,35,176,95,'url(#metal)',4)+rect(49,46,158,73,'#0a1117',2)+rect(57,91,142,18,'#343f46',1)
  body+=path('M 58 55 H 198 M 58 59 H 198','none','stroke="#77828b" stroke-width="2"')
  for x in range(61,199,13):body+=rect(x,32,6,9,'url(#metal)',1)
  notes += ['Frontal shielded CXP module opening derived from source silhouette and spring cage; recessed interface deliberately leaves exact internal contact count unresolved, rather than asserting a pinout. Exact CXP generation requires review.']
 elif t=='fiberfox':
  body=plate()+circle(128,80,53,'#9e4d3c')+circle(128,80,46)+circle(128,80,38,'#27323e')+circle(128,80,28,'#adb7bd')+circle(128,80,20,'#1b2937')
  body+=path('M 119 33 H 137 V 41 H 119 Z','#0d1720')
  notes += ['Frontal rugged FiberFox circular shell and red collar based on source. Optical insert is abstract/shuttered; lens/fiber count and precise model remain unspecified.']
 elif t=='fiber-st':body=circle(128,80,48)+rect(75,73,13,14,'url(#metal)',2)+rect(168,73,13,14,'url(#metal)',2)+circle(128,80,37,'#313a42')+circle(128,80,27)+circle(128,80,15,'#dedbd0')+circle(128,80,8,'#090e13');notes+=['Frontal ST socket, two bayonet lugs and ceramic aperture based on source.']
 elif t=='fiber-mpo':
  body=plate()+rect(68,48,120,65,'#0a1117',4,'stroke="#81909c" stroke-width="2"')+rect(79,58,98,45,'#242e37',2)+rect(109,48,38,9,'#050a10',1)
  notes+=['MPO adapter opening rebuilt from source; no invented fiber count, ferrule pin gender or polish assigned.']
 elif t=='opticalcon':body=plate()+circle(128,80,47)+circle(128,80,40,'#15212b')+rect(108,58,40,46,'#828780',8)+path('M 112 55 H 144 V 65 H 112 Z','#121b22');notes+=['Source shuttered opticalCON panel front; underlying fiber configuration hidden, not invented. Exact series unresolved.']
 elif t=='new-node':body=circle(128,80,48)+circle(128,80,37,'url(#polymer)')+circle(128,80,23,'#080d13')+contact(128,80,6,True);current_basis=['connector-inventory.json: Barrel Jack configuration'];notes+=['Generic abstract barrel-jack family; center pin shown, no size/polarity assignment.']
 else:
  cage='cage' in t
  body=abstract(name,'cage' if cage else 'config')
  notes+=['Abstract review symbol: '+('empty cage opening, no installed module or electrical contact assignment.' if cage else 'catalogue entry lacks a precise physical model/configuration; no unverified pinout or contact count invented.')]
  if t in ['ca-com','domm','cxp','fiberfox']:notes+=['Source thumbnail consulted; exact insert/optical interface cannot be established reliably, so a deliberate abstract family symbol is used.']
  if t in ['edison','rs-422','new-node-3','new-node-4','new-node-5','qsfp','new-node-2']:notes+=['Physical implementation needs specification before a model-specific hardware drawing can replace this abstract.']
 notes+=['Review only; manufacturer/model verification incomplete.']
 if t in ['socapex','powerlock','harting']:
  notes+=['Paired wide groups are kept at their native aspect ratio; inspect the SVG enlarged for contact detail.']
 svg=f'<svg xmlns="{NS}" width="256" height="192" viewBox="0 0 256 192" role="img" aria-labelledby="title desc"><title id="title">{name.replace("&","&amp;")} — review study</title><desc id="desc">{(" ".join(notes)).replace("&","&amp;")}</desc>{DEFS}{body}{text(name)}</svg>\n'
 ET.fromstring(svg)
 (OUT/(t+'.svg')).write_text(svg)
 rows.append(dict(type=t,name=name,source_basis=current_basis,output_svg=f'design/connector-audit/full-svg-set/{t}.svg',notes=' '.join(notes),verification_status='review-needed'))
(OUT/'index.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
print(f'Generated {len(rows)} SVGs')

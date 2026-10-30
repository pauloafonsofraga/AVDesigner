"""Targeted corrections to existing studies; all coordinates are in the original authoring space."""
def correct(t, body, api):
 R,C,P,contact,embed=api
 changes=[]
 def flange(x=73,y=15,w=110,h=130):
  s=R(x,y,w,h,'url(#polymer)',9,'stroke="#8a959f" stroke-width="2"')
  for px,py in [(x+12,y+13),(x+w-12,y+h-13)]:s+=C(px,py,4,'url(#metal)')+C(px,py,2,'#091017')
  return s
 if t in ['ca-com','domm']:
  # Positions observed in source thumbnails, not a generic ring substitute or certified pinout.
  body=flange(59,12,138,136)+C(128,80,64)+C(128,80,58,'#151e27')+C(128,80,47,'#35414e')
  if t=='ca-com':
   xy=[(-15,-31),(15,-31),(-35,-13),(35,-13),(0,0),(-35,15),(35,15),(-15,34),(15,34)]
  else:
   # Preserve the staggered, rotated row field visible in DOMM.png instead of inventing 1+6+12 rings.
   observed=[(151,136),(178,147),(104,152),(131,164),(154,176),(92,181),(179,188),(206,198),(114,197),(141,209),(86,218),(171,220),(195,231),(110,231),(163,251),(99,260),(187,265),(125,274),(148,283)]
   # Approximate affine unprojection of the observed insert plane; uncertainty remains explicit.
   xy=[((x-145)*.50+(y-207)*.06,(y-207)*.45-(x-145)*.025) for x,y in observed]
  for x,y in xy:body+='<g data-contact="1">'+C(128+x,80+y,4.6,'url(#gold)')+C(128+x,80+y,2.4,'#080d12')+'</g>'
  body+=P('M 119 32 H 137 V 39 H 119 Z','#080d12')
  if t=='domm':body+=P('M 171 74 H 181 V 87 H 171 Z','#080d12')
  changes=['Removed invented wide flange and radial contact arrays; restored square circular-shell proportions and source-observed staggered contact field. Count is source-observed only (9/19); exact insert, gender and key clock remain unresolved.']
 elif t=='powercon-true1':
  # NAC3PX-TOP drawing: 61 x 35.4 mm flange, 28 mm center separation,
  # unequal 23.6 / 28.4 mm collars. Manufacturer reference example, not a Seetronic claim.
  k=3.2;x0=30.4;y0=23.36
  body=R(x0,y0,61*k,35.4*k,'url(#polymer)',11,'stroke="#8c98a2" stroke-width="1.8"')
  for x in (x0+5.5*k,x0+55.5*k):
   for y in (y0+5.5*k,y0+29.9*k):body+=C(x,y,4.7,'url(#metal)')+C(x,y,2.4,'#080d12')
  # Physical forms, not the reversed historical filenames, determine gender labels in metadata.
  body+=embed('powerCON_True1_Female.svg',x0+15.2*k-23.6*k/2,80-23.6*k/2,23.6*k,23.6*k,'inlet')
  body+=embed('powerCON_True1_Male.svg',x0+43.2*k-28.4*k/2,80-28.4*k/2,28.4*k,28.4*k,'outlet')
  changes=['Corrected 61:35.4 flange ratio, unequal 23.6/28.4 collars, 28 mm center separation and four mounting holes from NAC3PX-TOP front drawing. Removed invented top latch bar. Historical insert forms retained; exact blade/key profile still needs review. Original thumbnail has reversed outlet/inlet order; selected manufacturer example is inlet left/outlet right.']
 elif t=='fiberfox':
  # EBC15 4CH briDge: flange 26 x 31, collar diameter 28, not a wide rectangle.
  body=flange(63,2.5,130,155)+C(128,80,70,'#be563b')+C(128,80,65,'#202932')+C(128,80,60,'url(#metal)')+C(128,80,54,'#9b4937')+C(128,80,47,'url(#metal)')+C(128,80,38,'#8f9ba6')
  # Opposing open alignment jaws are mechanical features, not extra electrical contacts.
  body+=P('M 78 42 A 61 61 0 0 1 139 21 L 134 33 A 49 49 0 0 0 88 49 Z')
  body+=P('M 178 118 A 61 61 0 0 1 117 139 L 122 127 A 49 49 0 0 0 168 111 Z')
  for x,y in [(114,66),(142,66),(114,94),(142,94)]:
   body+='<g data-optical-channel="1">'+C(x,y,8,'#33434f')+C(x,y,5.7,'#5f91b0')+C(x-1,y-1,2.7,'#b1cbd9')+'</g>'
  changes=['Removed invented shutter and wide plate; restored D-flange, red collar, opposing alignment jaws and four expanded-beam lenses using NO4M4DW-FX photograph and front drawing. Hermaphroditic optical interface, not electrical pins. Exact catalog thumbnail part remains unassigned.']
 elif t=='cxp':
  body=R(33,35,190,90,'url(#metal)',4)+R(40,42,176,76,'#0a1117',2)+R(48,51,160,56,'#1c2730',1)+R(49,65,158,28,'#05090d',1)
  # CXP's 84 electrical positions are recessed at the back; they are not the EMI spring fingers.
  for x in range(49,208,14):
   body+=R(x,33,7,13,'url(#metal)',1)+R(x,114,7,12,'url(#metal)',1)
  body+=P('M 43 50 V 108 M 213 50 V 108','none','stroke="#99a5af" stroke-width="3"')
  changes=['Corrected front cage opening proportions and paired top/bottom EMI spring treatment. Removed false bottom tongue. TE 2149152-1 confirms 84 internal positions; recessed contacts are not invented at the mouth. Source model cannot be uniquely assigned.']
 elif t in ['hdmi','display-port','mini-display-port']:
  if t=='hdmi':
   outline='M 33 48 H 223 V 88 L 207 110 H 49 L 33 88 Z';inner='M 40 55 H 216 V 86 L 202 103 H 54 L 40 86 Z';n=19;rows=[10,9];xs=53;pitch=16.4;ys=[74,85]
  elif t=='display-port':
   outline='M 31 48 H 225 V 108 H 50 L 31 89 Z';inner='M 38 55 H 218 V 101 H 53 L 38 86 Z';n=20;rows=[10,10];xs=53;pitch=16.4;ys=[73,84]
  else:
   outline='M 57 33 H 199 V 125 H 57 Z';inner='M 64 40 H 192 V 118 H 64 Z';n=20;rows=[10,10];xs=74;pitch=11.7;ys=[69,88]
  body=P(outline)+P(inner,'#0a1117')+R(xs-4,min(ys)-2,256-2*xs+8,max(ys)-min(ys)+9,'#434d52',1)
  for row,count in enumerate(rows):
   for i in range(count):body+=R(xs+i*pitch+(pitch/2 if count==9 else 0),ys[row],3.5,5,'url(#gold)',.6,'data-contact="1"')
  changes=['Corrected aperture proportions rather than scaling old geometry: low-profile HDMI/DP; taller rectangular mini-DP. Two opposed contact rows (HDMI 10+9, DP/mini-DP 10+10); no anisotropic transforms. Source MiniDisplayPort thumbnail appears inconsistent with a modern mini-DP receptacle; exact part unresolved.']
 elif t in ['dmx-5pin','xlr-5pin']:
  body=C(128,80,62)+C(128,80,56,'url(#polymer)')+C(128,80,47,'#141b23')+P('M 119 33 H 137 V 41 H 119 Z','#707d89')+R(115,20,26,10,'url(#metal)',2)
  for x,y in [(102,65),(154,65),(106,97),(150,97),(128,111)]:body+=contact(x,y,6)
  changes=['Corrected five-contact insert to the source/manufacturer U-shaped pattern: two upper, two lower, one bottom-center; removed invented top-center contact. Female sockets retained.']
 elif t=='mini-din-6pin':
  body=C(128,80,62)+C(128,80,56,'url(#polymer)')+C(128,80,47,'#141b23')+P('M 119 33 H 137 V 41 H 119 Z','#707d89')
  for x,y in [(105,56),(151,56),(94,82),(162,82),(113,109),(143,109)]:body+=contact(x,y,4)
  body+=R(119,57,18,24,'#05090e',0)
  changes=['Corrected six-position mini-DIN to manufacturer front-view topology: inner upper pair, wider middle pair, inner lower pair and upper-center rectangular polarizing key. Neutral insert avoids assigning keyboard/mouse role color to a generic mini-DIN entry.']
 elif t=='nema':
  # Source thumbnail uses a rounded single 5-15 style face, not the old square study plate.
  body=P('M 88 21 Q 128 12 168 21 Q 190 45 190 80 Q 190 116 169 140 H 87 Q 66 116 66 80 Q 66 45 88 21 Z','url(#polymer)','stroke="#89949e" stroke-width="2"')
  body+=R(99,48,9,37,'#060b10',.5,'data-contact="1"')+R(148,51,8,31,'#060b10',.5,'data-contact="1"')
  body+=P('M 117 118 V 105 A 11 11 0 0 1 139 105 V 118 Z','#060b10','data-contact="1"')
  changes=['Corrected square study perimeter to rounded single receptacle face and polarized slot proportions seen in thumbnail. NEMA 5-15R family example, not a claim that generic NEMA means this subtype. No exposed copper contacts.']
 elif t in ['jack','trs-ts']:
  body=P('M 98 28 H 158 L 188 80 L 158 132 H 98 L 68 80 Z','url(#gold)')
  body+=P('M 102 35 H 154 L 180 80 L 154 125 H 102 L 76 80 Z','none','stroke="#ebcf8b" stroke-width="2"')+C(128,80,43,'#313941')+C(128,80,37,'url(#gold)')+C(128,80,28,'#090e14')+C(128,80,18,'#252b32')+C(128,80,14,'#03070b')
  changes=['Restored the source jack hex mounting nut and threaded bushing appearance; retained concentric female bore. TS/TRS switching remains hidden, not inferred from the front.']
 elif t=='usb-b':
  body=P('M 88 22 H 168 L 191 45 V 138 H 65 V 45 Z')+P('M 91 30 H 165 L 183 48 V 130 H 73 V 48 Z','#0a1117')+R(103,65,50,34,'#b9bcba',2)
  for x,y in [(93,52),(153,52),(93,106),(153,106)]:body+=R(x,y,10,6,'url(#gold)',1,'data-contact="1"')
  changes=['Corrected USB-B near-square frontal shield and shoulder proportions; retained legacy four-contact interface.']
 elif t=='dvi':
  body=P('M 24 48 Q 20 48 22 55 L 32 109 Q 33 114 40 114 H 216 Q 223 114 224 109 L 234 55 Q 236 48 228 48 Z')+P('M 31 54 H 225 L 216 107 H 40 Z','#cdc9b8')
  # Source has analog cross on the left of the front face, 3x8 digital matrix on right.
  for y in (66,81,96):
   for i in range(8):body+=R(94+i*16,y-3,5,6,'#12191e',0,'data-contact="1"')
  body+=R(51,79,23,4,'#12191e',0,'data-contact="1"')
  for x in (53,72):
   for y in (66,97):body+=contact(x,y,2.8)
  for x in (9,247):body+=C(x,81,8)+C(x,81,3.5,'#0b1016')
  changes=['Corrected wide DVI frontal aspect; analog four-contact/blade cluster moved left to match source, 24 digital sockets right. DVI-I dual-link example only, no catalogue-wide subtype claim.']
 elif t=='iec':
  body=R(30,27,196,106,'url(#polymer)',8,'stroke="#89949d" stroke-width="2"')+P('M 88 35 H 168 L 186 55 V 125 H 70 V 55 Z')+P('M 92 43 H 164 L 178 59 V 117 H 78 V 59 Z','#0c1218')
  for x,y in [(123,57),(98,88),(148,88)]:body+=R(x,y,10,20,'url(#metal)',1,'data-contact="1"')
  for x in (44,212):body+=C(x,80,5,'url(#metal)')+C(x,80,2.4,'#080e13')
  changes=['Corrected recessed female slots to exposed metal blades: original C13.png depicts a male C14 inlet despite filename. Three contacts and front inlet/flange proportions checked against Schurter C14 reference. Exact source part unknown.']
 elif t in ['ethercon','fiber-mpo','opticalcon'] or t.startswith('speakon'):
  # Existing inserts were placed in a fictional two-times-wide faceplate.
  # Substitute a standard portrait flange while retaining established insert geometry where valid.
  if t=='ethercon':
   start=body.find('<circle cx="128"');body=flange()+body[start:]
  elif t=='fiber-mpo':
   body=R(48,32,160,98,'url(#polymer)',5,'stroke="#7f8d98" stroke-width="2"')+R(59,48,138,66,'#080e14',2,'stroke="#818c94" stroke-width="2"')+R(69,58,118,47,'#1e2932',2)+R(112,48,32,10,'#05090e',1)
  elif t=='opticalcon':
   # Keep known closed shutter geometry, remove only the incorrect wide flange.
   start=body.find('<circle cx="128"');body=flange()+body[start:]
  else:
   # Manufacturer photographs show protected annular twist-lock contacts, not drilled pin holes.
   n=2 if t.endswith('nl2') else 8 if t.endswith('nl8') else 4
   body=flange() if n!=8 else R(56,8,144,144,'url(#metal)',8,'stroke="#8996a1" stroke-width="2"')
   if n==8:
    for x in (68,188):
     for y in (20,140):body+=C(x,y,5,'#080e14')
   body+=C(128,80,49,'#53708b')+C(128,80,44,'url(#polymer)')+C(128,80,38,'#080e14')+C(128,80,23,'#3c4852')+C(128,80,14,'#05090d')
   body+=P('M 120 35 H 136 V 44 H 120 Z','#060b10')+P('M 120 116 H 136 V 125 H 120 Z','#060b10')
   # Opaque front opening deliberately hides the 2/4/8 contact system seen obliquely in photographs.
   # No fictional radial pinout is drawn at the face.
   body+=P('M 113 78 h 5 v 7 h -5 Z','#05090d')
  changes=['Corrected housing proportions; retained known inner source family.']
  if t.startswith('speakon'):changes=['Removed fictitious XLR-like holes; restored protected annular twist-lock face and keyed central bore from NL2MP/NL4MP/NL8MPR photographs. Contacts are hidden in frontal view, not drawn as an invented radial pinout. Manufacturer counts are 2/4/8; NL8 uses a larger square four-hole flange. Exact catalogue variant remains unresolved.']
 elif t in ['fiber-lc','fiber-sc']:
  n=2 if t=='fiber-lc' else 1;body=''
  for i in range(n):
   x=58+i*72 if n==2 else 92
   body+=R(x,24,68,112,'#397aaf',3,'stroke="#94b7d1" stroke-width="2"')+R(x+7,32,54,96,'#14334b',1)+R(x+15,43,38,68,'#09131e',1)+P(f'M {x+22} 32 h 24 v 13 h -24 Z','#78a7c7')
   # Adapter ferrule alignment sleeve at the rear, not invented gold electrical pins.
   body+=C(x+34,80,10,'#6e899d')+C(x+34,80,6,'#0a1119')
  changes=['Preserved blue adapter family and duplex/simplex count; corrected empty black rectangles with recessed alignment-sleeve detail and latch channel. Exact adapter vendor/polish unspecified.']
 return body,changes

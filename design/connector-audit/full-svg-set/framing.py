"""Uniform optical framing, measured at 4x to include strokes; never changes shape proportions."""
import io,xml.etree.ElementTree as ET
import cairosvg
from PIL import Image
NS='{http://www.w3.org/2000/svg}'
def fit(root):
 # Captions belong in the gallery, not inside a 32px icon. Preserve source artwork markings.
 for e in list(root):
  if e.tag==NS+'text':root.remove(e)
 before=ET.tostring(root,encoding='utf-8')
 im=Image.open(io.BytesIO(cairosvg.svg2png(bytestring=before,output_width=1024,output_height=768))).convert('RGBA')
 box=im.getchannel('A').getbbox()
 assert box
 x0,y0,x1,y1=[v/4 for v in box]
 scale=224/max(x1-x0,y1-y0)
 g=ET.Element(NS+'g',id='artwork',transform=f'translate(128 128) scale({scale:.9f}) translate({-(x0+x1)/2:.6f} {-(y0+y1)/2:.6f})')
 for e in list(root):
  if e.tag not in [NS+'title',NS+'desc',NS+'defs']:
   root.remove(e);g.append(e)
 root.append(g)
 root.set('width','256');root.set('height','256');root.set('viewBox','0 0 256 256');root.set('preserveAspectRatio','xMidYMid meet')
 return {'source_artwork_bounds':[x0,y0,x1,y1],'uniform_scale':round(scale,9),'canvas':[256,256],'padding_min_px':16}

def select_primary(root,t):
 # Do not halve each physical connector merely to show alternative genders at thumbnail size.
 # Keep the other inventoried source form as an editable symbol in the same SVG.
 labels=None
 if t[0].isdigit() or t=='harting':labels=['male','female'];primary=1
 elif t=='socapex':labels=['male','female'];primary=0
 elif t=='powercon':labels=['blue-input','gray-output'];primary=0
 elif t=='powerlock':labels=['source','drain'];primary=0
 if labels is None:return {}
 items=root.findall(NS+'svg');assert len(items)==2
 defs=root.find(NS+'defs')
 for i,e in enumerate(items):
  if i==primary:continue
  root.remove(e)
  e.set('x','0');e.set('y','0');e.set('width','256');e.set('height','192')
  symbol=ET.SubElement(defs,NS+'symbol',id='alternate-'+labels[i],viewBox='0 0 256 192')
  symbol.append(e)
 return {'visible_variant':labels[primary],'embedded_alternate_variant':labels[1-primary],'alternate_symbol_id':'alternate-'+labels[1-primary]}

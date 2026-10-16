import math, os, json, sys, subprocess
from PIL import Image, ImageDraw, ImageFont
import numpy as np

W,H = 576,720
SRC = 115.0
FINAL = 112.0
K = FINAL/SRC
TMP = os.path.join(os.environ['TEMP'],'opencode')
PREVIEW = ('--preview' in sys.argv)
TRANS = json.load(open(os.path.join(TMP,'transcript.json')))
SEGS = TRANS['segments']
FONT = 'C:/Windows/Fonts/arialbd.ttf'
FONT2 = 'C:/Windows/Fonts/arial.ttf'
_fc={}
def f(size,bold=True):
    if (size,bold) not in _fc: _fc[(size,bold)] = ImageFont.truetype(FONT if bold else FONT2, size)
    return _fc[(size,bold)]
def C(a,b,t): return a+(b-a)*t
def CC(c1,c2,t): return tuple(int(C(a,b,t)) for a,b in zip(c1,c2))
def clamp(v,a,b): return max(a,min(b,v))
def sm(t): return t*t*(3-2*t)
def back(t):
    t-=1;c=1.7;return (c+1)*t**3+c*t**2+1

def _new(): return Image.new('RGBA',(320,320),(0,0,0,0))
def make_icons():
    ic={}
    img=_new(); d=ImageDraw.Draw(img)
    d.line([160,290,160,150],fill=(0,0,0,255),width=14)
    d.line([162,288,162,152],fill=(46,125,50,255),width=8)
    for leaf,fl in [([(160,220),(90,180),(70,120),(120,110),(170,150)],(102,187,106,255)),
                    ([(160,190),(230,150),(250,90),(200,80),(155,120)],(129,199,132,255)),
                    ([(160,150),(120,80),(150,40),(190,60),(180,120)],(76,175,80,255))]:
        d.polygon(leaf,fill=fl,outline=(0,0,0,255)); d.line(leaf+[leaf[0]],fill=(0,0,0,255),width=8)
    ic['plant']=img
    img=_new(); d=ImageDraw.Draw(img)
    d.ellipse([70,90,250,230],fill=(186,104,200,255),outline=(0,0,0,255),width=9)
    for cx,cy,r in [(110,130,14),(190,120,10),(160,180,16),(210,180,10),(120,190,9)]:
        d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=(123,31,162,255),outline=(0,0,0,255),width=5)
    for ang in [20,-20,200,160]:
        rad=math.radians(ang); x1=160+90*math.cos(rad); y1=160+70*math.sin(rad)
        x2=160+130*math.cos(rad); y2=160+100*math.sin(rad)
        d.line([x1,y1,x2,y2],fill=(0,0,0,255),width=6)
    ic['bacteria']=img
    img=_new(); d=ImageDraw.Draw(img)
    pts=[(160,40),(230,110),(210,260),(110,260),(90,110)]
    d.polygon(pts,fill=(255,202,40,255),outline=(0,0,0,255)); d.line(pts+[pts[0]],fill=(0,0,0,255),width=10)
    d.line([160,40,160,260],fill=(255,235,150,255),width=6); d.line([90,110,230,110],fill=(0,0,0,255),width=6)
    ic['mineral']=img
    img=_new(); d=ImageDraw.Draw(img)
    drop=[(160,40),(220,150),(220,190),(190,240),(130,240),(100,190),(100,150)]
    d.polygon(drop,fill=(66,165,245,255),outline=(0,0,0,255)); d.line(drop+[drop[0]],fill=(0,0,0,255),width=10)
    d.ellipse([130,150,155,175],fill=(179,229,252,255))
    ic['drop']=img
    img=_new(); d=ImageDraw.Draw(img)
    d.polygon([(80,120),(200,80),(260,120),(140,160)],fill=(215,204,180,255),outline=(0,0,0,255))
    d.polygon([(80,120),(140,160),(140,260),(80,220)],fill=(191,177,145,255),outline=(0,0,0,255))
    d.polygon([(140,160),(260,120),(260,220),(140,260)],fill=(230,220,200,255),outline=(0,0,0,255))
    for p in [[(80,120),(200,80),(260,120),(140,160)],[(80,120),(140,160),(140,260),(80,220)],[(140,160),(260,120),(260,220),(140,260)]]:
        d.line(p+[p[0]],fill=(0,0,0,255),width=7)
    for i in range(3):
        y=140+i*30; d.line([85+i*5,125+y-140,135+i*5,150+y-140],fill=(120,110,90,255),width=3)
    ic['cube']=img
    img=_new(); d=ImageDraw.Draw(img)
    for cx,cy,r,c in [(120,200,55,(179,229,252,220)),(210,150,40,(179,229,252,220)),(190,230,30,(225,245,254,220)),(230,210,20,(255,255,255,230))]:
        d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=c,outline=(0,0,0,255),width=7)
        d.ellipse([cx-r*0.4-8,cy-r*0.4-8,cx-r*0.4+8,cy-r*0.4+8],fill=(255,255,255,200))
    ic['air']=img
    img=_new(); d=ImageDraw.Draw(img)
    d.pieslice([90,80,230,220],180,360,fill=(239,83,80,255),outline=(0,0,0,255),width=9)
    d.rectangle([90,150,230,220],fill=(239,83,80,255))
    d.line([90,220,230,220],fill=(0,0,0,255),width=9)
    d.line([90,150,90,222],fill=(0,0,0,255),width=9); d.line([230,150,230,222],fill=(0,0,0,255),width=9)
    d.rectangle([70,220,250,240],fill=(183,28,28,255),outline=(0,0,0,255),width=6)
    d.ellipse([145,240,175,270],fill=(255,235,59,255),outline=(0,0,0,255),width=6)
    d.line([160,60,160,85],fill=(0,0,0,255),width=8)
    for ang in [-40,-15,15,40]:
        rad=math.radians(ang-90); x2=160+100*math.cos(rad); y2=150+100*math.sin(rad)
        d.line([160,150,x2,y2],fill=(0,0,0,255),width=6)
    ic['alarm']=img
    img=_new(); d=ImageDraw.Draw(img)
    d.polygon([(60,160),(260,140),(260,185),(60,160),(70,205),(110,190)],fill=(255,183,77,255),outline=(0,0,0,255),width=5)
    d.ellipse([80,150,225,190],fill=(255,200,100,255),outline=(0,0,0,255),width=5)
    d.polygon([(225,142),(292,160),(228,182)],fill=(255,167,38,255),outline=(0,0,0,255),width=4)
    d.ellipse([112,162,129,179],fill=(0,0,0,255))
    ic['fish']=img
    img=_new(); d=ImageDraw.Draw(img)
    d.rounded_rectangle([70,110,250,210],radius=20,fill=(120,144,156,255),outline=(0,0,0,255),width=6)
    for row in range(5):
        for col in range(5):
            d.ellipse([95+col*34,128+row*18,105+col*34,138+row*18],fill=(255,240,200,255))
    d.rounded_rectangle([42,150,70,170],radius=6,fill=(120,144,156,255),outline=(0,0,0,255),width=4)
    ic['microbit']=img
    img=_new(); d=ImageDraw.Draw(img)
    for ang in [210,330,90]:
        a=math.radians(ang); p1=(160+95*math.cos(a),160+95*math.sin(a)); p2=(160+95*math.cos(a+0.8),160+95*math.sin(a+0.8))
        d.polygon([p1,p2,(160,160)],fill=(46,125,50,255),outline=(0,0,0,255))
    for ang in [210,330,90]:
        a=math.radians(ang); x=160+78*math.cos(a); y=160+78*math.sin(a)
        d.line([x,y,x+14*math.cos(a+0.9),y+14*math.sin(a+0.9)],fill=(46,125,50,255),width=10)
    ic['recycle']=img
    return ic
ICONS=make_icons()

def paste(img,name,cx,cy,scale=1.0,rot=0.0,alpha=1.0):
    s=int(max(16,round(320*scale)))
    im=ICONS[name].resize((s,s),Image.LANCZOS)
    if rot: im=im.rotate(rot,resample=Image.BICUBIC)
    if alpha<0.999:
        im.putalpha(im.getchannel('A').point(lambda v:int(v*alpha)))
    img.paste(im,(int(cx)-s//2,int(cy)-s//2),im)

RN=np.random.default_rng(7)
BUB=[[RN.uniform(10,566),RN.uniform(3,12),RN.uniform(14,40),RN.uniform(0,6.28),RN.uniform(0,2)] for _ in range(18)]
def bubbles(d,t):
    for x0,r,sp,ph,w in BUB:
        y=H+28-((t*sp+ph*40)%(H+160))
        wob=x0+6*math.sin(t*1.7+w)
        d.ellipse([wob-r,y-r*0.8,wob+r,y+r*0.8],outline=(255,255,255,140),width=2)
        d.ellipse([wob-r*0.3,y-r*0.5,wob+r*0.1,y-r*0.1],fill=(255,255,255,190))

def water_band(d,t,ybase=618):
    pts=[]
    for i in range(13):
        x=i*W/12
        pts.append((x,ybase+8*math.sin(t*2.2+i*0.9)))
    pts.append((W,H)); pts.append((0,H))
    d.polygon(pts,fill=(2,119,189,255))
    d.line(pts[0:2]+[ (W,ybase+8*math.sin(t*2.2+12)) ],fill=(255,255,255,230),width=3)
    for idx in range(7):
        x=idx*W/6; off=(idx%2)*6
        d.line([x,635+off,x,W],fill=(255,255,255,26),width=3)
    d.line([0,ybase+8*math.sin(t*2.2),W,ybase+8*math.sin(t*2.2+12)],fill=(230,247,255,255),width=3)

def sun(d,t):
    cx,cy=500,92
    for i in range(12):
        a=math.radians(i*30+t*22)
        d.line([cx+42*math.cos(a),cy+42*math.sin(a),cx+62*math.cos(a),cy+62*math.sin(a)],fill=(255,235,59,200),width=6)
    d.ellipse([cx-34,cy-34,cx+34,cy+34],fill=(255,235,59,255),outline=(255,160,0,255),width=3)

_vin=None
def vignette():
    global _vin
    if _vin is None:
        yy,xx=np.mgrid[0:H,0:W]
        r=np.sqrt((xx-W/2)**2+(yy-H/2)**2)/(H*0.62)
        _vin=np.clip(1.12-0.42*r,0.55,1.0).astype(np.float32)[...,None]
    return _vin

def base(d,t):
    for i in range(6):
        d.rectangle([0,30+i*112,W,96+i*112],fill=(187,222,251,(16-i)))
    sun(d,t)
    bubbles(d,t)

def progressbar(d,t):
    d.rounded_rectangle([20,26,W-20,42],radius=8,fill=(255,255,255,110),outline=(255,255,255,200),width=2)
    w=W-40
    if t>0: d.rounded_rectangle([22,28,22+int(w*clamp(t/FINAL,0,1)),40],radius=6,fill=(255,87,34,230))

def chip(d,t,cx,cy,text,t0,dur,fill=(255,255,255,255),txtc=(0,0,0,255),ts=22,icon=None,bob=6.0):
    p=clamp((t-t0)*4,0,1); out=clamp((t0+dur-t)*3,0,1)
    a=min(p,out); sc=0.4+0.6*back(sm(p)) if p<1 else 1+0.02*math.sin(t*6)
    if a<=0 or d is None: return
    s=int(ts*1.5)
    tw=d.textlength(text,font=f(s))
    iw=40 if icon else 0
    wd=int(tw+iw+ts*1.6); hh=int(ts*2.3)
    y=cy+int(bob*math.sin(t*2+(t0*7)%6.28))
    d.rounded_rectangle([cx-wd/2,y-hh/2,cx+wd/2,y+hh/2],radius=14,fill=(*fill[:3],int(225*a)),outline=(0,0,0,80),width=2)
    if icon: d.text((cx+iw/2,y),'\uf060',font=f(s),fill=(0,0,0,0),anchor='mm')
    d.text((cx+ (iw/2 if icon else 0),y),text,font=f(s),fill=(*txtc[:3],int(255*a)),anchor='mm')

def caption(d,t):
    seg=next((s for s in SEGS if s['start']<=t*K<=s['end']),None)
    if not seg: return
    txt=seg['text'].strip()
    tw=d.textlength(txt,font=f(19,bold=False))
    wd=min(W-32,tw+34); hh=48
    x=(W-wd)/2; y=H-176
    d.rounded_rectangle([x,y,x+wd,y+hh],radius=14,fill=(7,64,110,205),outline=(255,255,255,150),width=2)
    d.text((W/2,y+hh/2),txt,font=f(19,bold=False),fill=(255,255,255,255),anchor='mm')

# ============ SCENES ============
frame_img=None
def build():
    global frame_img
    frame_img=Image.new('RGBA',(W,H),(255,255,255,0))

def draw_sys(d,t):
    d.rounded_rectangle([130,494,446,662],radius=14,fill=(2,119,189,255),outline=(0,0,0,255),width=4)
    d.rounded_rectangle([146,512,430,648],radius=10,fill=(3,155,229,255),outline=(0,0,0,255),width=4)
    d.line([170,560,190,540],fill=(0,0,0,255),width=8)   # pump pipe up
    d.line([210,560,210,540],fill=(0,0,0,255),width=8)
    d.rounded_rectangle([175,555,235,592],radius=10,fill=(255,112,67,255),outline=(0,0,0,255),width=4)
    d.line([205,592,205,618],fill=(0,0,0,255),width=8)
    d.line([410,520,410,632],fill=(0,0,0,255),width=7)   # return pipe
    for dy in range(3):
        yy=520+dy*34
        d.ellipse([404,yy,416,yy+12],fill=(255,255,255,220))
    paste(frame_img,'cube',250,448,0.3)
    paste(frame_img,'cube',330,430,0.3)
    paste(frame_img,'cube',300,410,0.3)
    paste(frame_img,'plant',286,318,0.42,rot=8*math.sin(t*1.1))
    paste(frame_img,'fish',250,596,0.24,rot=8*math.sin(t*2))

def title_band(d,t,txt0,txt1,c1=(255,87,34,255),c2=(255,202,40,255),py=140,ts=46):
    d.text((W/2,py),txt0,font=f(ts),fill=c1,anchor='mm')
    d.text((W/2,py+ts+14),txt1,font=f(ts),fill=c2,anchor='mm')

def s_intro(d,t):
    if t<0.7:
        a=t/0.7
        d.rounded_rectangle([80,230,496,520],radius=24,fill=(120,144,156,int(255*sm(a))),outline=(255,255,255,255),width=5)
        d.text((W/2,310),'SUPERMAN',font=f(54),fill=(255,255,255,255),anchor='mm')
        d.text((W/2,380),'PONDIES',font=f(54),fill=(255,202,40,255),anchor='mm')
        d.text((W/2,450),'one system:  fish + plants + water',font=f(22,bold=False),fill=(255,255,255,255),anchor='mm')
    else:
        d.text((W/2,300),'Where does growing food',font=f(34),fill=(0,0,0,255),anchor='mm')
        d.text((W/2,352),'have to be so complicated?',font=f(34),fill=(0,0,0,255),anchor='mm')
        for i in range(6):
            a=math.radians(i*60+t*30)
            x=W/2+250*math.cos(a)
            paste(frame_img,['plant','drop','cube','mineral','air','fish'][i],x,352+150*math.sin(a),0.24,rot=t*30+i*40,alpha=0.5)
        paste(frame_img,'plant',150,220,0.4,rot=-12)
        paste(frame_img,'drop',420,200,0.4,rot=10)
        paste(frame_img,'cube',300,250,0.4,rot=15)
        d.polygon([(200,180),(216,200),(184,200)],fill=(0,0,0,255))

def s_equipment(d,t):
    d.text((W/2,150),'Hydroponics needs...',font=f(40),fill=(0,0,0,255),anchor='mm')
    items=[('drop','lots of water'),('cube','equipment'),('air','aeration'),('mineral','nutrients'),('fish','maintenance')]
    for i,(ic,txt) in enumerate(items):
        a=math.radians(i*72+t*40)
        x=W/2+230*math.cos(a); y=300+200*math.sin(a)
        s=0.22+0.04*math.sin(t*3+i)
        paste(frame_img,ic,x,y,s,rot=t*50+i*72,alpha=0.75)
    chip(d,t,W/2,560,'SPACE + EQUIPMENT + WATER',8.64-t*K+0.5,1.5,ts=20)

def s_onesystem(d,t):
    d.text((W/2,170),'But what if...',font=f(40),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,220),'ONE system could do it all?',font=f(30),fill=(0,0,0,255),anchor='mm')
    slots=[('fish','raise fish',150),( 'plant','grow plants',300),('drop','recycle water',450),('recycle','reuse waste',520)]
    for i,(ic,txt,y) in enumerate(slots):
        t0=8.64-t*K+0.4+i*1.1
        p=clamp((t*K-t0)*2.5,0,1)
        if p>0:
            sc=sm(p); plus=24*back(sc) if sc<1 else 0
            xx=150+(i%2)*260
            if t*K-t0<0: continue
            paste(frame_img,ic,xx,y, (0.2+0.08*sc)+0.02*math.sin(t*3+i), rot=t*20)
            if ic=='plant':
                paste(frame_img,'plant',xx,y,(0.2+0.08*sc)+0.02*math.sin(t*3+i),rot=t*20)
                d.ellipse([xx-8,y-14,xx+8,y-2],fill=(255,255,255,180))
    chip(d,t,W/2,620,'grow • fish • recycle • plants',8.64,2.5,ts=19,fill=(46,125,50,255),txtc=(255,255,255,255))

def s_intro_title(d,t):
    nn=(t*K-14.24)
    p=clamp(nn*2,0,1)
    sc=back(sm(p)) if p<1 else 1+0.03*math.sin(t*5)*((t*K-16.5)>0)
    d.rounded_rectangle([W/2-230*sc,190,W/2+230*sc,430],radius=28,fill=(121,134,203,int(230*sm(p))),outline=(255,255,255,255),width=6)
    for i in range(8):
        a=math.radians(i*45+t*50)
        x=W/2+260*math.cos(a); y=310+140*math.sin(a)
        d.line([x-10,y,x+10,y],fill=(255,202,40,200),width=4)
    title_band(d,t,'SUPERMAN','PONDIES',py=270)
    d.text((W/2,400),"aquaponic vertical farming",font=f(20,bold=False),fill=(255,255,255,255),anchor='mm')

def s_system(d,t):
    d.text((W/2,120),'Aquaponic vertical farming',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,160),'tailored for water spinach',font=f(24,bold=False),fill=(70,90,110,255),anchor='mm')
    draw_sys(d,t)
    for i in range(3):
        x=205; y=540- ( (t*30+ i*40)%180)
        if y>540: y=540-(y-540)
        d.ellipse([x-4,y,x+4,y+8],fill=(255,255,255,220))
    chip(d,t,W/2,430,'TANK + TRAYS + PUMP + MICRO:BIT',17.42,2.2,ts=18)

def s_ground(d,t):
    p=clamp(t*K-22.46,0,1)
    grow=1
    d.text((W/2,140),'Traditional farming',font=f(36),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,185),'grows flat across the ground',font=f(24,bold=False),fill=(70,90,110,255),anchor='mm')
    y0=470
    d.rectangle([60,y0,W-60,y0+10],fill=(124,85,42,255))
    for i in range(0,11):
        x=78+i*43
        h=40+18*math.sin(i*2.3)
        d.line([x,y0,x,y0-h],fill=(46,125,50,255),width=5)
        d.line([x-h*0.4,y0-h,x+h*0.4,y0-h],fill=(76,175,80,255),width=4)
        if (t*3+i)%2.2<0.5:
            d.ellipse([x-6,y0-h-8,x+6,y0-h],fill=(102,187,106,255))
    d.text((W/2,y0+40),'wide footprint  =  little space left',font=f(20,bold=False),fill=(0,0,0,255),anchor='mm')

def s_stacked(d,t):
    d.text((W/2,150),'Stack them VERTICALLY!',font=f(38),fill=(0,0,0,255),anchor='mm')
    ys=[430,350,270]
    for i,y in enumerate(ys):
        p=clamp((t*K-(26.76+i*0.5))*3,0,1)
        if p>0:
            yy=y-(180*(1-sm(p)))
            d.rounded_rectangle([160,yy,410,yy+52],radius=12,fill=(94,53,177,255),outline=(0,0,0,255),width=3)
            for xx in [200,270,340]:
                paste(frame_img,'plant',xx,yy-16,0.16,rot=(t*8+i*5)%0 if False else 6*math.sin(t*2+i))
            paste(frame_img,'cube',320,yy+26,0.14)
    for x in [140,430]:
        d.line([x,420,x,520],fill=(0,0,0,255),width=8)
        d.line([x,420,x+14,436],fill=(0,0,0,255),width=8)

def s_space(d,t):
    d.text((W/2,140),'Same school space,',font=f(34),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,185),'MORE plants per footprint',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.rectangle([150,380,426,560],fill=(245,245,245,180),outline=(0,0,0,255),width=4)
    d.text((W/2,398),'1 footprint = 2 tiers',font=f(18,bold=False),fill=(70,90,110,255),anchor='mm')
    for i,y in enumerate([430,505]):
        d.rounded_rectangle([180,y,390,y+56],radius=12,fill=(94,53,177,255),outline=(0,0,0,255),width=3)
        for xx in [225,290,355]:
            paste(frame_img,'plant',xx,y-14,0.15,rot=6*math.sin(t*2+i))
    d.arrow = None
    d.polygon([(150,452),(426,456),(426,470),(150,466)],fill=(255,183,77,255))
    chip(d,t,W/2,620,'compact + productive',30.0,2.0,fill=(46,125,50,255),txtc=(255,255,255,255))

def s_undertank(d,t):
    d.text((W/2,120),'Biggest difference:',font=f(32),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,160),'a fish tank underneath!',font=f(30),fill=(255,87,34,255),anchor='mm')
    d.rounded_rectangle([140,300,436,600],radius=16,fill=(2,119,189,255),outline=(0,0,0,255),width=5)
    d.rounded_rectangle([156,322,420,584],radius=12,fill=(3,155,229,255),outline=(0,0,0,255),width=4)
    for i in range(3):
        paste(frame_img,'fish',190+i*70 + (8*math.sin(t*2+i*2)%16),420+i*30,0.22,rot=10*math.sin(t*3.3+i))
    d.line([210,300,210,280],fill=(0,0,0,255),width=6)
    d.line([210,280,340,280],fill=(0,0,0,255),width=6)
    d.line([340,280,340,352],fill=(0,0,0,255),width=6)
    paste(frame_img,'cube',340,368,0.18)
    chip(d,t,W/2,660,'FISH TANK',35.12,2.0,ts=20)

def s_ammonia(d,t):
    d.text((W/2,140),'Fish produce waste',font=f(34),fill=(0,0,0,255),anchor='mm')
    draw_sys(d,t)
    for i in range(4):
        a=math.radians(i*90+t*40)
        x=360+60*math.cos(a); y=460+40*math.sin(a)
        d.ellipse([x-9,y-6,x+9,y+6],fill=(101,59,32,200),outline=(0,0,0,200),width=2)
        d.line([x-9,y-4,x+4,y-6],fill=(255,255,255,120),width=2)
    chip(d,t,W/2,180,'AMMONIA (NH3)',38.34,2.4,fill=(255,152,0,255),txtc=(0,0,0,255),ts=24,icon=False)

def s_nitrite(d,t):
    d.text((W/2,150),'Bacteria #1:',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,195),'ammonia  ->  nitrite',font=f(26),fill=(123,31,162,255),anchor='mm')
    for i in range(2):
        paste(frame_img,'bacteria',190+i*180,360,0.32,rot=t*30+i+10*math.sin(t*3))
    for i in range(5):
        p=((t*K-40.98)*1.6+i*0.2)%1.0
        x=150+p*280; y=430+30*math.sin(p*6+i)*0.3
        d.ellipse([x-5,y-5,x+5,y+5],fill=(255,152,0,255),outline=(0,0,0,255),width=2)
    chip(d,t,W/2,520,'NITRITE (NO2)',40.98,2.6,fill=(123,31,162,255),txtc=(255,255,255,255),ts=24)

def s_nitrate(d,t):
    d.text((W/2,150),'Bacteria #2:',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,195),'nitrite  ->  nitrate',font=f(26),fill=(46,125,50,255),anchor='mm')
    for i in range(2):
        paste(frame_img,'bacteria',190+i*180,360,0.32,rot=t*-30-i+10*math.sin(t*3))
    for i in range(5):
        p=((t*K-43.78)*1.6+i*0.2)%1.0
        x=150+p*280; y=430+30*math.sin(p*6+i)*0.3
        d.ellipse([x-5,y-5,x+5,y+5],fill=(76,175,80,255),outline=(0,0,0,255),width=2)
    chip(d,t,W/2,530,'NITRATE (NO3)',43.78,2.6,fill=(46,125,50,255),txtc=(255,255,255,255),ts=24)

def s_absorb(d,t):
    p=clamp((t*K-46.8)*1.2,0,1)
    g=0.6+0.4*sm(p)
    paste(frame_img,'plant',W/2,300,0.6*g,rot=4*math.sin(t*1.5))
    d.ellipse([W/2-90*g,330,W/2+90*g,470],fill=(94,53,177,120),outline=(0,0,0,255),width=3)
    d.rectangle([W/2-40,450,W/2+40,470],fill=(205,170,125,255))
    for i in range(8):
        pp=((t*K-46.8)*1.2+i*0.13)%1.0
        y=470-pp*200; x=W/2+(-1 if i%2 else 1)*(14+10*math.sin(pp*9+i))
        d.ellipse([x-6,y-6,x+6,y+6],fill=(76,175,80,255),outline=(0,0,0,255),width=2)
    d.text((W/2,560),'roots absorb mineral nutrients',font=f(22,bold=False),fill=(0,0,0,255),anchor='mm')

def s_notwaste(d,t):
    d.rounded_rectangle([230,260,346,430],radius=10,fill=(148,163,176,255),outline=(0,0,0,255),width=4)
    d.line([228,252,348,444],fill=(0,0,0,255),width=0)
    for i in range(4):
        p=((t*K-50.82)+i*0.25)%1.0
        x=250+p*90; y=280-p*60
        d.ellipse([x-8,y-5,x+8,y+5],fill=(101,59,32,220),outline=(0,0,0,255),width=2)
    d.text((W/2,470),'fish waste:  NOT junk',font=f(28),fill=(244,67,54,255),anchor='mm')
    d.line([180,460,396,460],fill=(244,67,54,255),width=6)

def s_resource(d,t):
    d.text((W/2,150),'Waste  ->  RESOURCE',font=f(32),fill=(0,0,0,255),anchor='mm')
    cx,cy=W/2,380
    paste(frame_img,'fish',cx-150,cy,0.3,rot=10*math.sin(t*2))
    paste(frame_img,'plant',cx+150,cy+10,0.3,rot=-8*math.sin(t*2))
    for i in range(3):
        a=math.radians(i*120+t*40)
        x=cx+110*math.cos(a); y=cy+110*math.sin(a)
        d.line([cx-70*math.cos(a),cy-70*math.sin(a),x,y],fill=(46,125,50,255),width=6)
        d.polygon([(x,y),(x+14*math.cos(a+2.5),y+14*math.sin(a+2.5)),(x+14*math.cos(a-2.5),y+14*math.sin(a-2.5))],fill=(46,125,50,255))
    chip(d,t,W/2,560,'nutrient for the plants',53.56,2.0,fill=(46,125,50,255),txtc=(255,255,255,255))

def s_ebbf(d,t):
    d.text((W/2,120),'EBB + FLOW cycle',font=f(34),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,160),'recycling the same water',font=f(22,bold=False),fill=(70,90,110,255),anchor='mm')
    d.rounded_rectangle([140,300,436,560],radius=14,fill=(2,119,189,255),outline=(0,0,0,255),width=4)
    d.rounded_rectangle([170,200,410,280],radius=10,fill=(94,53,177,255),outline=(0,0,0,255),width=4)
    paste(frame_img,'plant',250,190,0.2,rot=6*math.sin(t))
    d.line([210,300,210,280],fill=(0,0,0,255),width=8)
    d.line([360,280,360,300],fill=(0,0,0,255),width=8)
    for i in range(6):
        p=((t*3.5+i*0.16)%1.0)
        y=282-p*0 if False else 300-p*22
        x=210+(i%2)*160
        d.ellipse([x-5,y-8,x+5,y],fill=(255,255,255,230))
    for i in range(4):
        yy=520-((t*40+i*45)%330)
        x=205 if i<2 else 370
        d.ellipse([x-5,yy-9,x+5,yy+3],fill=(179,229,252,255),outline=(0,0,0,255),width=2)
    paste(frame_img,'recycle',W/2,606,0.35,rot=t*30)

def s_gravity(d,t):
    d.text((W/2,140),'Gravity does the return trip',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,185),'only ONE pump needed',font=f(26),fill=(255,87,34,255),anchor='mm')
    paste(frame_img,'drop',W/2,320,0.4)
    d.line([W/2,440,W/2,500],fill=(0,0,0,255),width=8)
    d.polygon([(W/2-16,500),(W/2+16,500),(W/2,522)],fill=(0,0,0,255))
    d.rounded_rectangle([180,520,396,600],radius=12,fill=(255,112,67,255),outline=(0,0,0,255),width=4)
    d.text((W/2,560),'PUMP (1)',font=f(18),fill=(255,255,255,255),anchor='mm')
    chip(d,t,W/2,220,'GRAVITY-FED RETURN',61.78,2.0,ts=20)

def s_energy(d,t):
    d.text((W/2,160),'Less energy used',font=f(38),fill=(0,0,0,255),anchor='mm')
    d.rounded_rectangle([180,300,396,340],radius=10,fill=(255,255,255,230),outline=(0,0,0,255),width=3)
    for i in range(5):
        w=36
        x=196+i*40
        active = (10-(t*K-66.2)*30)-(i if False else 5-i)>0  # counts down
        if (5-i) <= max(1,int(5- (t*K-66.2)*3)):
            d.rectangle([x,308,x+28,332],fill=(255,235,59,255),outline=(0,0,0,255),width=2)
        else:
            d.rectangle([x,308,x+28,332],fill=(148,163,176,255),outline=(0,0,0,255),width=2)
    chip(d,t,W/2,420,'gravity = free energy',66.2,1.8,fill=(46,125,50,255),txtc=(255,255,255,255))

def s_conditions(d,t):
    d.text((W/2,130),'Right conditions for BOTH',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.line([W/2,220,W/2,420],fill=(0,0,0,255),width=3)
    d.text((W/2-80,230),'PLANTS',font=f(22),fill=(46,125,50,255),anchor='mm')
    d.text((W/2+85,230),'FISH',font=f(22),fill=(255,152,0,255),anchor='mm')
    paste(frame_img,'plant',W/2-140,330,0.3,rot=-8)
    paste(frame_img,'fish',W/2+130,330,0.28,rot=8*math.sin(t*2))
    for k,(x,txt) in enumerate([(W/2-215,'light'),(W/2-60,'pH'),(W/2+60,'oxygen'),(W/2+210,'temp')]):
        d.rounded_rectangle([x,430,x+150,466],radius=10,fill=(255,255,255,210),outline=(0,0,0,255),width=2)
        d.text((x+75,448),txt,font=f(16,bold=False),fill=(0,0,0,255),anchor='mm')
        lw=blink(t,k)
        d.rectangle([x+8,444,x+8+int(130*blink(t,k)),462],fill=(76,175,80,200))
def blink(t,k): return (math.sin(t*3+k*1.7)+1)/2

def s_airpump(d,t):
    d.text((W/2,140),'Air pump adds OXYGEN',font=f(32),fill=(0,0,0,255),anchor='mm')
    d.rounded_rectangle([200,300,376,430],radius=14,fill=(2,119,189,255),outline=(0,0,0,255),width=4)
    paste(frame_img,'fish',288,368,0.25,rot=6*math.sin(t*2))
    d.line([300,430,300,500],fill=(0,0,0,255),width=6)
    d.rounded_rectangle([250,500,350,530],radius=8,fill=(148,163,176,255),outline=(0,0,0,255),width=3)
    for i in range(5):
        p=((t*1.8+i*0.2)%1.0)
        x=288+((i-2)*20)+8*math.sin(p*6)
        y=500-p*130
        d.ellipse([x-6,y-6,x+6,y+6],fill=(255,255,255,230),outline=(0,0,0,255),width=2)
    chip(d,t,W/2,580,'O2 for fish + bacteria',70.88,2.0,fill=(3,169,244,255),txtc=(255,255,255,255))
    chip(d,t,W/2+150,250,'O2',70.88,2.0,ts=26,fill=(255,255,255,255),txtc=(3,169,244,255))

def s_respir(d,t):
    d.text((W/2,140),'Fish breathe, water stays healthy',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.rounded_rectangle([200,280,376,470],radius=14,fill=(2,119,189,255),outline=(0,0,0,255),width=4)
    for i in range(2):
        paste(frame_img,'fish',265+i*120,360+(i*20%10 if False else 8*math.sin(t*2+i)),0.22,rot=8*math.sin(t*2.5+i))
    for i in range(3):
        p=((t*1.6+i*0.2)%1.0)
        d.ellipse([250+p*70+i*22,430-p*30,254+p*74+i*22,434-p*30],fill=(255,255,255,200))
    for _,r in [(178,36),(178,72)]:
        d.ellipse([288-r,360-r,288+r,360+r],fill=(255,255,255,30),outline=(255,255,255,160),width=2)

def s_rockwool(d,t):
    d.text((W/2,140),'Rockwool / coconut coir',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,185),'supports + holds roots',font=f(22,bold=False),fill=(70,90,110,255),anchor='mm')
    paste(frame_img,'cube',W/2,340,0.62,rot=0)
    for i in range(7):
        p=((t*K-77.08)*0.8+i*0.14)%1.0
        ang=math.radians(-60+i*20)
        x=W/2+50*math.sin(ang);
        y=400-p*160 if False else 400-p*170
        if p<0.15: continue
        d.line([W/2,400,x,y],fill=(215,180,140,180),width=4)
        d.ellipse([x-4,y-4,x+4,y+4],fill=(215,180,140,255))
    chip(d,t,W/2,540,'ROCKWOOL | COIR',77.08,2.0,ts=22)

def s_moisture(d,t):
    d.text((W/2,140),'holds moisture + AIR spaces',font=f(28),fill=(0,0,0,255),anchor='mm')
    paste(frame_img,'cube',W/2,320,0.6)
    for i in range(6):
        p=((t*1.3+i*0.16)%1.0)
        x=(W/2-60)+((i*30)%130); y=300+ ((i*38)%80) - p*18
        d.ellipse([x-4,y-4,x+4,y+4],fill=(66,165,245,230),outline=(0,0,0,160),width=2)
    for i in range(3):
        x=W/2-40+i*45; y=330+((i*7)%50)+10*math.sin(t*2+i)
        d.ellipse([x-9,y-9,x+9,y+9],fill=(255,255,255,200),outline=(0,0,0,120),width=2)
    d.text((W/2,520),'roots breathe oxygen',font=f(20,bold=False),fill=(0,0,0,255),anchor='mm')

def s_eyes(d,t):
    d.ellipse([W/2-110,220,W/2+110,440],fill=(255,255,255,230),outline=(0,0,0,255),width=8)
    d.ellipse([W/2-44,278,W/2+44,382],fill=(0,0,0,255))
    d.ellipse([W/2+6,300,W/2+34,330],fill=(255,255,255,255))
    d.arc([W/2-110,220,W/2+110,440],200,340,fill=(0,0,0,255),width=8)
    d.text((W/2,480),'not just by eye...',font=f(28),fill=(0,0,0,255),anchor='mm')
    shade=clamp((t*K-83.12)*2,0,1)
    if shade>0:
        d.rectangle([(W/2-110)+shade*180,220,(W/2-110)+shade*180+300,440],fill=(244,67,54,180))
    chip(d,t,W/2,560,'manual checking = slow',83.12,2.2,fill=(244,67,54,255),txtc=(255,255,255,255),ts=20)

def s_microbit(d,t):
    d.text((W/2,140),'Micro:bit monitors',font=f(32),fill=(0,0,0,255),anchor='mm')
    paste(frame_img,'microbit',W/2,300,0.62)
    for row in range(5):
        for col in range(5):
            on=(int(t*8)+row*3+col)%2
            if on:
                d.ellipse([W/2-74+col*34,268+row*18,W/2-64+col*34,278+row*18],fill=(255,214,0,255))
    d.line([W/2-60,340,W/2-140,430],fill=(0,0,0,255),width=4)
    d.line([W/2+60,340,W/2+140,430],fill=(0,0,0,255),width=4)
    for x,lab in [(W/2-140,'pH'),(W/2+120,'water')]:
        d.rounded_rectangle([x-45,430,x+45,468],radius=10,fill=(255,255,255,210),outline=(0,0,0,255),width=2)
        d.text((x,449),lab,font=f(18,bold=False),fill=(0,0,0,255),anchor='mm')
    chip(d,t,W/2,560,'sensors + data',86.1,2.0,ts=20)

def s_gauge(d,t):
    d.text((W/2,130),'pH outside 6-7 :',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,175),'water level dropping :',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.rounded_rectangle([140,210,436,320],radius=14,fill=(255,255,255,230),outline=(0,0,0,255),width=3)
    for i,c in enumerate([(244,67,54),(255,152,0),(255,235,59),(139,195,74),(76,175,80),(3,169,244)]):
        d.rectangle([150+i*46,225,196+i*46,250],fill=c)
    ang=(math.sin(t*3))*(1-(t*K-89.32)*0.1)
    a0=math.radians(180-90*(1+ang))
    d.line([288,270,288+50*math.cos(a0),270+50*math.sin(a0)],fill=(255,0,0,255),width=5)
    d.ellipse([276,258,300,282],fill=(0,0,0,255))
    lvl=clamp(1-(t*K-89.32)*0.8,0.05,1)
    d.rounded_rectangle([140,360,436,520],radius=14,fill=(255,255,255,230),outline=(0,0,0,255),width=3)
    d.rectangle([160,380,416,int(380+120*lvl)],fill=(66,165,245,200),outline=(0,0,0,255),width=2)
    d.line([160,int(380+120*lvl),416,int(380+120*lvl)],fill=(244,67,54,255),width=5)
    d.text((W/2,540),'DANGER ZONE',font=f(24),fill=(244,67,54,255),anchor='mm')

def s_alarm(d,t):
    shake=(int(12*math.sin(t*35)),int(12*math.cos(t*33)))
    global _shake
    _shake=shake if (t*K-93.34)<1.2 else (0,0)
    fl=(math.sin(t*14)+1)/2
    d.rounded_rectangle([W/2-140*fl,150,W/2+140*fl,250],radius=16,fill=(244,67,54,int(255*(0.6+0.4*fl))),outline=(255,255,255,255),width=4)
    d.text((W/2,200),'ALERT!',font=f(40),fill=(255,255,255,255),anchor='mm')
    paste(frame_img,'alarm',W/2,380,0.55,rot=10*math.sin(t*9))

def s_data(d,t):
    d.text((W/2,130),'Log data, compare growth',font=f(30),fill=(0,0,0,255),anchor='mm')
    d.rounded_rectangle([120,220,456,430],radius=12,fill=(255,255,255,235),outline=(0,0,0,255),width=3)
    for i in range(4):
        d.line([140+i*95,250,140+i*95,410],fill=(230,230,230,255),width=2)
    for i in range(3):
        d.line([140,410-i*70,436,410-i*70],fill=(230,230,230,255),width=2)
    pts=[(140,400),(180,360),(220,340),(260,310),(300,290),(340,275),(380,260),(416,248)]
    show=max(1,int(pe((t*K-95.9)*1.6,8)))
    d.line(pts[:show],fill=(46,125,50,255),width=4)
    for j in range(show):
        d.ellipse([pts[j][0]-4,pts[j][1]-4,pts[j][0]+4,pts[j][1]+4],fill=(255,87,34,255))
    for i in range(4):
        paste(frame_img,'plant',150+i*100,470,0.15,rot=4)
    chip(d,t,W/2,560,'grow taller with good conditions',95.9,2.0,ts=19)
def pe(x,n): return x%n if False else x

def s_what(d,t):
    d.rounded_rectangle([W/2-200,180,W/2+200,330],radius=22,fill=(255,255,255,235),outline=(0,0,0,255),width=4)
    d.text((W/2,255),'SO WHAT MAKES',font=f(34),fill=(0,0,0,255),anchor='mm')
    d.text((W/2,295),'PONDIES DIFFERENT?',font=f(30),fill=(255,87,34,255),anchor='mm')
    for i in range(3):
        a=math.radians(i*120+t*30)
        x=W/2+260*math.cos(a); y=300+120*math.sin(a)
        d.line([x-12,y,x+12,y],fill=(255,202,40,220),width=5)

CAPS=[('VERTICAL', 'saves space'),('GRAVITY','recycles water'),('FISH WASTE','feeds plants'),('RECYCLED','low-cost build')]
def s_summary(d,t):
    idx=int((t*K-102.4)//2.3)
    idx=clamp(idx,0,3)
    t0=102.4+idx*2.3
    icons=['plant','recycle','fish','cube']
    p=clamp((t*K-t0)*2.5,0,1)
    if p>0:
        sc=back(sm(p))
        paste(frame_img,icons[idx],W/2-140,300,0.3*sc,rot=t*10)
        d.rounded_rectangle([W/2-60,240,W/2+170,300],radius=14,fill=(255,255,255,225),outline=(0,0,0,255),width=3)
        d.text((W/2+50,270),CAPS[idx][0],font=f(26),fill=(0,0,0,255),anchor='mm')
        a=clamp((t*K-t0-0.4)*2,0,1)
        if a>0:
            d.text((W/2+50,320),CAPS[idx][1]+str(idx+1),font=f(18,bold=False),fill=(0,0,0,0),anchor='mm')
            d.text((W/2-40,318),CAPS[idx][1],font=f(18,bold=False),fill=(0,0,0,255),anchor='mm')
    if idx>0:
        for j in range(idx):
            d.rectangle([W/2+40,140+j*22,W/2+60,158+j*22],fill=(46,125,50,255))

def s_end(d,t):
    a=clamp((t*K-111.86)*2,0,1)
    d.rounded_rectangle([W/2-250,260,W/2+250,470],radius=24,fill=(121,134,203,int(235*sm(a))),outline=(255,255,255,255),width=6)
    paste(frame_img,'fish',100,300,0.22 if a else 0,rot=-6)
    paste(frame_img,'plant',W/2,240,0.4,rot=6*math.sin(t*2))
    paste(frame_img,'recycle',476,300,0.3,rot=t*20)
    d.text((W/2,330),'SUPERMAN',font=f(48),fill=(255,255,255,255),anchor='mm')
    d.text((W/2,388),'PONDIES',font=f(48),fill=(255,202,40,255),anchor='mm')
    d.text((W/2,450),'grow more, in less space',font=f(20,bold=False),fill=(255,255,255,255),anchor='mm')
    if a>0.9:
        d.text((W/2,540),'thanks for watching!',font=f(24),fill=(0,0,0,255),anchor='mm')

SCENES=[s_intro,s_equipment,s_onesystem,s_intro_title,s_system,s_ground,s_stacked,s_space,s_undertank,
        s_ammonia,s_nitrite,s_nitrate,s_absorb,s_notwaste,s_resource,s_ebbf,s_gravity,s_energy,
        s_conditions,s_airpump,s_respir,s_rockwool,s_moisture,s_eyes,s_microbit,s_gauge,s_alarm,
        s_data,s_what,s_summary,s_summary,s_summary,s_summary,s_end]

def render_scene(d,t):
    seg=next((s for s in SEGS if s['start']<=t*K<=s['end']),None)
    if seg is None:
        if t<0.7: s_intro(d,t); return
        s_end(d,t); return
    i=SEGS.index(seg)
    SCENES[min(i,len(SCENES)-1)](d,t)
    caption(d,t)

def compose(t):
    global frame_img
    im=Image.new('RGBA',(W,H),(0,0,0,0))
    frame_img=im
    d=ImageDraw.Draw(im)
    base(d,t)
    water_band(d,t)
    render_scene(d,t)
    progressbar(d,t)
    arr=np.asarray(im).astype(np.float32)
    r1=(216,240,254); r2=(184,233,192)
    bg=np.zeros((H,W,4),np.float32)
    for i in range(H):
        bg[i,:]=(*CC(r1,r2,i/H),255)
    m=(arr[...,3:4]>0).astype(np.float32)
    arr=bg*(1-m)+arr*m
    arr[...,:3]=arr[...,:3]*vignette()
    out=Image.fromarray(np.clip(arr,0,255).astype(np.uint8)).convert('RGB')
    sh = getattr(sys.modules[__name__],'_shake',(0,0))
    if sh!=(0,0):
        out=out.transform((W,H),Image.AFFINE,(1,0,-sh[0],0,1,-sh[1]),Image.BICUBIC)
    return out

def main():
    global _shake
    if PREVIEW:
        os.makedirs(os.path.join(TMP,'pondies_preview'),exist_ok=True)
        for tt in [0.3,2,5,10,15,18,25,32,38,42,45,48,52,57,63,69,75,80,88,94,97,103,106,109,113]:
            compose(tt).save(os.path.join(TMP,'pondies_preview',f'pv_{tt:03.1f}.png'))
        print('previews done')
        return
    import imageio_ffmpeg
    fexe=imageio_ffmpeg.get_ffmpeg_exe()
    raw=os.path.join(TMP,'frames.rgb')
    with open(raw,'wb') as of:
        N=int(FINAL*30)
        for i in range(N):
            of.write(compose(i/30.0).tobytes())
            if i%300==0: print('frame',i)
    out=os.path.join(r'C:\Users\YuanJing\Documents\Default Project\pondies','Superman_Pondies_1m52_Animated_Final_v3.mp4')
    audio=os.path.join(TMP,'pondies_audio.wav')
    cmd=[fexe,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i',raw,
         '-i',audio,'-map','0:v','-map','1:a','-af','atempo=1.02679',
         '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','160k','-shortest',out]
    r=subprocess.run(cmd,capture_output=True)
    print('rc=',r.returncode, out, os.path.getsize(out) if os.path.exists(out) else 'MISSING')
    if r.returncode: print(r.stderr.decode()[-1200:])

if __name__=='__main__':
    _shake=(0,0)
    main()
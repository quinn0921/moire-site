// Stick-figure agent: lives in page coordinates, uses [data-plat] elements as platforms, plans routes, draws tools.
const G=1500, SPEED=30, INK='#0E0D0C';
const HIP=-10, SH=-17, HEAD=-21.5, HR=3, LEG=5.2, ARM=4.3, PEN=17;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const jumpV=h=>Math.sqrt(2*G*Math.max(h,6));

export class Stickman{
  constructor(o){
    this.o=o; this.cv=o.canvas; this.ctx=this.cv.getContext('2d');
    this.s={x:80,y:0,vx:0,vy:0,face:1,mode:'walk',t:0,ph:0,hp:3,surf:null,act:null,planT:0,hitT:0,fallFrom:0,umb:false,kicks:0,gone:false};
    this.tools=[]; this.surfs=[]; this.surfT=0; this.lastMouse={x:-1,y:-1,t:performance.now()}; this.waitUntil=0; this.lastScroll=scrollY;
    this.spawned=false;
    this._rs=()=>this.resize(); this._hit=e=>this.hit(e);
    window.addEventListener('resize',this._rs); window.addEventListener('mousedown',this._hit); this.resize();
  }
  destroy(){ window.removeEventListener('resize',this._rs); window.removeEventListener('mousedown',this._hit); }
  resize(){ const d=Math.min(devicePixelRatio||1,2); this.dpr=d; this.cv.width=innerWidth*d; this.cv.height=innerHeight*d; }
  mouse(){ const m=this.o.getMouse(); return {x:m.x,y:m.y+scrollY}; }
  hit(e){ const s=this.s; if(s.gone||s.mode==='dead')return; const px=e.clientX,py=e.clientY+scrollY;
    if(Math.abs(px-s.x)<14&&py>s.y-30&&py<s.y+4){ s.hp--; s.hitT=performance.now(); s.vx=0; if(s.hp<=0){s.mode='dead';s.deadT=s.hitT;} else if(s.mode==='attack')s.mode='walk'; } }

  // ---------- world ----------
  gather(){
    const sy=scrollY, S=[], seen=new Set();
    const push=(x1,x2,y1,y2,solid)=>{ if(x2-x1<6||y2-y1<2)return; const k=Math.round(x1)+':'+Math.round(y1)+':'+Math.round(x2); if(seen.has(k))return; seen.add(k); S.push({x1,x2,y:y1,box:{x1,x2,y1,y2,h:y2-y1,solid}}); };
    const isSolid=(el,cs)=>{ const t=el.tagName; if(t==='IMG'||t==='svg'||t==='CANVAS'||t==='VIDEO')return true; const bg=cs.backgroundColor; return bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'; };
    const visit=el=>{
      if(el.nodeType!==1)return; const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden')return;
      const r=el.getBoundingClientRect(); if(r.width<4||r.height<2)return;
      if(isSolid(el,cs)){ push(r.left,r.right,r.top+sy,r.bottom+sy,true); return; }
      if(parseFloat(cs.borderTopWidth)>0) push(r.left,r.right,r.top+sy,r.top+sy+2,false);
      if(parseFloat(cs.borderBottomWidth)>0) push(r.left,r.right,r.bottom+sy-2,r.bottom+sy,false);
      const fs=parseFloat(cs.fontSize)||16, cap=fs*.72;
      for(const n of el.childNodes){
        if(n.nodeType===3){ if(!n.textContent.trim())continue; const rg=document.createRange(); rg.selectNodeContents(n);
          for(const q of rg.getClientRects()){ if(q.width<3)continue; const pad=Math.max(0,(q.height-cap)/2); push(q.left,q.right,q.top+pad+sy,q.bottom-pad*.7+sy,false); } }
        else visit(n);
      }
    };
    this.o.root.querySelectorAll('[data-plat]').forEach(visit);
    this.docH=document.documentElement.scrollHeight;
    S.push({x1:-1e6,x2:1e6,y:this.docH,ground:true});
    const now=performance.now();
    this.tools=this.tools.filter(t=>now-t.born<14000);
    for(const t of this.tools) if(t.done) for(const s of t.surfs) S.push(s);
    if(this.virt) S.push(this.virt);
    this.surfs=S; this.surfT=now;
    if(this.s.surf) this.s.surf=this.match(this.s.surf);
    if(this.s.act){ const a=this.s.act; a.from=this.match(a.from); a.to=this.match(a.to); if(!a.from||!a.to) this.s.act=null; }
  }
  match(s){ if(!s)return null; if(this.surfs.includes(s))return s; return this.surfs.find(q=>Math.abs(q.y-s.y)<3&&q.x1<s.x2&&q.x2>s.x1&&!!q.ground===!!s.ground)||null; }
  land(surf){ if(surf&&surf.virtual){ const t={type:'perch',x1:surf.x1,x2:surf.x2,y:surf.y,born:performance.now(),prog:1,dur:0,done:true,surfs:[],seed:Math.random()*9}; t.surfs=[{x1:t.x1,x2:t.x2,y:t.y}]; this.tools.push(t); this.virt=null; this.gather(); return t.surfs[0]; } return this.match(surf)||surf; }
  below(x,y,skip){ let best=null; for(const s of this.surfs){ if(s===skip)continue; if(x>=s.x1-6&&x<=s.x2+6&&s.y>=y-1&&(!best||s.y<best.y))best=s; } return best; }
  clear(x,y1,y2,a,b){ return !this.surfs.some(c=>c!==a&&c!==b&&c.y>y1+2&&c.y<y2-2&&x>=c.x1-6&&x<=c.x2+6); }

  edge(a,b){
    if(a===b)return null;
    const ov1=Math.max(a.x1,b.x1),ov2=Math.min(a.x2,b.x2),overlap=ov2-ov1,gap=overlap>0?0:-overlap,dy=a.y-b.y,aw=a.x2-a.x1;
    if(Math.abs(dy)<=3&&gap<=6)return {type:'walk',cost:.2};
    if(dy>-3&&dy<=58&&gap<=48)return {type:'jump',cost:.9+gap/60+Math.max(0,dy)/80};
    if(dy>0){
      if(dy<=100&&gap<=28)return {type:'mantle',cost:1.8};
      if(b.box&&!b.virtual&&b.box.h>=40&&b.box.h<=260&&b.box.y2<=a.y+6&&b.box.y2>=a.y-50&&(gap<=30||a.x1<=b.x1-2||a.x2>=b.x2+2))return {type:'wall',cost:1.6+b.box.h/34};
      if(a.virtual)return null;
      if(dy<=135&&gap<=70&&aw>=60)return {type:'stairs',cost:6.5+gap/60};
      if(dy<=170&&overlap>12)return {type:'ladder',cost:5+dy/36};
      if(dy<=200&&gap<=40&&aw>=40)return {type:'tramp',cost:5.5};
      if(dy>60&&dy<=300&&gap<=220)return {type:'grapple',cost:5.6+gap/150};
      return null;
    }
    if(Math.abs(dy)<=14){ if(gap>10&&gap<=180&&!a.virtual)return {type:'bridge',cost:4.2+gap/SPEED}; return null; }
    if(a.ground)return null;
    const mx=this.mouse().x;
    const cands=[a.x1-5,a.x2+5].filter(x=>x>=b.x1&&x<=b.x2&&this.clear(x,a.y,b.y,a,b)).sort((p,q)=>Math.abs(p-mx)-Math.abs(q-mx));
    if(!cands.length)return null;
    const fall=-dy;
    if(fall>380)return {type:'rope',cost:3+fall/120,dropX:cands[0]};
    return {type:'drop',cost:.8+fall/250,dropX:cands[0]};
  }
  plan(from,to,x0){
    if(!from||!to)return null; if(from===to)return [];
    const best=new Map([[from,{c:0,x:x0}]]),prev=new Map(),open=[from],done=new Set();
    while(open.length){
      open.sort((p,q)=>best.get(p).c-best.get(q).c); const u=open.shift(); if(u===to)break; if(done.has(u))continue; done.add(u); const bu=best.get(u);
      for(const v of this.surfs){ if(done.has(v)||v===u)continue; const e=this.edge(u,v); if(!e)continue; e.from=u; e.to=v;
        const dep=this.depX(u,e,bu.x), c=bu.c+Math.abs(bu.x-dep)/SPEED+e.cost;
        if(c<(best.has(v)?best.get(v).c:Infinity)){ best.set(v,{c,x:this.landX(u,v,e,dep)}); prev.set(v,{u,e}); if(!open.includes(v))open.push(v); } }
    }
    if(!prev.has(to))return null;
    const path=[]; let c=to; while(c!==from){const p=prev.get(c);path.unshift({...p.e});c=p.u;} return path;
  }
  depX(a,e,x0){
    const b=e.to, x=x0??this.s.x;
    if(e.type==='walk'){ const ov1=Math.max(a.x1,b.x1),ov2=Math.min(a.x2,b.x2); if(ov2>ov1)return clamp(x,ov1+1,ov2-1); return b.x1>a.x2-1?a.x2-1:a.x1+1; }
    if(e.type==='drop'||e.type==='rope')return e.dropX;
    if(e.type==='bridge')return b.x1>a.x2?a.x2-2:a.x1+2;
    if(e.type==='wall'){ const px=clamp(x,a.x1,a.x2); const side=Math.abs(b.box.x1-px)<Math.abs(b.box.x2-px)?b.box.x1-5:b.box.x2+5; return clamp(side,a.x1+2,a.x2-2); }
    if(e.type==='stairs'){ const dir=(b.x1+b.x2)/2>(a.x1+a.x2)/2?1:-1; return dir>0?clamp(b.x1-70,a.x1+3,a.x2-3):clamp(b.x2+70,a.x1+3,a.x2-3); }
    const ov1=Math.max(a.x1,b.x1),ov2=Math.min(a.x2,b.x2);
    if(ov2>ov1)return clamp(x,ov1+3,ov2-3);
    return b.x1>a.x2?a.x2-3:a.x1+3;
  }
  landX(a,b,e,dep){
    switch(e.type){
      case 'drop': case 'rope': return clamp(e.dropX,b.x1,b.x2);
      case 'grapple': return clamp(dep,b.x1+8,b.x2-8);
      case 'stairs': { const dir=(b.x1+b.x2)/2>(a.x1+a.x2)/2?1:-1; return clamp(dep+dir*73,b.x1+3,b.x2-3); }
      case 'bridge': return b.x1>a.x2?b.x1+3:b.x2-3;
      case 'tramp': return clamp((b.x1+b.x2)/2,b.x1+3,b.x2-3);
      default: return clamp(dep,b.x1+3,b.x2-3);
    }
  }

  // ---------- step ----------
  step(dt){
    const s=this.s,now=performance.now(),H=innerHeight,sy=scrollY;
    if(s.gone){ this.ctx.clearRect(0,0,this.cv.width,this.cv.height); return; }
    if(now-this.surfT>300||!this.surfs.length) this.gather();
    if(!this.spawned){ const el=this.o.spawnEl; const r=el?el.getBoundingClientRect():null; s.x=r?r.left+18:80; s.y=r?r.top+sy:sy+H; s.surf=(r&&this.surfs.find(q=>Math.abs(q.y-s.y)<3&&s.x>=q.x1&&s.x<=q.x2))||this.below(s.x,s.y-2); if(s.surf){s.y=s.surf.y;} else s.mode='air'; this.spawned=true; }
    const m=this.mouse(); const mc=this.o.getMouse();
    if(Math.abs(mc.x-this.lastMouse.x)>1||Math.abs(mc.y-this.lastMouse.y)>1){ this.lastMouse={x:mc.x,y:mc.y,t:now}; if(s.mode==='sit'){s.mode='walk';s.act=null;} }
    const idle=now-this.lastMouse.t>6000;
    if(scrollY!==this.lastScroll){ this.lastScroll=scrollY; if(s.y<sy-10||s.y>sy+H+10){ this.waitUntil=now+1200; } }
    const paused=now<this.waitUntil;
    s.t+=dt;
    const cx=s.x,cy=s.y-12,dx=m.x-cx,dy=m.y-cy,dist=Math.hypot(dx,dy);
    const hitting=s.hitT&&now-s.hitT<450;
    switch(s.mode){
      case 'dead': if(now-s.deadT>3400)s.gone=true; break;
      case 'attack': { s.vx=0; s.face=dx<0?-1:1; if(dist>60){s.mode='walk';s.act=null;} const sw=Math.sin(s.t*13); if(sw>.97&&!s.swung){s.swung=true;this.o.onHit&&this.o.onHit(s.face*5,-2);} if(sw<0)s.swung=false; this.supportCheck(); break; }
      case 'walk': {
        if(hitting){s.vx=0;break;}
        if(!s.surf){s.mode='air';break;}
        if(!paused&&dist<36&&!idle){s.mode='attack';s.t=0;break;}
        if(paused){s.vx=0;break;}
        if(idle){ // go sit on an edge
          const a=s.surf; if(a.ground){ s.vx=0; s.mode='sit'; s.sitDir=0; break; }
          const ex=Math.abs(s.x-a.x1)<Math.abs(s.x-a.x2)?a.x1+3:a.x2-3; if(Math.abs(s.x-ex)<2){s.mode='sit';s.sitDir=ex<(a.x1+a.x2)/2?-1:1;s.x=ex;s.vx=0;} else {s.face=ex>s.x?1:-1;s.vx=s.face*SPEED;this.move(dt);} break; }
        if(!s.act||now-s.planT>2500){ const target=this.target(m); if(!s.act){ const path=this.plan(s.surf,target,s.x); s.planT=now; if(path&&path.length){ s.act={...path[0],stage:'walkTo'}; s.act.dep=this.depX(s.surf,s.act,s.x); } else { // no route: walk toward cursor x on this surface
              const tx=clamp(m.x,s.surf.x1+3,s.surf.x2-3); if(Math.abs(tx-s.x)>2){s.face=tx>s.x?1:-1;s.vx=s.face*SPEED;this.move(dt);} else s.vx=0; break; } }
          else { s.planT=now; if(target&&target!==s.act.to&&s.act.stage==='walkTo'){ const path=this.plan(s.surf,target,s.x); if(path&&path.length){ s.act={...path[0],stage:'walkTo'}; s.act.dep=this.depX(s.surf,s.act,s.x);} } } }
        const a=s.act; if(!a)break;
        if(Math.abs(a.dep-s.x)>2){ s.face=a.dep>s.x?1:-1; s.vx=s.face*SPEED; this.move(dt); break; }
        s.vx=0; s.x=a.dep; this.begin(a); break; }
      case 'air': {
        s.vy+=G*dt; if(s.umb){ s.umbK=Math.min(1,(s.umbK||0)+dt*3); s.vy=Math.min(s.vy,95+(1-s.umbK)*200); s.vx*=0.98; }
        const ny=s.y+s.vy*dt;
        if(s.mantleOnReach&&s.anchor&&s.vy>-140&&Math.abs(s.x-s.anchor.x)<9&&ny<=s.anchor.y+27){ s.mantleOnReach=false; s.mode='hang'; s.t=0; s.hangDur=.35; s.hangNext='mantle'; s.x=s.anchor.x-s.face*3; s.y=s.anchor.y+24; s.vx=0; s.vy=0; s.umb=false; break; }
        if(s.vy>0){ // landing
          let land=null; for(const q of this.surfs){ if(q.y>=s.y-.01&&q.y<=ny&&s.x>=q.x1-5&&s.x<=q.x2+5&&(!land||q.y<land.y))land=q; }
          if(land){ s.y=land.y; s.surf=this.land(land); land=s.surf; s.vy=0; const fell=s.y-s.fallFrom; s.umb=false;
            if(land.bounce){ const to=this.match(land.bounceTo); if(to){ s.vy=-jumpV(land.y-to.y+22); s.vx=((to.x1+to.x2)/2-s.x)/(2*s.vy/-G); s.vx=clamp(s.vx,-90,90); s.mode='air'; s.fallFrom=s.y; s.landTarget=to; s.surf=null; break; } }
            s.act=null; s.landTarget=null; s.mantleOnReach=false; s.vx=0; s.mode=fell>150?'roll':'walk'; s.t=0; break; }
          if(!s.umb&&!s.landTarget&&s.vy>200&&ny-s.fallFrom>110){ const under=this.below(s.x,ny); if(under&&under.y-ny>170){s.umb=true;s.umbK=0;} }
        } else if(s.landTarget){ // wall kick
          const b=s.landTarget; for(const q of this.surfs){ const bx=q.box; if(!bx||q===b)continue; if(s.y>bx.y1+4&&s.y-20<bx.y2){ if(Math.abs(s.x-bx.x1)<4&&s.vx>0||Math.abs(s.x-bx.x2)<4&&s.vx<0){ if(s.kicks<2&&b.y<s.y-10){s.kicks++;s.vx=-s.vx*.9;s.vy=Math.min(s.vy,-jumpV(60));s.face=-s.face;s.kickT=now;} else s.vx=0; } } }
        }
        if(s.mode==='air'){ s.y=ny; s.x=clamp(s.x+s.vx*dt,6,innerWidth-6); if(s.y>this.docH){s.y=this.docH;s.surf=this.surfs.find(q=>q.ground);s.mode='walk';s.vy=0;s.umb=false;} }
        break; }
      case 'roll': { s.x+=s.face*40*dt; if(s.t>.45){s.mode='walk';} break; }
      case 'hang': { s.t+=0; if(s.t>s.hangDur){ if(s.hangNext==='mantle'){s.mode='mantle';s.t=0;} else { s.mode='air'; s.vy=0; s.vx=0; s.fallFrom=s.y; s.surf=null; s.x=s.anchor.x+s.face*-3; } } break; }
      case 'mantle': { const k=Math.min(1,s.t/.6); s.x=s.anchor.x+s.face*(-3+7*k); s.y=s.anchor.y+24*(1-k); if(k>=1){ s.surf=this.land(s.anchor.surf); s.y=s.anchor.y; s.mode='walk'; s.act=null; } break; }
      case 'slide': { s.y+=130*dt; s.ph+=dt*20; if(s.y>=s.slideTo){ s.mode='air'; s.vy=60; s.vx=s.face*10; s.fallFrom=s.y-60; s.surf=null; } break; }
      case 'climb': { const c=s.climb; s.y-=c.speed*dt; s.ph+=dt*7; if(s.y<=c.topY){ s.y=c.topY; if(c.then==='hang'){ s.mode='hang'; s.t=0; s.hangDur=.3; s.hangNext='mantle'; s.anchor=c.anchor; } else { s.surf=this.land(c.surf); s.mode='walk'; s.act=null; } } break; }
      case 'rope': { s.y+=65*dt; s.ph+=dt*5; if(s.y>=s.ropeEnd){ s.mode='air'; s.vy=20; s.vx=0; s.fallFrom=s.y; s.surf=null; } break; }
      case 'draw': { const t=s.tool; t.prog=Math.min(1,s.t/t.dur); if(s.t>=t.dur+.15){ t.done=true; this.surfT=0; this.after(t); } break; }
      case 'grapple': { const t=s.tool; s.t+=0; const k=Math.min(1,s.t/1.3),e=k*k*(3-2*k); s.x=s.g0.x+(t.ax-s.g0.x)*e; s.y=s.g0.y+(t.ay-s.g0.y)*e-Math.sin(k*Math.PI)*24; if(k>=1){ s.y=t.ay; s.surf=this.land(t.to); s.mode='walk'; s.act=null; } break; }
      case 'sit': { this.supportCheck(); break; }
    }
    this.draw(now,m);
  }
  move(dt){ const s=this.s; let nx=s.x+s.vx*dt; if(s.surf&&!s.surf.ground) nx=clamp(nx,s.surf.x1,s.surf.x2); s.x=clamp(nx,6,innerWidth-6); s.ph+=dt*7.5; this.supportCheck(); }
  target(m){ const s=this.s; const under=this.below(m.x,m.y)||this.surfs.find(q=>q.ground); if(m.y<under.y-50){ const v=this.virt; if(!v||Math.abs(v.y-(m.y+14))>30||Math.abs((v.x1+v.x2)/2-m.x)>40){ this.virt={x1:m.x-22,x2:m.x+22,y:m.y+14,virtual:true}; this.gather(); } return this.virt; } if(this.virt&&!(s.act&&s.act.to===this.virt)){ this.virt=null; this.gather(); } return under; }
  supportCheck(){ const s=this.s,a=s.surf; if(!a)return; const ok=Math.abs(a.y-s.y)<2&&s.x>=a.x1-5&&s.x<=a.x2+5; if(!ok){ s.surf=null; s.mode='air'; s.vy=0; s.fallFrom=s.y; s.landTarget=null; s.act=null; } }
  begin(a){
    const s=this.s,from=a.from,b=a.to,now=performance.now(); s.t=0; s.kicks=0;
    if(from!==s.surf){s.act=null;return;}
    const tx=clamp(s.x,b.x1+4,b.x2-4);
    switch(a.type){
      case 'walk': { s.x=clamp(s.x+s.face*3,b.x1,b.x2); s.y=b.y; s.surf=this.land(b); s.act=null; break; }
      case 'jump': { const dyy=from.y-b.y, T0=Math.max(.3,Math.abs(tx-s.x)/60); const h=Math.max(dyy+14,G*T0*T0/8); s.vy=-jumpV(h); const disc=Math.max(0,s.vy*s.vy-2*G*dyy); const T=(-s.vy+Math.sqrt(disc))/G; s.vx=clamp((tx-s.x)/Math.max(T,.15),-90,90); s.face=s.vx<0?-1:s.vx>0?1:s.face; s.mode='air'; s.fallFrom=s.y; s.landTarget=b; s.surf=null; break; }
      case 'mantle': { const edgeX=b.x1>s.x-4?b.x1:b.x2<s.x+4?b.x2:clamp(s.x,b.x1,b.x2); s.face=edgeX>=s.x?1:-1; s.anchor={x:edgeX,y:b.y,surf:b}; s.vy=-jumpV(from.y-b.y-14); s.vx=clamp((edgeX-s.x)*1.6,-40,40); s.mode='air'; s.fallFrom=s.y; s.landTarget=b; s.surf=null; s.mantleOnReach=true; break; }
      case 'wall': { const side=Math.abs(b.box.x1-s.x)<Math.abs(b.box.x2-s.x)?-1:1; const wx=side<0?b.box.x1-4:b.box.x2+4; s.x=wx; s.face=-side; s.climb={speed:34,topY:b.y+22,then:'hang',anchor:{x:side<0?b.box.x1:b.box.x2,y:b.y,surf:b},wall:true,wx}; s.mode='climb'; s.surf=null; break; }
      case 'drop': { const box=from.box; s.face=a.dropX>s.x?1:-1; if(box&&box.h>80&&!from.virtual&&(a.dropX<from.x1||a.dropX>from.x2)){ s.x=a.dropX; s.mode='slide'; s.slideTo=box.y2; s.slideX=a.dropX; s.surf=null; s.ph=0; break; }
        s.anchor={x:a.dropX<from.x1?from.x1:from.x2,y:from.y,surf:from}; s.face=s.anchor.x===from.x1?1:-1; s.x=s.anchor.x+s.face*-3; s.y=from.y+24; s.mode='hang'; s.t=0; s.hangDur=.55; s.hangNext='drop'; s.surf=null; break; }
      case 'rope': { const ax=a.dropX<from.x1?from.x1:from.x2; s.face=ax===from.x1?1:-1; const len=Math.min(260,b.y-from.y-40); const t={type:'rope',ax,ay:from.y,len,born:now,prog:0,dur:.9,done:false,surfs:[],seed:Math.random()*9,then:{mode:'rope',end:from.y+len,ax}}; this.tools.push(t); s.tool=t; s.mode='draw'; break; }
      case 'stairs': { const dir=(b.x1+b.x2)/2>s.x?1:-1; s.face=dir; const steps=[],n=5,rise=(from.y-b.y)/n; const run=13; for(let i=1;i<=n;i++){ const x0=s.x+dir*(8+(i-1)*run); steps.push({x1:Math.min(x0,x0+dir*run),x2:Math.max(x0,x0+dir*run),y:from.y-rise*i}); }
        const t={type:'stairs',steps,dir,born:now,prog:0,dur:1.9,done:false,surfs:steps,seed:Math.random()*9}; this.tools.push(t); s.tool=t; s.mode='draw'; break; }
      case 'ladder': { const lx=clamp(tx,from.x1+8,from.x2-8); s.face=lx>=s.x?1:-1; const t={type:'ladder',x:lx+s.face*8,y1:from.y,y2:b.y,born:now,prog:0,dur:1.7,done:false,surfs:[],seed:Math.random()*9,then:{mode:'climb',surf:b}}; this.tools.push(t); s.tool=t; s.mode='draw'; break; }
      case 'grapple': { const ax=clamp(tx,b.x1+8,b.x2-8),ay=b.y; s.face=ax<s.x?-1:1; const t={type:'hook',ax,ay,to:b,born:now,prog:0,dur:1.0,done:false,surfs:[],seed:Math.random()*9}; this.tools.push(t); s.tool=t; s.mode='draw'; break; }
      case 'bridge': { const right=b.x1>from.x2; s.face=right?1:-1; const x1=right?from.x2-2:b.x2-2, x2=right?b.x1+2:from.x1+2; const t={type:'bridge',x1:Math.min(x1,x2),x2:Math.max(x1,x2),y:from.y,dir:s.face,born:now,prog:0,dur:1.2,done:false,surfs:[],seed:Math.random()*9}; t.surfs=[{x1:t.x1,x2:t.x2,y:t.y}]; this.tools.push(t); s.tool=t; s.mode='draw'; break; }
      case 'tramp': { const px=clamp(s.x+s.face*14,from.x1+12,from.x2-12); const t={type:'tramp',x:px,y:from.y,born:now,prog:0,dur:1.0,done:false,surfs:[],seed:Math.random()*9}; t.surfs=[{x1:px-10,x2:px+10,y:from.y,bounce:true,bounceTo:b}]; this.tools.push(t); s.tool=t; s.mode='draw'; s.face=px>s.x?1:-1; break; }
      default: s.act=null;
    }
  }
  after(t){ const s=this.s;
    if(t.type==='rope'){ s.mode='rope'; s.ropeEnd=t.then.end; s.x=t.ax+s.face*-3; s.y=t.ay+24; s.surf=null; s.rope=t; return; }
    if(t.type==='ladder'){ s.mode='climb'; s.x=t.x-s.face*0; s.climb={speed:36,topY:t.y2,then:'walk',surf:t.then.surf,ladder:t}; s.surf=null; return; }
    if(t.type==='hook'){ s.mode='grapple'; s.t=0; s.g0={x:s.x,y:s.y}; s.surf=null; return; }
    if(t.type==='tramp'){ this.gather(); const ts=this.match(t.surfs[0])||t.surfs[0]; s.vy=-jumpV(20); s.vx=(t.x-s.x)*2; s.mode='air'; s.fallFrom=s.y; s.landTarget=ts; s.surf=null; return; }
    this.gather(); s.mode='walk'; s.act=null; // stairs, bridge: replan through the new surfaces
  }

  // ---------- drawing ----------
  ik(ax,ay,bx,by,l1,l2,dir){ let dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy)||.001; const L=l1+l2-.05; if(d>L){dx*=L/d;dy*=L/d;d=L;} const c=clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1); const a=Math.acos(c),base=Math.atan2(dy,dx),ang=base+dir*a; return [ax+Math.cos(ang)*l1,ay+Math.sin(ang)*l1,ax+dx,ay+dy]; }
  limb(ax,ay,bx,by,l,dir){ const k=this.ik(ax,ay,bx,by,l,l,dir); const c=this.ctx; c.beginPath(); c.moveTo(ax,ay); c.lineTo(k[0],k[1]); c.lineTo(k[2],k[3]); c.stroke(); return k; }
  L(a,b,c,d){ const x=this.ctx; x.beginPath(); x.moveTo(a,b); x.lineTo(c,d); x.stroke(); }
  sketch(x1,y1,x2,y2,prog,seed){ const c=this.ctx,len=Math.hypot(x2-x1,y2-y1)*prog,ang=Math.atan2(y2-y1,x2-x1),nx=-Math.sin(ang),ny=Math.cos(ang); for(let p=0;p<2;p++){ c.beginPath(); for(let i=0;i<=len;i+=4){ const w=Math.sin(i*.8+seed+p*2.1)*.7+p*.6,x=x1+Math.cos(ang)*i+nx*w,y=y1+Math.sin(ang)*i+ny*w; i===0?c.moveTo(x,y):c.lineTo(x,y);} c.stroke(); } return [x1+Math.cos(ang)*len,y1+Math.sin(ang)*len]; }
  pencil(bx,by,ang){ const c=this.ctx,co=Math.cos(ang),si=Math.sin(ang),nx=-si*1.2,ny=co*1.2,L=this.L.bind(this); c.lineWidth=1.2;
    L(bx+nx,by+ny,bx+co*12+nx,by+si*12+ny); L(bx-nx,by-ny,bx+co*12-nx,by+si*12-ny); L(bx+co*12+nx,by+si*12+ny,bx+co*PEN,by+si*PEN); L(bx+co*12-nx,by+si*12-ny,bx+co*PEN,by+si*PEN);
    c.lineWidth=2; L(bx+co*15,by+si*15,bx+co*PEN,by+si*PEN); c.lineWidth=1; L(bx+co*2+nx,by+si*2+ny,bx+co*2-nx,by+si*2-ny); c.beginPath(); c.arc(bx+co*.6,by+si*.6,1.3,0,7); c.stroke(); c.lineWidth=1.8; }
  drawTools(now){
    const c=this.ctx,s=this.s; let tip=null;
    for(const t of this.tools){
      const age=now-t.born; c.globalAlpha=clamp((14000-age)/1500,0,1); c.lineWidth=1.5; const mine=t===s.tool&&s.mode==='draw'; const p=t.prog;
      if(t.type==='stairs'){ let i=0; for(const st of t.steps){ const sp=clamp(p*t.steps.length-i,0,1); if(sp<=0)break; const from=t.dir>0?st.x1:st.x2,to=t.dir>0?st.x2:st.x1; const e=this.sketch(from,st.y,to,st.y,sp,t.seed+i); if(sp<1&&mine)tip=e; i++; } if(mine&&!tip)tip=[t.dir>0?t.steps[0].x1:t.steps[0].x2,t.steps[0].y]; }
      else if(t.type==='perch'){ this.sketch(t.x1,t.y,t.x2,t.y,1,t.seed); }
      else if(t.type==='ladder'){ const h=t.y1-t.y2; const e1=this.sketch(t.x-5,t.y1,t.x-5,t.y2,p,t.seed), e2=this.sketch(t.x+5,t.y1,t.x+5,t.y2,p,t.seed+3); for(let y=t.y1-8;y>t.y1-h*p;y-=9)this.L(t.x-5,y,t.x+5,y); if(mine)tip=e2; }
      else if(t.type==='bridge'){ const from=t.dir>0?t.x1:t.x2,to=t.dir>0?t.x2:t.x1; const e=this.sketch(from,t.y,to,t.y,p,t.seed); for(let x=t.x1+6;x<t.x1+(t.x2-t.x1)*p;x+=10)this.L(x,t.y,x,t.y+4); if(mine)tip=e; }
      else if(t.type==='tramp'){ c.beginPath(); c.arc(t.x,t.y+2,10,Math.PI,Math.PI+Math.PI*p); c.stroke(); if(p>.6){this.L(t.x-8,t.y+2,t.x-8,t.y+6);this.L(t.x+8,t.y+2,t.x+8,t.y+6);} if(mine)tip=[t.x+Math.cos(Math.PI+Math.PI*p)*10,t.y+2+Math.sin(Math.PI+Math.PI*p)*10]; }
      else if(t.type==='rope'){ const len=t.len*p; c.beginPath(); for(let i=0;i<=len;i+=4){ const x=t.ax+Math.sin(i*.5+t.seed)*.8; i===0?c.moveTo(x,t.ay):c.lineTo(x,t.ay+i);} c.stroke(); c.beginPath(); c.arc(t.ax,t.ay,2.5,0,7); c.stroke(); if(mine)tip=[t.ax,t.ay+len]; }
      else if(t.type==='hook'){ if(mine){ const hx=s.x+s.face*8,hy=s.y-19,k=Math.min(1,p/.45),a0=Math.PI*.2,a1=a0+Math.PI*1.4*k; c.beginPath(); c.arc(hx,hy,3.5,a0,a1); c.stroke(); tip=[hx+Math.cos(a1)*3.5,hy+Math.sin(a1)*3.5]; if(p>.45){const f=(p-.45)/.55; this.L(hx,hy,hx+(t.ax-hx)*f,hy+(t.ay-hy)*f);} }
        else { c.beginPath(); c.arc(t.ax,t.ay+3,3.5,Math.PI*.2,Math.PI*1.6); c.stroke(); if(s.mode==='grapple'&&s.tool===t)this.L(s.x+s.face*4,s.y-18,t.ax,t.ay); } }
      c.globalAlpha=1;
    }
    return tip;
  }
  draw(now,m){
    const c=this.ctx,s=this.s,d=this.dpr,sy=scrollY; c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,this.cv.width,this.cv.height); c.setTransform(d,0,0,d,0,-sy*d);
    c.strokeStyle=INK; c.fillStyle=INK; c.lineWidth=1.8; c.lineCap='round'; c.lineJoin='round';
    const tip=this.drawTools(now); const L=this.L.bind(this),f=s.face;
    if(s.mode==='dead'){ const k=Math.min(1,(now-s.deadT)/700),fade=clamp(1-Math.max(0,(now-s.deadT-1200)/2000),0,1); c.globalAlpha=fade; c.save(); c.translate(s.x,s.y); c.rotate(-f*k*k*Math.PI/2); L(0,HIP,-2.5,0); L(0,HIP,2.5,0); L(0,HIP,0,SH); c.beginPath(); c.arc(0,HEAD,HR,0,7); c.stroke(); L(0,SH,-5,SH+6); L(0,SH,5,SH+5); c.restore(); if(k>=1){c.lineWidth=1.2;for(let i=0;i<3;i++){const ox=s.x-f*16+i*6-6,oy=s.y-30-Math.sin(now/300+i)*2;L(ox-2,oy-2,ox+2,oy+2);L(ox-2,oy+2,ox+2,oy-2);}} c.globalAlpha=1; return; }
    const hitK=s.hitT?Math.max(0,1-(now-s.hitT)/450):0; if(hitK>0)c.globalAlpha=.45+.55*Math.abs(Math.sin(now/40));
    let x=s.x,y=s.y-(hitK>0?Math.sin(hitK*Math.PI)*5:0);
    const narrow=s.surf&&!s.surf.ground&&(s.surf.x2-s.surf.x1)<30&&s.mode==='walk'&&s.vx===0;
    const sway=narrow?Math.sin(s.t*4)*1.5:0;
    if(s.mode==='roll'){ const k=s.t/.45; c.save(); c.translate(x+f*0,y-6); c.rotate(f*k*Math.PI*2); c.beginPath(); c.arc(0,-3,HR,0,7); c.stroke(); L(0,0,-3,4); L(-3,4,2,6); L(0,0,3,4); L(3,4,-1,6); L(0,0,-4,-1); L(0,0,4,-1); c.restore(); c.globalAlpha=1; return; }
    if(s.mode==='sit'){ const dir=s.sitDir||f; const hx=x,hy=y-3; L(hx,hy,hx,hy+SH-HIP); c.beginPath(); c.arc(hx,hy+HEAD-HIP,HR,0,7); c.stroke(); const dang=Math.sin(s.t*2.2)*1.5; if(dir){ this.limb(hx,hy,hx+dir*4,hy+9+dang,LEG,-dir); this.limb(hx,hy,hx+dir*6,hy+8-dang,LEG,-dir); } else { L(hx,hy,hx-8,hy+2); L(hx,hy,hx+8,hy+2); } this.limb(hx,hy+SH-HIP,hx+dir*4,hy+1,ARM,dir||1); this.limb(hx,hy+SH-HIP,hx-3,hy+1,ARM,-1); this.pencil(hx-8,hy+1,0.1*Math.sin(s.t)); c.globalAlpha=1; return; }
    if(s.mode==='hang'||(s.mode==='climb'&&s.climb.wall)||s.mode==='mantle'){
      const an=s.mode==='climb'?{x:s.climb.wx+ (f)*4,y:s.y-24}:s.anchor; const k=s.mode==='mantle'?Math.min(1,s.t/.6):0;
      const hx=s.mode==='mantle'?x:an.x, hy=s.mode==='mantle'?y+SH*(k)+(1-k)*(an.y+7):an.y+7; // shoulder
      const swing=s.mode==='hang'?Math.sin(s.t*3)*2:0;
      const shx=s.mode==='mantle'?hx:an.x-f*3+swing*.3, shy=hy, hipx=shx-f*1+swing*.5, hipy=shy+7, fy=hipy+9;
      if(s.mode==='climb'){ const ph=s.ph; this.limb(shx,shy,an.x,shy-6+Math.sin(ph)*3,ARM,-f); this.limb(shx,shy,an.x,shy-6-Math.sin(ph)*3,ARM,f); L(shx,shy,hipx,hipy); this.limb(hipx,hipy,an.x-f*1,hipy+8+Math.cos(ph)*2,LEG,f); this.limb(hipx,hipy,an.x-f*1,hipy+8-Math.cos(ph)*2,LEG,f); c.beginPath(); c.arc(shx-f*1,shy-4.5,HR,0,7); c.stroke(); this.pencil(hipx-f*3,hipy-2,-Math.PI/2-f*.5); c.globalAlpha=1; return; }
      if(s.mode==='hang'){ this.limb(shx,shy,an.x-1.5,an.y+1,ARM,-1); this.limb(shx,shy,an.x+1.5,an.y+1,ARM,1); L(shx,shy,hipx,hipy); this.limb(hipx,hipy,hipx-f*2+swing,fy,LEG,-f); this.limb(hipx,hipy,hipx+f*1+swing,fy-1,LEG,-f); c.beginPath(); c.arc(shx,shy-4.5,HR,0,7); c.stroke(); this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); c.globalAlpha=1; return; }
      // mantle: crouch rising
      const sx=x+f*1, sh=y+SH+3*(1-k), hip=y+HIP+2*(1-k); L(sx,sh,x,hip); c.beginPath(); c.arc(sx,sh-4.5,HR,0,7); c.stroke(); this.limb(x,hip,x-f*3,y,LEG,-f); this.limb(x,hip,x+f*3,y,LEG,-f); this.limb(sx,sh,an.x+f*6*k,an.y+2-2*k,ARM,-f); this.limb(sx,sh,an.x+f*2,an.y+1,ARM,f); this.pencil(x-f*3,hip-1,-Math.PI/2-f*.5); c.globalAlpha=1; return;
    }
    if(s.mode==='slide'){ const wx=s.slideX; const shx=wx-f*0,shy=y-16,hipx=wx-f*1,hipy=y-9; L(shx,shy,hipx,hipy); c.beginPath(); c.arc(shx-f*1,shy-4.5,HR,0,7); c.stroke(); this.limb(hipx,hipy,wx+f*3,y-2,LEG,f); this.limb(hipx,hipy,wx+f*5,y-4,LEG,f); this.limb(shx,shy,wx+f*3,shy-5,ARM,f); this.limb(shx,shy,wx-f*4,shy+3,ARM,-f); c.lineWidth=1; for(let i=0;i<3;i++)L(wx+f*4,y-22-i*5+(s.ph%1)*5,wx+f*4,y-18-i*5+(s.ph%1)*5); c.lineWidth=1.8; this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); c.globalAlpha=1; return; }
    if(s.mode==='climb'||s.mode==='rope'){ const lx=s.mode==='rope'?s.rope.ax:s.climb.ladder.x; const ph=s.ph; const shx=lx-f*3,shy=y-17,hipx=lx-f*3,hipy=y-10; L(shx,shy,hipx,hipy); c.beginPath(); c.arc(shx,shy-4.5,HR,0,7); c.stroke(); this.limb(shx,shy,lx,shy-7+Math.sin(ph)*3,ARM,-f); this.limb(shx,shy,lx,shy-7-Math.sin(ph)*3,ARM,f); this.limb(hipx,hipy,lx-1,y-2+Math.cos(ph)*2,LEG,f); this.limb(hipx,hipy,lx+1,y-2-Math.cos(ph)*2,LEG,f); this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); c.globalAlpha=1; return; }
    // grounded / air / attack / draw / grapple
    let lean=0; if(s.mode==='attack')lean=f*Math.max(0,Math.sin(s.t*6.5))*6; if(s.mode==='walk'&&s.vx!==0)lean=f*1.5; if(s.mode==='air')lean=f*2;
    const hipx=x+sway*.3,hipy=y+HIP,shx=x+lean+sway,shy=y+SH,hdx=shx+lean*.3,hdy=y+HEAD+(narrow?Math.sin(s.t*4)*.5:0);
    // legs
    if(s.mode==='air'||s.mode==='grapple'){ if(s.umb){ this.limb(hipx,hipy,x-f*2,y-1,LEG,-f); this.limb(hipx,hipy,x+f*2,y-1,LEG,-f);} else { this.limb(hipx,hipy,x-f*3,y-4,LEG,-f); this.limb(hipx,hipy,x+f*3,y-2,LEG,-f);} }
    else if(s.mode==='attack'){ const lg=Math.max(0,Math.sin(s.t*6.5)); this.limb(hipx,hipy,x+f*(3+lg*7),y,LEG,-f); this.limb(hipx,hipy,x-f*4,y,LEG,-f); }
    else if(s.mode==='walk'&&s.vx!==0){ for(let i=0;i<2;i++){ const p=s.ph+i*Math.PI; const fx=x+Math.sin(p)*4.5*f, fy=y-Math.max(0,Math.cos(p))*3.2; this.limb(hipx,hipy,fx,fy,LEG,-f); } }
    else { this.limb(hipx,hipy,x-3,y,LEG,-1); this.limb(hipx,hipy,x+3,y,LEG,1); }
    L(hipx,hipy,shx,shy); c.beginPath(); c.arc(hdx,hdy,HR,0,7); c.stroke();
    // arms + props
    if(s.mode==='attack'){ const sw=Math.sin(s.t*13),ang=-1.15+sw*.95; const hx=shx+Math.cos(ang)*ARM*1.8*f,hy=shy+Math.sin(ang)*ARM*1.8; this.limb(shx,shy,hx,hy,ARM,f); const sx=hx+Math.cos(ang)*17*f,sy2=hy+Math.sin(ang)*17; c.lineWidth=2; L(hx,hy,sx,sy2); c.lineWidth=1.8; L(hx-Math.sin(ang)*3*f,hy+Math.cos(ang)*3,hx+Math.sin(ang)*3*f,hy-Math.cos(ang)*3); c.globalAlpha*=.35; c.lineWidth=1; c.beginPath(); c.arc(hx,hy,17,f>0?ang-.9:Math.PI-ang,f>0?ang:Math.PI-ang+.9); c.stroke(); c.globalAlpha=hitK>0?c.globalAlpha/.35:1; c.lineWidth=1.8; if(Math.abs(sw)>.93){for(let i=0;i<4;i++){const a2=i*1.6+s.t*3;L(m.x+Math.cos(a2)*16,m.y+Math.sin(a2)*16,m.x+Math.cos(a2)*23,m.y+Math.sin(a2)*23);}} this.limb(shx,shy,shx-f*5,shy+5,ARM,-f); }
    else if(s.mode==='draw'&&tip){ let ang=Math.atan2(tip[1]-shy,tip[0]-shx); let hx=tip[0]-Math.cos(ang)*PEN,hy=tip[1]-Math.sin(ang)*PEN; const dd=Math.hypot(hx-shx,hy-shy); if(dd>ARM*2){ /* lean toward it */ } this.limb(shx,shy,hx,hy,ARM,-f); const k=this.ik(shx,shy,hx,hy,ARM,ARM,-f); this.pencil(k[2],k[3],Math.atan2(tip[1]-k[3],tip[0]-k[2])); this.limb(shx,shy,shx-f*4,shy+6,ARM,f); }
    else if(s.umb){ const k=s.umbK||0,ux=shx+f*2,uy=shy-14,R=3+9*k; this.limb(shx,shy,ux,uy+4,ARM,-f); L(ux,uy+4,ux,uy-6); c.beginPath(); c.arc(ux,uy-6,R,Math.PI,0); c.stroke(); for(let i=-R;i<=R;i+=R/2)L(ux+i,uy-6,ux+i,uy-4+2*(1-k)); this.limb(shx,shy,shx-f*3,shy+7,ARM,f); this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); }
    else if(s.mode==='grapple'){ this.limb(shx,shy,shx+f*5,shy-7,ARM,-f); this.limb(shx,shy,shx-f*4,shy+5,ARM,f); this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); }
    else if(narrow){ this.limb(shx,shy,shx-8,shy-1+sway,ARM,-1); this.limb(shx,shy,shx+8,shy-1-sway,ARM,1); this.pencil(hipx-f*3,hipy-1,-Math.PI/2-f*.5); }
    else { const bob=(s.mode==='walk'&&s.vx!==0)?Math.sin(s.ph*2)*.7:0; const py=hdy-6+bob; this.limb(shx,shy,hdx-4,py+1,ARM,-1); this.limb(shx,shy,hdx+4,py+1,ARM,1); this.pencil(hdx-f*8.5,py-.5,f>0?-bob*.06:Math.PI+bob*.06); }
    c.globalAlpha=1;
  }
}

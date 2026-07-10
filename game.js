// SkyEmpire — game engine
"use strict";
const SAVE_KEY = "skyempire_save_v1";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b)=>a+Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

function fmtMoney(v){
  const neg = v<0?"−":""; v=Math.abs(v);
  if(v>=1e9) return neg+"$"+(v/1e9).toFixed(1)+"B";
  if(v>=1e6) return neg+"$"+(v/1e6).toFixed(1)+"M";
  if(v>=1e3) return neg+"$"+Math.round(v/1e3)+"K";
  return neg+"$"+Math.round(v);
}
const fmtNum = v => Math.round(v).toLocaleString("en-US");
const fmtKm = v => fmtNum(v)+" km";
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

function haversine(a,b){
  const R=6371, toR=Math.PI/180;
  const dLat=(b.lat-a.lat)*toR, dLng=(b.lng-a.lng)*toR;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
const distKm = (f,t)=>haversine(AP[f],AP[t]);
const flightHours = (dist,speed)=>dist/speed+0.5;
const freqCap = fh => Math.max(1, Math.floor(18/(2*fh+1.5)));
const fare = dist => 45+0.095*dist;
const falloff = dist => clamp(1.6-dist/9000, 0.25, 1.3);
const WD_MULT = d => WEEKDAY[(weekday(d)+1)%7]; // WEEKDAY is Sun-first
const CARGO_WD = d => (weekday(d)>=5)?0.7:1;
const weekday = day => (day-1)%7; // 0=Mon
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function crewRate(ac){
  if(ac.kind==="cargo") return (ac.model==="ATR 72F"||ac.model==="737-800BCF")?1400:2600;
  return ["Widebody","Large","Jumbo"].includes(ac.cls)?2600:1400;
}
const isWide = ac => ["Widebody","Large","Jumbo"].includes(ac.cls);
function fleetFamilies(){ return new Set(S.fleet.map(a=>FAMILY(a.model))).size; }
function maintSurcharge(){ return Math.max(0,fleetFamilies()-3)*0.15; }
// Runway physics: altitude-adjusted required runway; single source of truth
const CLASS_MIN_RW={Turboprop:3600,Regional:5800,Narrowbody:6600,Widebody:8500,Large:9500,Jumbo:10000};
const CLASS_ORDER=["Turboprop","Regional","Narrowbody","Widebody","Large","Jumbo"];
function reqRunwayFt(spec,ap){ return spec.minRunwayFt*(1+(ap.elev||0)/25000); }
function canOperate(spec,ap){ return (ap.rw||0)>=reqRunwayFt(spec,ap); }
function runwayReason(spec,ap){ return `Runway too short — needs ${fmtNum(reqRunwayFt(spec,ap))} ft (adj. for altitude), longest here is ${fmtNum(ap.rw||0)} ft`; }
function maxClassAt(ap){ let best="—"; for(const c of CLASS_ORDER) if((ap.rw||0)>=CLASS_MIN_RW[c]*(1+(ap.elev||0)/25000)) best=c; return best; }
function effSvcTier(r,dist){ let t=r.svc||0; while(t>0&&dist<SVC[t].minKm)t--; return t; }
// Flight Rating System: 0–100 from price, service, comfort, condition
function routeRating(r,acObj){
  const spec=AC[r.acModel];
  const dist=distKm(r.from,r.to);
  const cond=acObj?acObj.condition:100;
  let pts=50+(1.25-r.m)*40+(cond-75)*0.4;
  if(spec.classic)pts-=8;
  if(r.type==="pax"){
    pts+=SVC[effSvcTier(r,dist)].pts-(dist>3000?12:dist>800?6:2);
    if(acObj){const c=seatCfg(acObj);pts+=Math.min(10,(c.b*3+c.p*1.5)/Math.max(1,spec.cap)*40);}
    if(isWide(spec)&&dist>7000)pts+=5;
  }
  return clamp(Math.round(pts),0,100);
}
function rivalNetwork(name){
  const rv=RIVALS.find(r=>r.name===name);
  const set=new Set([rv.base]);
  rv.routes.concat(S.rivalExtra.filter(x=>x.airline===name).map(x=>x.pair)).forEach(p=>{set.add(p[0]);set.add(p[1]);});
  return set;
}

// ---------- State ----------
let S = null; // game state
const RT = { map:null, arcs:{}, planeMarkers:{}, rivalMarkers:[], routeLines:[], apMarkers:{}, lastMin:-1, lastReal:0, speed:1, uiTimer:0, saveTimer:0, chartTip:null };

function defaultState(){
  return {
    started:false, airline:"", code:"", difficulty:"Normal", cash:5e7,
    t:360, day:1, // t = game minutes since day1 00:00
    fuelIdx:1.0, fuelHist:[1.0], spikeUntil:0, spikeMult:1,
    hubs:[], mainHub:null,
    fleet:[], nextAcId:1,
    routes:[], nextRouteId:1, flights:[],
    loans:[], globalMkt:false, image:50, interline:{},
    livery:{base:"#4DA3FF",accent:"#E8EEF9",tail:"#4DA3FF",pattern:"cheatline",logo:"bird",},
    level:1, ach:{}, stats:{pax:0,tonnes:0,profitStreak:0},
    today:{rev:0,revPax:0,revCargo:0,revBelly:0,fuel:0,crew:0,fees:0,maint:0,lease:0,overhead:0,marketing:0,interest:0,svc:0,interline:0,other:0},
    pnl:[], usedRolls:{},
    events:{viralRoute:null,viralUntil:0,storm:null,stormDay:0},
    rivalExtra:[], nextRivalDay:10,
    negDays:0, gameOver:false,
    hint:true, sideCollapsed:false,
  };
}

function save(){ if(S&&S.started&&!S.gameOver) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
function load(){ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return null; try{return JSON.parse(raw);}catch(e){return null;} }

// ---------- Economics (single source of truth) ----------
function acById(id){ return S.fleet.find(a=>a.id===id); }
function routeById(id){ return S.routes.find(r=>r.id===id); }
function seatCfg(ac){ // {b,p,e}
  const spec=AC[ac.model];
  const b=ac.biz||0, p=ac.prem||0;
  return {b,p,e:Math.max(0,Math.floor(spec.cap-3*b-1.5*p))};
}
function effFuelIdx(){ return clamp(S.fuelIdx,0.75,1.45)*(S.day<=S.spikeUntil?S.spikeMult:1); }
function routeDemandMult(r){
  let m=1;
  if(r.marketing) m*=1.12;
  if(S.globalMkt) m*=1.05;
  if(S.events.viralRoute===r.id && S.day<=S.events.viralUntil) m*=1.8;
  m*=0.9+(S.image||50)/100*0.2; // airline image: 0.9–1.1
  for(const name in S.interline){
    if(!S.interline[name])continue;
    const net=rivalNetwork(name);
    if(net.has(r.from)||net.has(r.to)) m*=1.10;
  }
  return m;
}
// per-leg economics; r may be a hypothetical route {type,from,to,acModel,freq,m,marketing}; acObj optional live aircraft
function legEcon(r, dir, acObj, opts={}){
  const spec=AC[r.acModel];
  const from=dir===0?r.from:r.to, to=dir===0?r.to:r.from;
  const dist=distKm(r.from,r.to);
  const fh=flightHours(dist,spec.speed);
  const rating=routeRating(r,acObj);
  const loadShare=clamp(clamp(1.45-0.6*r.m,0.25,1.0)*(0.75+rating/100*0.5),0.15,1.0);
  const dm=routeDemandMult(r);
  const res={rev:0,revPax:0,revCargo:0,revBelly:0,fuel:0,crew:0,fee:0,maint:0,svc:0,pax:{e:0,p:0,b:0},tonnes:0,belly:0,fh,dist,seats:0,cap:0,rating};
  if(r.type==="pax"){
    const pool=Math.min(TIERS[AP[r.from].tier].pool,TIERS[AP[r.to].tier].pool)*falloff(dist)*famousMult(r.from,r.to)*WD_MULT(S.day)*dm;
    const cfg=acObj?seatCfg(acObj):{b:0,p:0,e:spec.cap};
    const ef=fare(dist);
    const pools={e:pool*0.82,p:pool*0.12,b:pool*0.06};
    const seats={e:cfg.e,p:cfg.p,b:cfg.b};
    let rev=0;
    for(const c of ["e","p","b"]){
      const pax=Math.min(seats[c],(pools[c]*loadShare)/r.freq);
      res.pax[c]=pax;
      rev+=pax*ef*(c==="e"?1:c==="p"?1.7:3.5)*r.m;
    }
    res.revPax=rev;
    res.seats=cfg.e+cfg.p+cfg.b; res.cap=res.seats;
    // belly cargo
    if(isWide(spec)){
      const cargoPool=Math.min(CARGO_POOL[AP[r.from].tier],CARGO_POOL[AP[r.to].tier])*falloff(dist);
      const used=opts.live?(opts.route.bellyUsedToday||0):0;
      const belly=Math.min(BELLY[spec.cls],Math.max(0,(cargoPool-used))*0.10);
      res.belly=belly;
      res.revBelly=belly*dist*0.60;
    }
  }else{
    const cargoPool=Math.min(CARGO_POOL[AP[r.from].tier],CARGO_POOL[AP[r.to].tier])*falloff(dist)*CARGO_WD(S.day)*dm;
    const tonnes=Math.min(spec.cap,(cargoPool*loadShare)/r.freq);
    res.tonnes=tonnes; res.cap=spec.cap;
    res.revCargo=tonnes*dist*0.60*r.m;
  }
  res.rev=res.revPax+res.revCargo+res.revBelly;
  res.fuel=spec.fuel*dist*effFuelIdx();
  res.crew=crewRate(spec)*fh;
  res.fee=TIERS[AP[to].tier].landing;
  const cond=acObj?acObj.condition:100;
  res.maint=spec.maint*fh*(cond<70?2:1)*(1+maintSurcharge());
  if(r.type==="pax")res.svc=SVC[effSvcTier(r,dist)].cost*(res.pax.e+1.5*res.pax.p+3*res.pax.b);
  res.cost=res.fuel+res.crew+res.fee+res.maint+res.svc;
  res.profit=res.rev-res.cost;
  return res;
}
function dailyEcon(r,acObj){ // both directions × freq
  const a=legEcon(r,0,acObj), b=legEcon(r,1,acObj);
  const sum={};
  for(const k of ["rev","revPax","revCargo","revBelly","fuel","crew","fee","maint","svc","cost","profit"]) sum[k]=(a[k]+b[k])*r.freq;
  sum.rating=Math.round((a.rating+b.rating)/2);
  sum.pax=(a.pax.e+a.pax.p+a.pax.b+b.pax.e+b.pax.p+b.pax.b)*r.freq;
  sum.tonnes=(a.tonnes+b.tonnes)*r.freq;
  sum.load=r.type==="pax"?sum.pax/((a.seats+b.seats)*r.freq||1):sum.tonnes/((a.cap+b.cap)*r.freq||1);
  sum.legs=r.freq*2; sum.fh=a.fh;
  return sum;
}
function netWorth(){
  let nw=S.cash;
  for(const a of S.fleet) if(!a.leased) nw+=AC[a.model].price*(a.condition/100);
  for(const h of S.hubs) nw+=TIERS[AP[h].tier].hubCost;
  for(const l of S.loans) nw-=l.amount;
  return nw;
}

// ---------- Money / cash flash ----------
function spend(v,cat){ S.cash-=v; addCost(cat,v); flashCash(-v); }
function addCost(cat,v){ if(S.today[cat]!==undefined) S.today[cat]+=v; else S.today.other+=v; }
function flashCash(v){
  const el=$("#tbCash"); if(!el)return;
  el.classList.remove("flash-up","flash-down"); void el.offsetWidth;
  el.classList.add(v>=0?"flash-up":"flash-down");
  setTimeout(()=>el.classList.remove("flash-up","flash-down"),300);
}

// ---------- Toasts / modal / confetti ----------
function toast(title,msg,type="info"){
  const t=document.createElement("div");
  t.className="toast "+(type==="ok"?"ok":type==="bad"?"bad":type==="warn"?"warn":"");
  t.innerHTML=`<b>${esc(title)}</b>${esc(msg)}`;
  $("#toasts").appendChild(t);
  setTimeout(()=>t.remove(),5000);
}
function openModal(html,large){
  $("#modal").className="modal"+(large?" large":"");
  $("#modal").innerHTML=html;
  $("#modalBackdrop").classList.remove("hidden");
}
function closeModal(){ $("#modalBackdrop").classList.add("hidden"); $("#modal").innerHTML=""; }

function confetti(){
  const cv=$("#confetti"),ctx=cv.getContext("2d");
  cv.width=innerWidth; cv.height=innerHeight;
  const ps=[]; const colors=[S.livery.base,"#2ECC8F","#FFB020","#FF5C6C","#E8EEF9"];
  for(let i=0;i<180;i++) ps.push({x:rand(0,cv.width),y:rand(-cv.height,0),vy:rand(2,6),vx:rand(-1.5,1.5),s:rand(4,9),c:pick(colors),r:rand(0,6.28)});
  const t0=performance.now();
  (function frame(now){
    ctx.clearRect(0,0,cv.width,cv.height);
    for(const p of ps){p.y+=p.vy;p.x+=p.vx;p.r+=0.1;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*0.6);ctx.restore();}
    if(now-t0<2000) requestAnimationFrame(frame); else ctx.clearRect(0,0,cv.width,cv.height);
  })(t0);
}

// ---------- Achievements & levels ----------
function award(id){
  if(S.ach[id])return;
  S.ach[id]={day:S.day};
  const a=ACHIEVEMENTS.find(x=>x.id===id);
  toast("Achievement unlocked "+a.icon,a.name,"ok");
}
function checkAchievements(){
  const owned=S.fleet;
  if(S.routes.length>=1)award("first_route");
  if(owned.length>=5)award("ac5");
  if(owned.length>=10)award("ac10");
  if(owned.some(a=>isWide(AC[a.model])))award("first_wide");
  if(owned.some(a=>a.model.startsWith("747")))award("queen");
  if(owned.some(a=>a.model==="A380"))award("superjumbo");
  if(owned.filter(a=>AC[a.model].classic).length>=3)award("vintage");
  if(owned.some(a=>AC[a.model].kind==="cargo"))award("first_freighter");
  if(S.stats.tonnes>=10000)award("cargo_mogul");
  if(S.hubs.length>=3)award("hubs3");
  if(S.hubs.length>=5)award("hubs5");
  if(S.routes.some(r=>distKm(r.from,r.to)>7000))award("intercont");
  if(S.stats.pax>=50000)award("pax50k");
  if(S.stats.pax>=500000)award("pax500k");
  const nw=netWorth();
  if(nw>=500e6)award("nw500m");
  if(nw>=5e9)award("nw5b");
  if(S.stats.profitStreak>=7)award("perfect_week");
}
function checkLevel(){
  const nw=netWorth();
  let lvl=1; for(let i=1;i<LEVELS.length;i++) if(nw>=LEVELS[i]) lvl=i+1;
  if(lvl>S.level){ S.level=lvl; confetti(); toast("Level up! ✨","Your airline reached level "+lvl,"ok"); renderNav(); }
}
function gate(what){ // returns null if allowed, else message
  const L=S.level;
  if(what.tier===4&&L<4)return "Tier-4 hubs unlock at level 4";
  if(what.tier===5&&L<7)return "Tier-5 hubs unlock at level 7";
  if(what.ac){const a=AC[what.ac];
    if(a.cls==="Large"&&L<5)return "Large aircraft unlock at level 5";
    if(a.cls==="Jumbo"&&L<6)return "Jumbo aircraft unlock at level 6";
    if(a.cls==="Heavy"&&L<4)return "Heavy freighters unlock at level 4";
  }
  return null;
}

// ---------- Arcs ----------
function arcCoords(from,to){
  const key=from+"-"+to;
  if(RT.arcs[key])return RT.arcs[key];
  const gc=new arc.GreatCircle({x:AP[from].lng,y:AP[from].lat},{x:AP[to].lng,y:AP[to].lat});
  const geo=gc.Arc(64,{offset:10});
  let coords=[]; geo.geometries.forEach(g=>coords=coords.concat(g.coords));
  // unwrap longitudes for continuity across the dateline
  const out=[coords[0].slice()];
  for(let i=1;i<coords.length;i++){
    let lng=coords[i][0]; const prev=out[i-1][0];
    while(lng-prev>180)lng-=360;
    while(lng-prev<-180)lng+=360;
    out.push([lng,coords[i][1]]);
  }
  RT.arcs[key]=out;
  return out;
}
function posOnArc(coords,prog){
  prog=clamp(prog,0,0.9999);
  const f=prog*(coords.length-1), i=Math.floor(f), t=f-i;
  const a=coords[i],b=coords[Math.min(i+1,coords.length-1)];
  const lng=a[0]+(b[0]-a[0])*t, lat=a[1]+(b[1]-a[1])*t;
  const brg=Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI;
  return {lat,lng,brg};
}

// ---------- Map ----------
function initMap(){
  if(RT.map)return;
  RT.map=L.map("map",{minZoom:2,maxZoom:7,worldCopyJump:true,zoomControl:true,preferCanvas:true}).setView([30,10],2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'}).addTo(RT.map);
  renderAirportMarkers();
  renderRouteLines();
  initRivalPlanes();
  $("#mapSearch").onkeydown=e=>{
    if(e.key!=="Enter")return;
    const q=e.target.value.trim().toLowerCase(); if(!q)return;
    const hit=AP[q.toUpperCase()]||AIRPORTS.find(a=>a.city.toLowerCase().startsWith(q))||AIRPORTS.find(a=>a.city.toLowerCase().includes(q));
    if(!hit){toast("Not found","No airport matches \""+e.target.value+"\"","warn");return;}
    RT.map.setView([hit.lat,hit.lng],Math.max(RT.map.getZoom(),5),{animate:false});
    openAirportPopup(hit,null);
  };
}
function renderAirportMarkers(){
  if(!RT.apLayer){
    RT.apLayer=L.layerGroup().addTo(RT.map);
    RT.map.on("moveend zoomend",renderAirportMarkers);
  }
  RT.apLayer.clearLayers();
  const z=RT.map.getZoom(), b=RT.map.getBounds().pad(0.25);
  const mine=new Set(S.hubs.concat(S.routes.flatMap(r=>[r.from,r.to])));
  for(const a of AIRPORTS){
    const isHub=S.hubs.includes(a.iata), served=mine.has(a.iata);
    if(!isHub&&!served){
      if(z<=3&&a.tier<3)continue;
      if(!b.contains([a.lat,a.lng]))continue;
    }
    let m;
    if(isHub){
      m=L.marker([a.lat,a.lng],{icon:L.divIcon({className:"ap-label",html:`<div style="width:14px;height:14px;border-radius:50%;background:${S.livery.base};border:2px solid #fff;box-shadow:0 0 6px ${S.livery.base}"></div><div class="ap-label" style="margin-top:1px">${a.iata}</div>`,iconSize:[40,26],iconAnchor:[7,7]})});
    }else if(served){
      m=L.circleMarker([a.lat,a.lng],{radius:6,color:S.livery.base,weight:2,fill:false});
      if(z>=5)m.bindTooltip(a.iata,{permanent:true,direction:"top",className:"ap-tip",offset:[0,-6]});
    }else{
      m=L.circleMarker([a.lat,a.lng],{radius:a.tier>=4?4.5:a.tier===3?3.5:2.5,stroke:false,fillColor:a.tier>=4?"#8DA0C0":"#5A6B8C",fillOpacity:0.8});
      if(z>=6||(z>=5&&a.tier>=3))m.bindTooltip(a.iata,{permanent:true,direction:"top",className:"ap-tip",offset:[0,-6]});
    }
    m.on("click",()=>openAirportPopup(a,m));
    RT.apLayer.addLayer(m);
  }
}
function airportPopupHTML(a){
  const isHub=S.hubs.includes(a.iata);
  const myPax=S.routes.filter(r=>r.type==="pax"&&(r.from===a.iata||r.to===a.iata)).reduce((s,r)=>{const d=dailyEcon(r,acById(r.acId));return s+d.pax;},0);
  const g=gate({tier:a.tier});
  const cost=TIERS[a.tier].hubCost;
  let btn=isHub?`<span class="badge brand">HUB</span>`:
    g?`<span class="badge">${g}</span>`:
    `<button class="btn sm primary" onclick="openHub('${a.iata}')" ${S.cash<cost?"disabled":""}>Open Hub ${fmtMoney(cost)}</button>`;
  let ops="";
  if(isHub&&S.fleet.length){
    const models=[...new Set(S.fleet.map(x=>x.model))];
    const ok=models.filter(mo=>canOperate(AC[mo],a)), no=models.filter(mo=>!canOperate(AC[mo],a));
    ops=`<br><span class="sub">Operable: ${ok.join(", ")||"none"}${no.length?" · Blocked: "+no.join(", "):""}</span>`;
  }
  return `<b>${esc(a.city)} (${a.iata})</b><br><span class="stars">${"★".repeat(a.tier)}</span> <span class="badge">${maxClassAt(a)}</span><br>Runway ${fmtNum(a.rw)} ft${a.elev>2000?` · elev ${fmtNum(a.elev)} ft`:""}<br>My daily pax: ${fmtNum(myPax)}${ops}<br>${btn}`;
}
function openAirportPopup(a,m){
  if(m)m.bindPopup(airportPopupHTML(a)).openPopup();
  else L.popup().setLatLng([a.lat,a.lng]).setContent(airportPopupHTML(a)).openOn(RT.map);
}
window.openHub=function(iata){
  const a=AP[iata], cost=TIERS[a.tier].hubCost;
  if(S.cash<cost||gate({tier:a.tier}))return;
  spend(cost,"other"); S.hubs.push(iata);
  toast("Hub opened","New hub at "+a.city,"ok");
  renderAirportMarkers(); checkAchievements(); checkLevel(); save(); closeModal();
  RT.map&&RT.map.closePopup();
};
function renderRouteLines(){
  RT.routeLines.forEach(l=>RT.map.removeLayer(l)); RT.routeLines=[];
  if(!RT.map)return;
  for(const r of S.routes){
    const coords=arcCoords(r.from,r.to).map(c=>[c[1],c[0]]);
    const l=L.polyline(coords,{color:S.livery.base,opacity:0.6,weight:2}).addTo(RT.map);
    RT.routeLines.push(l);
  }
  for(const rv of RIVALS){
    for(const rr of rv.routes.concat(S.rivalExtra.filter(x=>x.airline===rv.name).map(x=>x.pair))){
      const coords=arcCoords(rr[0],rr[1]).map(c=>[c[1],c[0]]);
      const l=L.polyline(coords,{color:rv.color,opacity:0.18,weight:1.5}).addTo(RT.map);
      RT.routeLines.push(l);
    }
  }
}
function planeSVG(color,type,big){
  const s=big?28:22;
  if(type==="prop")return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="${color}" d="M12 2c.5 0 .9.4 1 1l.4 6 7.6 2.5v2l-7.6-.9-.4 6.5 2.5 1.6v1.5L12 21.5 8.5 22.2v-1.5L11 19.1l-.4-6.5-7.6.9v-2L10.6 9l.4-6c.1-.6.5-1 1-1z"/><circle cx="12" cy="4" r="2.4" fill="${color}" opacity=".45"/></svg>`;
  if(type==="cargo")return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="${color}" d="M12 1.5c.9 0 1.6.6 1.7 1.5l.5 6.5 8.3 3v2.3l-8.3-1-.4 5.7 2.7 1.8v1.7L12 22l-4.5 1v-1.7L10.2 19.5 9.8 13.8l-8.3 1v-2.3l8.3-3 .5-6.5c.1-.9.8-1.5 1.7-1.5z"/></svg>`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="${color}" d="M12 2c.4 0 .8.3.9.8l.6 6.7 8 2.8v1.9l-8-1-.5 6.3 2.6 1.7v1.4L12 21.8l-3.6.8v-1.4l2.6-1.7-.5-6.3-8 1v-1.9l8-2.8.6-6.7c.1-.5.5-.8.9-.8z"/></svg>`;
}
function planeIcon(color,spec,rot){
  const type=spec.kind==="cargo"?"cargo":spec.cls==="Turboprop"?"prop":"jet";
  const big=spec.cls==="Jumbo";
  return L.divIcon({className:"plane-icon",html:`<div style="transform:rotate(${rot}deg)">${planeSVG(color,type,big)}</div>`,iconSize:[28,28],iconAnchor:[14,14]});
}
function flightNo(r,dir){ return (AC[r.acModel]?AC[r.acModel].kind:"pax")==="cargo"?"📦 "+S.code+(100+r.id*2+dir):S.code+(100+r.id*2+dir); }
function updatePlanes(){
  if(!RT.map)return;
  const now=S.t;
  const seen={};
  for(const f of S.flights){
    const r=routeById(f.routeId); if(!r)continue;
    const prog=(now-f.dep)/f.dur;
    const coords=arcCoords(f.from,f.to);
    const p=posOnArc(coords,prog);
    const key="f"+f.routeId+"_"+f.dep;
    seen[key]=1;
    const spec=AC[r.acModel];
    if(!RT.planeMarkers[key]){
      const m=L.marker([p.lat,p.lng],{icon:planeIcon(S.livery.base,spec,p.brg),zIndexOffset:500});
      m.addTo(RT.map);
      m.bindPopup(()=>{
        const e=legEcon(r,f.dir,acById(r.acId),{live:true,route:r});
        const paxLine=r.type==="pax"?`Pax: ${Math.round(e.pax.e)}E / ${Math.round(e.pax.p)}P / ${Math.round(e.pax.b)}B${e.belly?`<br>Belly: ${e.belly.toFixed(1)}t`:""}`:`Cargo: ${e.tonnes.toFixed(1)}t`;
        return `<b>${flightNo(r,f.dir)}</b> · ${f.from}→${f.to}<br>${esc(r.acModel)}<br>${paxLine}<br>Revenue: ${fmtMoney(e.rev)}`;
      });
      RT.planeMarkers[key]=m;
    }else{
      const m=RT.planeMarkers[key];
      m.setLatLng([p.lat,p.lng]);
      const el=m.getElement();
      if(el&&el.firstChild)el.firstChild.style.transform=`rotate(${p.brg}deg)`;
    }
  }
  // rivals
  let i=0;
  for(const rv of RIVALS){
    const all=rv.routes.concat(S.rivalExtra.filter(x=>x.airline===rv.name).map(x=>x.pair));
    for(const rr of all){
      const dist=distKm(rr[0],rr[1]);
      const dur=(dist/850+0.5)*60, period=2*(dur+45);
      const ph=((now+i*163)%period);
      let from,to,prog;
      if(ph<dur){from=rr[0];to=rr[1];prog=ph/dur;}
      else if(ph<dur+45){i++;cleanRival(i-1,seen);continue;}
      else if(ph<2*dur+45){from=rr[1];to=rr[0];prog=(ph-dur-45)/dur;}
      else{i++;cleanRival(i-1,seen);continue;}
      const p=posOnArc(arcCoords(from,to),prog);
      const key="rv"+i;
      seen[key]=1;
      if(!RT.rivalMarkers[i]){
        const m=L.marker([p.lat,p.lng],{icon:planeIcon(rv.color,AC["A320neo"],p.brg)});
        m.addTo(RT.map);
        m.bindPopup(`<b>${esc(rv.name)}</b><br>Fleet: ${all.length+4} aircraft · ${all.length} routes<br>Base: ${rv.base}`);
        RT.rivalMarkers[i]=m;
      }else{
        const m=RT.rivalMarkers[i];
        m.setLatLng([p.lat,p.lng]);
        const el=m.getElement();
        if(el&&el.firstChild)el.firstChild.style.transform=`rotate(${p.brg}deg)`;
      }
      i++;
    }
  }
  for(const k in RT.planeMarkers){
    if(!seen[k]){RT.map.removeLayer(RT.planeMarkers[k]);delete RT.planeMarkers[k];}
  }
}
function cleanRival(i,seen){ if(RT.rivalMarkers[i]){RT.map.removeLayer(RT.rivalMarkers[i]);RT.rivalMarkers[i]=null;} }
function initRivalPlanes(){}

// ---------- Simulation ----------
function tickMinutes(target){
  // process up to target game-minute
  while(RT.lastMin<Math.floor(target)){
    RT.lastMin++;
    const now=RT.lastMin;
    // day rollover
    const day=Math.floor(now/1440)+1;
    if(day>S.day){ midnight(day); }
    // arrivals
    for(let i=S.flights.length-1;i>=0;i--){
      const f=S.flights[i];
      if(now>=f.dep+f.dur){ landFlight(f); S.flights.splice(i,1); }
    }
    // departures
    for(const r of S.routes){
      const ac=acById(r.acId);
      if(!ac||ac.status!=="ok")continue;
      if(r.dayRef!==S.day){r.dayRef=S.day;r.legsToday=0;r.bellyUsedToday=0;r.nextDep=(S.day-1)*1440+360;r.paxToday=0;r.seatsToday=0;}
      if(r.legsToday>=r.freq*2)continue;
      if(ac.inFlight)continue;
      if(now>=r.nextDep){
        const dir=r.legsToday%2;
        const spec=AC[r.acModel];
        const dur=Math.round(flightHours(distKm(r.from,r.to),spec.speed)*60);
        S.flights.push({routeId:r.id,dep:now,dur,dir,from:dir===0?r.from:r.to,to:dir===0?r.to:r.from});
        ac.inFlight=true;
        r.legsToday++;
      }
    }
  }
  S.t=target;
}
function landFlight(f){
  const r=routeById(f.routeId); if(!r)return;
  const ac=acById(r.acId);
  const e=legEcon(r,f.dir,ac,{live:true,route:r});
  let rev=e.rev, cost=e.cost;
  // storm
  if(S.events.storm&&S.events.stormDay===S.day&&(f.from===S.events.storm||f.to===S.events.storm)){
    rev=0; cost*=0.5;
    e.revPax=e.revCargo=e.revBelly=0;
  }
  S.cash+=rev-cost;
  S.today.rev+=rev;
  S.today.revPax+=e.revPax; S.today.revCargo+=e.revCargo; S.today.revBelly+=e.revBelly;
  S.today.fuel+=e.fuel*(rev===0?0.5:1); S.today.crew+=e.crew*(rev===0?0.5:1);
  S.today.fees+=e.fee*(rev===0?0.5:1); S.today.maint+=e.maint*(rev===0?0.5:1);
  S.today.svc+=e.svc*(rev===0?0.5:1);
  S.image=clamp((S.image||50)+(e.rating-(S.image||50))*0.02,0,100);
  r.profitToday=(r.profitToday||0)+rev-cost;
  r.bellyUsedToday=(r.bellyUsedToday||0)+e.belly;
  const paxN=e.pax.e+e.pax.p+e.pax.b;
  S.stats.pax+=rev===0?0:paxN;
  S.stats.tonnes+=rev===0?0:e.tonnes+e.belly;
  r.paxToday=(r.paxToday||0)+(r.type==="pax"?paxN:e.tonnes);
  r.seatsToday=(r.seatsToday||0)+(r.type==="pax"?e.seats:e.cap);
  if(ac){
    ac.inFlight=false;
    const decay=AC[ac.model].classic?0.25:0.15;
    ac.condition=Math.max(1,ac.condition-decay*e.fh);
    ac.hoursToday=(ac.hoursToday||0)+e.fh;
    ac.profitToday=(ac.profitToday||0)+rev-cost;
  }
  r.nextDep=f.dep+f.dur+45;
  flashCash(rev-cost);
}
function midnight(newDay){
  // post P&L for S.day
  const t=S.today;
  const costs=t.fuel+t.crew+t.fees+t.maint+t.lease+t.overhead+t.marketing+t.interest+(t.svc||0)+(t.interline||0)+t.other;
  const net=t.rev-costs;
  S.pnl.push({day:S.day,net,...t,costs});
  if(S.pnl.length>60)S.pnl.shift();
  if(net>0){S.stats.profitStreak++;award("first_profit");}
  else S.stats.profitStreak=0;
  // 7-day loads
  for(const r of S.routes){
    r.loads=r.loads||[];
    r.loads.push(r.seatsToday? r.paxToday/r.seatsToday:0);
    if(r.loads.length>7)r.loads.shift();
    r.profitYest=r.profitToday||0; r.profitToday=0;
  }
  for(const a of S.fleet){a.utilYest=Math.min(1,(a.hoursToday||0)/14);a.hoursToday=0;a.profitYest=a.profitToday||0;a.profitToday=0;
    if(a.status==="overhaul"&&newDay>=a.statusUntil){a.status="ok";a.condition=100;toast("Overhaul complete",a.model+" back in service","ok");}
    if((a.status==="grounded"||a.status==="charter")&&newDay>=a.statusUntil){a.status="ok";}
  }
  S.day=newDay;
  S.today={rev:0,revPax:0,revCargo:0,revBelly:0,fuel:0,crew:0,fees:0,maint:0,lease:0,overhead:0,marketing:0,interest:0,svc:0,interline:0,other:0};
  // fuel walk
  S.fuelIdx=clamp(S.fuelIdx*(1+rand(-0.02,0.02)),0.75,1.45);
  S.fuelHist.push(effFuelIdx()); if(S.fuelHist.length>30)S.fuelHist.shift();
  // daily fixed costs
  let daily=0;
  for(const h of S.hubs)daily+=TIERS[AP[h].tier].overhead;
  S.today.overhead+=daily; S.cash-=daily;
  let lease=0;
  for(const a of S.fleet)if(a.leased)lease+=AC[a.model].lease/30;
  S.today.lease+=lease; S.cash-=lease;
  let mkt=S.routes.filter(r=>r.marketing).length*25e3+(S.globalMkt?150e3:0);
  S.today.marketing+=mkt; S.cash-=mkt;
  let ilFee=Object.values(S.interline).filter(Boolean).length*10e3;
  S.today.interline+=ilFee; S.cash-=ilFee;
  let interest=S.loans.reduce((s,l)=>s+l.amount*0.0003,0);
  S.today.interest+=interest; S.cash-=interest;
  // used market rolls
  S.usedRolls={};
  AIRCRAFT.filter(a=>a.classic).forEach(a=>S.usedRolls[a.model]=Math.round(rand(65,85)));
  // events
  rollEvent();
  // rivals
  if(S.day>=S.nextRivalDay&&S.rivalExtra.length<RIVAL_CANDIDATES.length){
    const cand=RIVAL_CANDIDATES[S.rivalExtra.length];
    const rv=pick(RIVALS);
    S.rivalExtra.push({airline:rv.name,pair:cand});
    S.nextRivalDay=S.day+9+Math.floor(rand(0,4));
    toast("Rival expansion",rv.name+" opened "+cand[0]+"–"+cand[1]);
    renderRouteLines();
  }
  // bankruptcy
  if(S.cash< -5e6){S.negDays++;
    if(S.negDays>=7){gameOver();return;}
  }else S.negDays=0;
  updateBanner();
  checkLevel(); checkAchievements();
  save();
  if(currentScreen()!=="map")renderScreen(currentScreen());
}
function rollEvent(){
  if(Math.random()>0.25)return;
  const type=pick(["fuel","storm","viral","maint","vip"]);
  if(type==="fuel"){
    S.spikeMult=1+rand(0.08,0.15); S.spikeUntil=S.day+2;
    toast("Fuel spike ⛽","Fuel prices up "+Math.round((S.spikeMult-1)*100)+"% for 3 days","warn");
  }else if(type==="storm"&&S.routes.length){
    const apts=[...new Set(S.routes.flatMap(r=>[r.from,r.to]))];
    S.events.storm=pick(apts); S.events.stormDay=S.day;
    toast("Storm ⛈️","Severe weather at "+S.events.storm+" — today's flights earn nothing","bad");
  }else if(type==="viral"&&S.routes.length){
    const r=pick(S.routes);
    S.events.viralRoute=r.id; S.events.viralUntil=S.day+1;
    toast("Viral route 🔥",r.from+"–"+r.to+" demand ×1.8 for 2 days","ok");
  }else if(type==="maint"){
    const cands=S.fleet.filter(a=>a.condition<80&&a.status==="ok");
    if(cands.length){const a=pick(cands);a.status="grounded";a.statusUntil=S.day+1;
      toast("Maintenance issue 🔧",a.model+" grounded for the day","warn");}
  }else if(type==="vip"){
    const cands=S.fleet.filter(a=>a.status==="ok");
    if(cands.length)vipOffer(pick(cands));
  }
  updateBanner();
}
function vipOffer(a){
  const hours=Math.round(rand(4,12));
  const pay=150e3*hours;
  let remaining=30;
  openModal(`<h2>VIP Charter Offer 🥂</h2>
    <p>A VIP client wants to charter your <b>${esc(a.model)}</b> for a ${hours}-hour trip. It will be out of service for 1 day.</p>
    <p class="mb">Payment: <b class="pos">${fmtMoney(pay)}</b></p>
    <div class="row"><button class="btn primary" id="vipYes">Accept</button><button class="btn" id="vipNo">Decline</button><span class="sub" id="vipTimer">30s to decide</span></div>`);
  const iv=setInterval(()=>{remaining--;const el=$("#vipTimer");if(el)el.textContent=remaining+"s to decide";
    if(remaining<=0){clearInterval(iv);closeModal();toast("Charter expired","The VIP offer lapsed");}},1000);
  $("#vipYes").onclick=()=>{clearInterval(iv);a.status="charter";a.statusUntil=S.day+1;S.cash+=pay;S.today.rev+=pay;S.today.revPax+=pay;flashCash(pay);toast("Charter accepted",fmtMoney(pay)+" earned","ok");closeModal();save();};
  $("#vipNo").onclick=()=>{clearInterval(iv);closeModal();};
}
function updateBanner(){
  const b=$("#banner");
  const msgs=[];
  if(S.negDays>0)msgs.push(`⚠️ BANKRUPTCY WARNING — cash below −$5M for ${S.negDays} day${S.negDays>1?"s":""} (game over at 7)`);
  if(S.day<=S.spikeUntil)msgs.push(`⛽ Fuel spike active (+${Math.round((S.spikeMult-1)*100)}%)`);
  if(msgs.length){b.textContent=msgs.join("   ·   ");b.className="banner"+(S.negDays>0?"":" warn");b.classList.remove("hidden");}
  else b.classList.add("hidden");
}
function gameOver(){
  S.gameOver=true; RT.speed=0;
  openModal(`<h2>💥 Bankruptcy</h2><p class="mb">${esc(S.airline)} has run out of cash. The banks have seized your fleet after 7 days below −$5M.</p>
  <p class="mb">Final stats: Day ${S.day} · ${fmtNum(S.stats.pax)} passengers flown · ${S.fleet.length} aircraft</p>
  <button class="btn primary" onclick="hardReset()">Start Over</button>`);
}
window.hardReset=function(){ localStorage.removeItem(SAVE_KEY); location.reload(); };

// ---------- Main loop ----------
function loop(now){
  requestAnimationFrame(loop);
  if(!S||!S.started||S.gameOver)return;
  const dt=Math.min(0.25,(now-RT.lastReal)/1000||0);
  RT.lastReal=now;
  if(RT.speed>0){
    const target=S.t+dt*RT.speed;
    tickMinutes(target);
    updatePlanes();
  }
  RT.uiTimer+=dt;
  if(RT.uiTimer>0.25){RT.uiTimer=0;renderTopbar();}
  RT.saveTimer+=dt;
  if(RT.saveTimer>30){RT.saveTimer=0;save();}
}

// ---------- Topbar ----------
function renderTopbar(){
  $("#tbCash").textContent=fmtMoney(S.cash);
  const t=S.today;
  const net=t.rev-(t.fuel+t.crew+t.fees+t.maint+t.lease+t.overhead+t.marketing+t.interest+(t.svc||0)+(t.interline||0)+t.other);
  $("#tbPnl").innerHTML=`Today <span class="${net>=0?"pos":"neg"}">${fmtMoney(net)}</span>`;
  $("#tbFuel").innerHTML=`⛽ ${effFuelIdx().toFixed(2)}${S.day<=S.spikeUntil?" 🔺":""}`;
  $("#tbImg").innerHTML=`⭐ ${Math.round(S.image||50)}`;
  const day=S.day, min=Math.floor(S.t%1440);
  $("#tbClock").textContent=`${DAYS[weekday(day)]} · Day ${day} · ${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`;
}

// ---------- Navigation / screens ----------
const NAV=[["map","Map","M3 12l7-9v5c8 0 11 5 11 9-3-3-6-4-11-4v5l-7-6z"],["fleet","Fleet","M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"],["routes","Routes","M4 18a3 3 0 106 0c0-1-1-2-3-4s-3-3-3-4a3 3 0 116 0h4a3 3 0 106 0"],["airports","Airports","M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"],["finances","Finances","M4 20h16M6 16l4-6 4 3 4-8"],["livery","Livery Studio","M12 2l2.4 7.2H22l-6 4.4 2.3 7.2L12 16.4 5.7 20.8 8 13.6 2 9.2h7.6z"],["achievements","Achievements","M7 3h10v5a5 5 0 01-10 0V3zM5 5H2a4 4 0 004 4M19 5h3a4 4 0 01-4 4M12 13v4m-4 4h8"]];
function renderNav(){
  $("#nav").innerHTML=NAV.map(([id,label,path])=>
    `<div class="nav-item${currentScreen()===id?" active":""}" data-nav="${id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${path}"/></svg>
      <span class="nav-label">${label}</span></div>`).join("");
  $$("#nav .nav-item").forEach(el=>el.onclick=()=>showScreen(el.dataset.nav));
}
let _screen="map";
function currentScreen(){return _screen;}
function showScreen(id){
  _screen=id;
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-"+id).classList.add("active");
  renderNav();
  renderScreen(id);
  if(id==="map"&&RT.map)setTimeout(()=>RT.map.invalidateSize(),50);
}
function renderScreen(id){
  if(id==="fleet")renderFleet();
  else if(id==="routes")renderRoutes();
  else if(id==="airports")renderAirports();
  else if(id==="finances")renderFinances();
  else if(id==="livery")renderLivery();
  else if(id==="achievements")renderAch();
}

// ---------- Fleet screen ----------
function condColor(c){return c>85?"var(--ok)":c>=60?"var(--warn)":"var(--bad)";}
function fuselageSVG(livery,opts={}){
  const w=opts.w||800,h=opts.h||220,retro=opts.retro;
  const base=livery.base,accent=livery.accent,tail=livery.tail,pat=livery.pattern;
  const bodyY=h*0.38,bodyH=h*0.3;
  let patternEl="";
  const bx=w*0.06,bw=w*0.78;
  if(pat==="cheatline")patternEl=`<rect x="${bx}" y="${bodyY+bodyH*0.42}" width="${bw}" height="${bodyH*0.14}" fill="${accent}"/>`;
  else if(pat==="swoosh")patternEl=`<path d="M${bx} ${bodyY+bodyH} Q ${w*0.45} ${bodyY+bodyH*0.2} ${bx+bw} ${bodyY+bodyH*0.75} L ${bx+bw} ${bodyY+bodyH} Z" fill="${accent}" opacity="0.9"/>`;
  else if(pat==="split")patternEl=`<rect x="${bx}" y="${bodyY+bodyH/2}" width="${bw}" height="${bodyH/2}" fill="${accent}"/>`;
  else if(pat==="retro")patternEl=`<rect x="${bx}" y="${bodyY+bodyH*0.35}" width="${bw}" height="${bodyH*0.09}" fill="${accent}"/><rect x="${bx}" y="${bodyY+bodyH*0.5}" width="${bw}" height="${bodyH*0.09}" fill="${tail}"/><rect x="${bx}" y="${bodyY+bodyH*0.65}" width="${bw}" height="${bodyH*0.09}" fill="${accent}"/>`;
  else if(pat==="tailfade")patternEl=`<defs><linearGradient id="tf${opts.uid||0}" x1="0" x2="1"><stop offset="55%" stop-color="transparent"/><stop offset="100%" stop-color="${tail}"/></linearGradient></defs><rect x="${bx}" y="${bodyY}" width="${bw}" height="${bodyH}" rx="${bodyH/2}" fill="url(#tf${opts.uid||0})"/>`;
  else if(pat==="belly")patternEl=`<path d="M${bx} ${bodyY+bodyH*0.62} h${bw} v${bodyH*0.38} h-${bw} Z" fill="${accent}"/>`;
  else if(pat==="wave")patternEl=`<path d="M${bx} ${bodyY+bodyH*0.6} Q ${w*0.3} ${bodyY+bodyH*0.3} ${w*0.5} ${bodyY+bodyH*0.6} T ${bx+bw} ${bodyY+bodyH*0.6} L ${bx+bw} ${bodyY+bodyH} L ${bx} ${bodyY+bodyH} Z" fill="${accent}" opacity="0.85"/>`;
  const retroLine=retro?`<rect x="${bx}" y="${bodyY+bodyH*0.44}" width="${bw}" height="${bodyH*0.1}" fill="#B85C38"/>`:"";
  const logo=LOGO_PATHS[livery.logo]||LOGO_PATHS.bird;
  const windows=Array.from({length:22},(_,i)=>`<rect x="${bx+bw*0.12+i*bw*0.036}" y="${bodyY+bodyH*0.22}" width="${bw*0.014}" height="${bodyH*0.16}" rx="2" fill="#0B1220" opacity="0.7"/>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <path d="M${bx+bw*0.86} ${bodyY+4} L ${w*0.93} ${h*0.1} L ${w*0.985} ${h*0.1} L ${bx+bw*0.97} ${bodyY+bodyH*0.5} Z" fill="${tail}"/>
    <g transform="translate(${w*0.905},${h*0.13}) scale(${w/800*1.4})">${logo.replace(/FILLC/g,accent)}</g>
    <rect x="${bx}" y="${bodyY}" width="${bw}" height="${bodyH}" rx="${bodyH/2}" fill="${base}"/>
    ${patternEl}${retroLine}
    <ellipse cx="${bx+bodyH*0.35}" cy="${bodyY+bodyH*0.5}" rx="${bodyH*0.5}" ry="${bodyH*0.5}" fill="${base}"/>
    <path d="M${bx+bw*0.06} ${bodyY+bodyH*0.3} a ${bodyH*0.35} ${bodyH*0.35} 0 0 0 -${bodyH*0.28} ${bodyH*0.12} l ${bodyH*0.4} 0 Z" fill="#18233C"/>
    ${windows}
    <path d="M${bx+bw*0.42} ${bodyY+bodyH} L ${bx+bw*0.3} ${h*0.92} L ${bx+bw*0.38} ${h*0.92} L ${bx+bw*0.5} ${bodyY+bodyH} Z" fill="${tail}" opacity="0.9"/>
    <text x="${bx+bw*0.55}" y="${bodyY+bodyH*0.58}" font-size="${bodyH*0.28}" font-weight="700" fill="${accent}" font-family="sans-serif">${esc(opts.name||S.airline||"")}</text>
  </svg>`;
}
const LOGO_PATHS={
 bird:`<path d="M0 8 Q6 0 14 2 Q8 4 6 10 Q4 14 0 14 Q2 11 0 8Z" fill="FILLC"/>`,
 star:`<path d="M7 0l2 5h5l-4 3 1.5 5L7 10 2.5 13 4 8 0 5h5z" fill="FILLC"/>`,
 globe:`<circle cx="7" cy="7" r="6" fill="none" stroke="FILLC" stroke-width="1.4"/><ellipse cx="7" cy="7" rx="3" ry="6" fill="none" stroke="FILLC" stroke-width="1.2"/><line x1="1" y1="7" x2="13" y2="7" stroke="FILLC" stroke-width="1.2"/>`,
 arrow:`<path d="M0 10 L10 0 L8 6 L14 5 L4 14 L6 8 Z" fill="FILLC"/>`,
 sun:`<circle cx="7" cy="7" r="4" fill="FILLC"/><g stroke="FILLC" stroke-width="1.4">${[0,45,90,135,180,225,270,315].map(a=>`<line x1="${7+5.5*Math.cos(a*Math.PI/180)}" y1="${7+5.5*Math.sin(a*Math.PI/180)}" x2="${7+7*Math.cos(a*Math.PI/180)}" y2="${7+7*Math.sin(a*Math.PI/180)}"/>`).join("")}</g>`,
 mountain:`<path d="M0 13 L5 3 L8 8 L10 5 L14 13 Z" fill="FILLC"/>`,
 wave:`<path d="M0 9 Q3 4 7 9 T14 9 L14 12 Q10 8 7 12 T0 12 Z" fill="FILLC"/>`,
 diamond:`<path d="M7 0 L14 7 L7 14 L0 7 Z" fill="FILLC"/>`,
 crescent:`<path d="M10 1 A7 7 0 1 0 10 13 A5.5 5.5 0 1 1 10 1Z" fill="FILLC"/>`,
 ring:`<circle cx="7" cy="7" r="5.5" fill="none" stroke="FILLC" stroke-width="2.6"/>`,
 leaf:`<path d="M2 12 Q0 2 12 1 Q14 12 4 13 Q6 7 10 4 Q4 7 2 12Z" fill="FILLC"/>`,
 bolt:`<path d="M8 0 L1 8 L6 8 L4 14 L12 5 L7 5 Z" fill="FILLC"/>`
};
function renderFleet(){
  const el=$("#screen-fleet");
  const cards=S.fleet.map(a=>{
    const spec=AC[a.model];
    const cfg=seatCfg(a);
    const status=a.status==="ok"?(a.inFlight?"In flight":"Ready"):a.status==="overhaul"?"Overhaul (day "+a.statusUntil+")":a.status==="charter"?"On charter":"Grounded";
    const sellVal=spec.price*0.6*(a.condition/100);
    return `<div class="fleet-card">
      ${fuselageSVG(S.livery,{w:400,h:110,retro:spec.classic,uid:a.id,name:S.code})}
      <div class="fleet-title">${esc(a.model)} ${spec.classic?'<span class="badge classic">CLASSIC</span>':""}${a.leased?'<span class="badge">LEASED</span>':""}${spec.kind==="cargo"?'<span class="badge">📦 FREIGHTER</span>':""}</div>
      <div class="fleet-meta">Base ${a.hub} · ${status} · ${spec.kind==="cargo"?spec.cap+"t payload":cfg.e+"E/"+cfg.p+"P/"+cfg.b+"B seats"} · min rwy ${fmtNum(spec.minRunwayFt)} ft</div>
      <div class="fleet-stats"><span>Condition ${Math.round(a.condition)}%</span><span>Util ${Math.round((a.utilYest||0)*100)}%</span><span>Today <span class="${(a.profitToday||0)>=0?"pos":"neg"}">${fmtMoney(a.profitToday||0)}</span></span></div>
      <div class="bar"><i style="width:${a.condition}%;background:${condColor(a.condition)}"></i></div>
      ${spec.kind==="cargo"?`<div class="sub" style="margin-top:6px">Payload</div><div class="bar"><i style="width:100%;background:var(--info)"></i></div>`:""}
      <div class="fleet-actions">
        ${spec.kind!=="cargo"?`<button class="btn sm" onclick="openSeatConfig(${a.id})">Seat Config</button>`:""}
        <button class="btn sm" onclick="openReassign(${a.id})">Reassign Hub</button>
        <button class="btn sm" onclick="doOverhaul(${a.id})" ${a.status!=="ok"||S.cash<spec.price*0.04?"disabled":""}>Overhaul ${fmtMoney(spec.price*0.04)}</button>
        <button class="btn sm danger" onclick="sellAc(${a.id})">${a.leased?"Return":"Sell "+fmtMoney(sellVal)}</button>
      </div></div>`;
  }).join("");
  const fam=fleetFamilies(), sur=maintSurcharge();
  el.innerHTML=`<div class="inner"><div class="spread mb"><h1 style="margin:0">Fleet</h1>
    <div class="row"><span class="chip" title="Distinct aircraft families — first 3 are free, each extra adds +15% maintenance fleet-wide">🔧 ${fam} maint. ${fam===1?"family":"families"}${sur>0?` · <span class="neg">+${Math.round(sur*100)}% maint</span>`:" (3 free)"}</span>
    <button class="btn primary" onclick="openBuyModal()">Buy Aircraft</button></div></div>
    ${S.fleet.length?`<div class="grid3">${cards}</div>`:`<div class="card">No aircraft yet. Buy your first plane to get started.</div>`}</div>`;
}
window.doOverhaul=function(id){
  const a=acById(id),spec=AC[a.model];
  const r=S.routes.find(r=>r.acId===id);
  spend(spec.price*0.04,"maint");
  a.status="overhaul"; a.statusUntil=S.day+2;
  toast("Overhaul started",a.model+" out of service for 2 days"+(r?" — route "+r.from+"–"+r.to+" paused":""));
  renderFleet(); save();
};
window.sellAc=function(id){
  const a=acById(id),spec=AC[a.model];
  const r=S.routes.find(r=>r.acId===id);
  const val=a.leased?0:spec.price*0.6*(a.condition/100);
  openModal(`<h2>${a.leased?"Return":"Sell"} ${esc(a.model)}?</h2>
    <p class="mb">${a.leased?"The lease will end immediately.":"You will receive "+fmtMoney(val)+" (60% of price, prorated by condition)."}${r?"<br><b class='neg'>Route "+r.from+"–"+r.to+" will be deleted.</b>":""}</p>
    <div class="row"><button class="btn danger" id="cSell">Confirm</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $("#cSell").onclick=()=>{
    if(r)deleteRoute(r.id,true);
    S.fleet=S.fleet.filter(x=>x.id!==id);
    if(val){S.cash+=val;flashCash(val);}
    toast(a.leased?"Aircraft returned":"Aircraft sold",a.model);
    closeModal(); renderFleet(); save();
  };
};
window.openReassign=function(id){
  const a=acById(id),spec=AC[a.model];
  openModal(`<h2>Reassign Hub — ${esc(a.model)}</h2>
    <div class="field"><label>New base hub (needs ${fmtNum(spec.minRunwayFt)} ft, adj. for altitude)</label>
    <select id="rhSel">${S.hubs.map(h=>{const ok=canOperate(spec,AP[h]);
      return `<option value="${h}" ${h===a.hub?"selected":""} ${ok?"":"disabled"}>${h}${ok?"":" — "+runwayReason(spec,AP[h])}</option>`;}).join("")}</select></div>
    <div class="row"><button class="btn primary" id="rhOk">Reassign</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $("#rhOk").onclick=()=>{a.hub=$("#rhSel").value;closeModal();renderFleet();save();};
};
window.openSeatConfig=function(id){
  const a=acById(id),spec=AC[a.model];
  openModal(`<h2>Seat Config — ${esc(a.model)}</h2>
    <p class="sub mb">Business = 3.0 units · Premium = 1.5 · Economy = 1.0 · Max ${spec.cap} units</p>
    <div class="field"><label>Business: <b id="scBv">${a.biz||0}</b></label><input type="range" id="scB" min="0" max="${Math.floor(spec.cap/3)}" value="${a.biz||0}"></div>
    <div class="field"><label>Premium: <b id="scPv">${a.prem||0}</b></label><input type="range" id="scP" min="0" max="${Math.floor(spec.cap/1.5)}" value="${a.prem||0}"></div>
    <div id="scTotals"></div><div class="seatbar" id="scBar"></div>
    <div class="row"><button class="btn primary" id="scOk">Apply</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  const upd=()=>{
    let b=+$("#scB").value,p=+$("#scP").value;
    while(3*b+1.5*p>spec.cap){if(p>0)p--;else b--;}
    $("#scB").value=b;$("#scP").value=p;
    const e=Math.max(0,Math.floor(spec.cap-3*b-1.5*p));
    $("#scBv").textContent=b;$("#scPv").textContent=p;
    $("#scTotals").innerHTML=`<b>${e}</b> Economy · <b>${p}</b> Premium · <b>${b}</b> Business — ${e+p+b} seats total`;
    const u=3*b+1.5*p+e;
    $("#scBar").innerHTML=`<i style="width:${3*b/u*100}%;background:var(--warn)"></i><i style="width:${1.5*p/u*100}%;background:var(--info)"></i><i style="width:${e/u*100}%;background:var(--ok)"></i>`;
  };
  $("#scB").oninput=upd;$("#scP").oninput=upd;upd();
  $("#scOk").onclick=()=>{a.biz=+$("#scB").value;a.prem=+$("#scP").value;closeModal();renderFleet();save();};
};

// ---------- Buy aircraft modal ----------
window.openBuyModal=function(tab){
  tab=tab||"new";
  const based=S.fleet.length;
  const cap=S.hubs.reduce((s,h)=>s+TIERS[AP[h].tier].maxBased,0);
  const rows=list=>list.map(a=>{
    const g=gate({ac:a.model});
    const cond=a.classic?(S.usedRolls[a.model]||Math.round(rand(65,85))):100;
    const capLabel=a.kind==="cargo"?a.cap+" t":a.cap+" seats";
    return `<tr>
      <td><b>${esc(a.model)}</b>${a.classic?' <span class="badge classic">CLASSIC</span>':""}<br><span class="sub">${a.cls} · ${capLabel} · ${fmtKm(a.range)} · ${a.speed} km/h</span></td>
      <td>${fmtMoney(a.price)}${a.classic?`<br><span class="sub">cond. ${cond}%</span>`:""}</td>
      <td>${a.lease?fmtMoney(a.lease)+"/mo":"—"}</td>
      <td>$${a.fuel}/km<br><span class="sub">$${a.maint}/hr</span></td>
      <td>${g?`<span class="badge">${g}</span>`:
        `<button class="btn sm primary" onclick="buyAc('${esc(a.model)}',false)" ${S.cash<a.price||based>=cap?"disabled":""}>Buy</button>
         ${a.lease?`<button class="btn sm" onclick="buyAc('${esc(a.model)}',true)" ${based>=cap?"disabled":""}>Lease</button>`:""}`}</td></tr>`;
  }).join("");
  const lists={new:AIRCRAFT.filter(a=>a.kind==="pax"&&!a.classic),used:AIRCRAFT.filter(a=>a.kind==="pax"&&a.classic),freight:AIRCRAFT.filter(a=>a.kind==="cargo")};
  openModal(`<h2>Buy Aircraft</h2>
    <p class="sub mb">Fleet ${based}/${cap} based-aircraft slots across your hubs. Cash ${fmtMoney(S.cash)}.</p>
    <div class="tabs">
      <button class="${tab==="new"?"active":""}" onclick="openBuyModal('new')">New</button>
      <button class="${tab==="used"?"active":""}" onclick="openBuyModal('used')">Used Market</button>
      <button class="${tab==="freight"?"active":""}" onclick="openBuyModal('freight')">Freighters</button>
    </div>
    ${tab==="used"?'<p class="sub mb">Listings refresh daily. Classics decay faster (0.25%/hr) and cannot be leased.</p>':""}
    <table><thead><tr><th>Aircraft</th><th>Price</th><th>Lease</th><th>Op. cost</th><th></th></tr></thead>
    <tbody>${rows(lists[tab])}</tbody></table>
    <div class="row" style="margin-top:16px"><button class="btn" onclick="closeModal()">Close</button></div>`,true);
};
window.buyAc=function(model,leased,force){
  const spec=AC[model];
  if(!leased&&S.cash<spec.price)return;
  if(gate({ac:model}))return;
  const okHubs=S.hubs.filter(h=>canOperate(spec,AP[h]));
  if(!okHubs.length&&!force){
    openModal(`<h2>⚠️ No suitable hub</h2>
      <p class="mb">None of your hubs can host the <b>${esc(model)}</b>: ${runwayReason(spec,AP[S.mainHub])}. It will sit idle until you open a hub with a long enough runway.</p>
      <div class="row"><button class="btn primary" onclick="buyAc('${esc(model)}',${!!leased},true)">${leased?"Lease":"Buy"} Anyway</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
    return;
  }
  const cond=spec.classic?(S.usedRolls[model]||Math.round(rand(65,85))):100;
  if(!leased)spend(spec.price,"other");
  else{spend(spec.lease/30,"lease");}
  S.fleet.push({id:S.nextAcId++,model,hub:okHubs[0]||S.mainHub,condition:cond,biz:0,prem:0,leased:!!leased,inFlight:false,status:"ok",statusUntil:0,hoursToday:0,profitToday:0});
  toast(leased?"Aircraft leased":"Aircraft purchased",model+(spec.classic?" — delivered at "+cond+"% condition":""),"ok");
  checkAchievements(); checkLevel(); save();
  closeModal(); if(currentScreen()==="fleet")renderFleet();
};

// ---------- Routes screen ----------
function renderRoutes(){
  const el=$("#screen-routes");
  const rows=S.routes.map(r=>{
    const ac=acById(r.acId);
    const d=ac?dailyEcon(r,ac):null;
    const avgLoad=r.loads&&r.loads.length?r.loads.reduce((a,b)=>a+b,0)/r.loads.length:(d?d.load:0);
    return `<tr>
      <td>${r.type==="pax"?"👤":"📦"}</td>
      <td><b>${r.from}–${r.to}</b><br><span class="sub">${fmtKm(distKm(r.from,r.to))}</span></td>
      <td>${ac?esc(ac.model):"—"}</td>
      <td>${r.freq}/day</td>
      <td>×${r.m.toFixed(2)}</td>
      <td><span style="color:${d&&d.rating>=65?"var(--ok)":d&&d.rating>=40?"var(--warn)":"var(--bad)"}">★ ${d?d.rating:"—"}</span>${r.type==="pax"?`<br><span class="sub">${SVC[effSvcTier(r,distKm(r.from,r.to))].name}</span>`:""}</td>
      <td>${Math.round(avgLoad*100)}%</td>
      <td class="${d&&d.profit>=0?"pos":"neg"}">${d?fmtMoney(d.profit):"—"}${d&&d.revBelly?`<br><span class="sub">incl. belly ${fmtMoney(d.revBelly)}</span>`:""}</td>
      <td>${r.marketing?'<span class="badge ok">MKT</span>':""}${S.events.viralRoute===r.id&&S.day<=S.events.viralUntil?'<span class="badge warn">🔥</span>':""}</td>
      <td><button class="btn sm" onclick="editRoute(${r.id})">Edit</button> <button class="btn sm danger" onclick="deleteRoute(${r.id})">✕</button></td></tr>`;
  }).join("");
  el.innerHTML=`<div class="inner">
    <div class="spread mb"><h1 style="margin:0">Routes</h1>
      <div class="row">
        <button class="btn ${S.globalMkt?"primary":""}" onclick="toggleGlobalMkt()">${S.globalMkt?"✓ ":""}Brand Campaign $150K/day</button>
        <button class="btn primary" onclick="openRouteWizard()">New Route</button>
      </div></div>
    ${S.routes.length?`<div class="card" style="padding:0 8px"><table><thead><tr><th></th><th>Route</th><th>Aircraft</th><th>Freq</th><th>Price</th><th>Rating</th><th>Load (7d)</th><th>Daily profit</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:
    `<div class="card">No routes yet. Open your first route to start earning.</div>`}</div>`;
}
window.toggleGlobalMkt=function(){S.globalMkt=!S.globalMkt;toast("Brand campaign",S.globalMkt?"Active: +5% demand on all routes":"Stopped");renderRoutes();save();};
window.deleteRoute=function(id,silent){
  const r=routeById(id); if(!r)return;
  const doIt=()=>{
    S.flights=S.flights.filter(f=>{if(f.routeId===id){const ac=acById(r.acId);if(ac)ac.inFlight=false;return false;}return true;});
    const ac=acById(r.acId); if(ac)ac.inFlight=false;
    S.routes=S.routes.filter(x=>x.id!==id);
    renderRouteLines(); if(currentScreen()==="routes")renderRoutes(); save();
  };
  if(silent)return doIt();
  openModal(`<h2>Delete route ${r.from}–${r.to}?</h2><div class="row"><button class="btn danger" id="cDel">Delete</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  $("#cDel").onclick=()=>{doIt();closeModal();};
};
window.editRoute=function(id){
  const r=routeById(id);
  const spec=AC[r.acModel];
  const dist=distKm(r.from,r.to);
  const cap=freqCap(flightHours(dist,spec.speed));
  openModal(`<h2>Edit ${r.from}–${r.to}</h2>
    <div class="field"><label>Frequency: <b id="erFv">${r.freq}</b>/day (max ${cap})</label><input type="range" id="erF" min="1" max="${cap}" value="${r.freq}"></div>
    <div class="field"><label>Price multiplier: ×<b id="erMv">${r.m.toFixed(2)}</b></label><input type="range" id="erM" min="0.5" max="2" step="0.05" value="${r.m}"></div>
    ${r.type==="pax"?`<div class="field"><label>On-board service</label><div class="row" id="erSvc">${svcButtonsHTML(r.svc||0,dist)}</div></div>`:""}
    <div class="field"><label><input type="checkbox" id="erMkt" ${r.marketing?"checked":""} style="width:auto"> Route marketing campaign ($25K/day, +12% demand)</label></div>
    <div class="preview" id="erPrev"></div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="erOk">Save</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  let svcSel=r.svc||0;
  const upd=()=>{
    const test={...r,freq:+$("#erF").value,m:+$("#erM").value,marketing:$("#erMkt").checked,svc:svcSel};
    $("#erFv").textContent=test.freq;$("#erMv").textContent=test.m.toFixed(2);
    $("#erPrev").innerHTML=previewHTML(test,acById(r.acId));
  };
  bindSvcButtons("#erSvc",v=>{svcSel=v;$$("#erSvc button").forEach(b=>b.classList.toggle("primary",+b.dataset.s===v));upd();});
  ["erF","erM","erMkt"].forEach(i=>$("#"+i)&&($("#"+i).oninput=upd));upd();
  $("#erOk").onclick=()=>{r.freq=+$("#erF").value;r.m=+$("#erM").value;r.marketing=$("#erMkt").checked;r.svc=svcSel;closeModal();renderRoutes();save();};
};
function svcButtonsHTML(sel,dist){
  return SVC.map((s,i)=>`<button class="btn sm ${sel===i?"primary":""}" data-s="${i}" ${dist<s.minKm?"disabled title='needs "+fmtKm(s.minKm)+"+'":""}>${s.name}${s.cost?" $"+s.cost+"/pax":""}</button>`).join("");
}
function bindSvcButtons(sel,cb){
  $$(sel+" button").forEach(b=>b.onclick=()=>cb(+b.dataset.s));
}
function previewHTML(r,acObj){
  const d=dailyEcon(r,acObj);
  const lines=[["Revenue ("+(r.type==="pax"?"pax":"cargo")+")",r.type==="pax"?d.revPax:d.revCargo,"pos"]];
  if(d.revBelly)lines.push(["Belly cargo revenue",d.revBelly,"pos"]);
  lines.push(["Fuel",-d.fuel],["Crew",-d.crew],["Landing fees",-d.fee],["Maintenance",-d.maint]);
  if(d.svc)lines.push(["On-board service",-d.svc]);
  if(r.marketing)lines.push(["Marketing",-25e3]);
  const profit=d.profit-(r.marketing?25e3:0);
  return `<div class="line"><span>Flight rating <b style="color:${d.rating>=65?"var(--ok)":d.rating>=40?"var(--warn)":"var(--bad)"}">★ ${d.rating}</b> · image ${Math.round(S.image||50)}</span></div>`+
    `<div class="line"><span>${d.legs} legs/day · ${r.type==="pax"?fmtNum(d.pax)+" pax":d.tonnes.toFixed(1)+"t"}/day · load ${Math.round(d.load*100)}%</span></div>`+
    lines.map(([l,v,c])=>`<div class="line"><span>${l}</span><span class="${c||(v<0?"neg":"")}">${fmtMoney(v)}</span></div>`).join("")+
    `<div class="line total"><span>Projected daily profit</span><span class="${profit>=0?"pos":"neg"}">${fmtMoney(profit)}</span></div>`;
}

// ---------- New Route wizard ----------
const RW={step:0,type:"pax",from:null,to:null,acId:null,freq:1,m:1,svc:1};
window.openRouteWizard=function(pre){
  Object.assign(RW,{step:0,type:"pax",from:S.mainHub,to:pre&&pre.to||null,acId:null,freq:1,m:1,svc:1});
  renderRW();
};
function freeAircraft(type){ return S.fleet.filter(a=>AC[a.model].kind===type&&!S.routes.some(r=>r.acId===a.id)); }
function renderRW(){
  const hasFreighter=S.fleet.some(a=>AC[a.model].kind==="cargo");
  let body="";
  if(RW.step===0){
    body=`<h2>New Route — Type</h2>
      <div class="grid2">
        <button class="btn ${RW.type==="pax"?"primary":""}" style="height:80px;font-size:16px" onclick="rwSet('type','pax')">👤 Passenger</button>
        <button class="btn ${RW.type==="cargo"?"primary":""}" style="height:80px;font-size:16px" onclick="rwSet('type','cargo')" ${hasFreighter?"":"disabled"}>📦 Cargo${hasFreighter?"":"<br><span class='sub'>needs a freighter</span>"}</button>
      </div>`;
  }else if(RW.step===1){
    body=`<h2>New Route — Origin hub</h2>
      <div class="hub-pick">${S.hubs.map(h=>`<button class="${RW.from===h?"sel":""}" onclick="rwSet('from','${h}')"><b>${h}</b><br>${esc(AP[h].city)}</button>`).join("")}</div>`;
  }else if(RW.step===2){
    const dests=AIRPORTS.filter(a=>a.iata!==RW.from&&!S.routes.some(r=>(r.from===RW.from&&r.to===a.iata)||(r.from===a.iata&&r.to===RW.from)))
      .map(a=>{const dist=distKm(RW.from,a.iata);
        const pool=RW.type==="pax"?Math.min(TIERS[AP[RW.from].tier].pool,TIERS[a.tier].pool)*falloff(dist)*famousMult(RW.from,a.iata):Math.min(CARGO_POOL[AP[RW.from].tier],CARGO_POOL[a.tier])*falloff(dist);
        return {a,dist,pool};}).sort((x,y)=>y.pool-x.pool);
    body=`<h2>New Route — Destination from ${RW.from}</h2>
      <input type="text" id="rwSearch" placeholder="Search ${fmtNum(dests.length)} airports by city or IATA…">
      <div class="dest-list" id="rwDests">${dests.slice(0,150).map(d=>`<div class="item ${RW.to===d.a.iata?"sel":""}" data-iata="${d.a.iata}"><span><b>${d.a.iata}</b> ${esc(d.a.city)} <span class="stars">${"★".repeat(d.a.tier)}</span> <span class="badge">${maxClassAt(d.a)}</span></span><span class="sub">${fmtKm(d.dist)} · rwy ${fmtNum(d.a.rw)} ft · demand ${fmtNum(d.pool)}${RW.type==="cargo"?"t":""}/day</span></div>`).join("")}</div>
      <p class="sub" id="rwDestNote">Top 150 by demand shown — type to search all ${fmtNum(dests.length)}.</p>`;
  }else if(RW.step===3){
    const dist=distKm(RW.from,RW.to);
    const avail=freeAircraft(RW.type);
    body=`<h2>New Route — Aircraft (${RW.from}–${RW.to}, ${fmtKm(dist)})</h2>
      ${rwMiniMap(dist)}
      ${avail.length?`<div class="ac-pick">${avail.map(a=>{const spec=AC[a.model];
        const rangeOk=spec.range>=dist, fromOk=canOperate(spec,AP[RW.from]), toOk=canOperate(spec,AP[RW.to]);
        const ok=rangeOk&&fromOk&&toOk;
        let why=rangeOk?"":"range too short";
        if(!fromOk)why=(why?why+"; ":"")+"runway at "+RW.from+" ("+runwayReason(spec,AP[RW.from]).split("— ")[1]+")";
        if(!toOk)why=(why?why+"; ":"")+"runway at "+RW.to+" ("+runwayReason(spec,AP[RW.to]).split("— ")[1]+")";
        return `<div class="item ${RW.acId===a.id?"sel":""} ${ok?"":"dim"}" onclick="rwSet('acId',${a.id})"><b>${esc(a.model)}</b> ${spec.classic?'<span class="badge classic">C</span>':""}<br><span class="sub">${spec.kind==="cargo"?spec.cap+"t":spec.cap+" seats"} · range ${fmtKm(spec.range)} · needs ${fmtNum(spec.minRunwayFt)} ft ${ok?"✓":"— "+why}</span></div>`;}).join("")}</div>`:
      `<p class="sub">No unassigned ${RW.type==="cargo"?"freighters":"passenger aircraft"}. Buy one first.</p>`}`;
  }else if(RW.step===4){
    const ac=acById(RW.acId),spec=AC[ac.model];
    const cap=freqCap(flightHours(distKm(RW.from,RW.to),spec.speed));
    RW.freq=Math.min(RW.freq,cap);
    body=`<h2>New Route — Schedule & price</h2>
      <div class="grid2"><div>
      <div class="field"><label>Round trips/day: <b id="rwFv">${RW.freq}</b> (max ${cap})</label><input type="range" id="rwF" min="1" max="${cap}" value="${RW.freq}"></div>
      <div class="field"><label>Price multiplier: ×<b id="rwMv">${RW.m.toFixed(2)}</b></label><input type="range" id="rwM" min="0.5" max="2" step="0.05" value="${RW.m}"></div>
      ${RW.type==="pax"?`<div class="field"><label>On-board service</label><div class="row" id="rwSvc">${svcButtonsHTML(RW.svc,distKm(RW.from,RW.to))}</div></div>`:""}
      <p class="sub">${esc(ac.model)} · ${RW.from}–${RW.to}</p></div>
      <div class="preview" id="rwPrev"></div></div>`;
  }else{
    const ac=acById(RW.acId);
    body=`<h2>Confirm route</h2>
      <div class="preview mb">${previewHTML({type:RW.type,from:RW.from,to:RW.to,acModel:ac.model,acId:ac.id,freq:RW.freq,m:RW.m,marketing:false,svc:RW.svc},ac)}</div>
      <p class="sub mb">${RW.type==="pax"?"👤 Passenger":"📦 Cargo"} · ${RW.from}–${RW.to} · ${esc(ac.model)} · ${RW.freq}×/day · ×${RW.m.toFixed(2)}${RW.type==="pax"?" · "+SVC[effSvcTier({svc:RW.svc},distKm(RW.from,RW.to))].name:""}</p>`;
  }
  const canNext=RW.step===0?true:RW.step===1?!!RW.from:RW.step===2?!!RW.to:
    RW.step===3?(()=>{if(!RW.acId)return false;const spec=AC[acById(RW.acId).model];
      return spec.range>=distKm(RW.from,RW.to)&&canOperate(spec,AP[RW.from])&&canOperate(spec,AP[RW.to]);})():true;
  openModal(body+`<div class="row" style="margin-top:16px;justify-content:space-between">
    <button class="btn" onclick="${RW.step===0?"closeModal()":"rwStep(-1)"}">${RW.step===0?"Cancel":"Back"}</button>
    <button class="btn primary" onclick="${RW.step===5?"rwConfirm()":"rwStep(1)"}" ${canNext?"":"disabled"}>${RW.step===5?"Open Route":"Next"}</button></div>`,true);
  if(RW.step===2){
    const bindDest=()=>$$("#rwDests .item").forEach(i=>i.onclick=()=>rwSet("to",i.dataset.iata));
    $("#rwSearch").oninput=e=>{
      const q=e.target.value.toLowerCase();
      const match=AIRPORTS.filter(a=>a.iata!==RW.from&&(a.iata.toLowerCase().includes(q)||a.city.toLowerCase().includes(q)))
        .map(a=>({a,dist:distKm(RW.from,a.iata)})).slice(0,150);
      $("#rwDests").innerHTML=match.map(d=>`<div class="item" data-iata="${d.a.iata}"><span><b>${d.a.iata}</b> ${esc(d.a.city)} <span class="stars">${"★".repeat(d.a.tier)}</span> <span class="badge">${maxClassAt(d.a)}</span></span><span class="sub">${fmtKm(d.dist)} · rwy ${fmtNum(d.a.rw)} ft</span></div>`).join("")||'<div class="item">No match</div>';
      bindDest();
    };
    bindDest();
  }
  if(RW.step===4){
    const upd=()=>{RW.freq=+$("#rwF").value;RW.m=+$("#rwM").value;
      $("#rwFv").textContent=RW.freq;$("#rwMv").textContent=RW.m.toFixed(2);
      const ac=acById(RW.acId);
      $("#rwPrev").innerHTML=previewHTML({type:RW.type,from:RW.from,to:RW.to,acModel:ac.model,acId:ac.id,freq:RW.freq,m:RW.m,marketing:false,svc:RW.svc},ac);};
    bindSvcButtons("#rwSvc",v=>{RW.svc=v;$$("#rwSvc button").forEach(b=>b.classList.toggle("primary",+b.dataset.s===v));upd();});
    $("#rwF").oninput=upd;$("#rwM").oninput=upd;upd();
  }
}
function rwMiniMap(dist){
  const o=AP[RW.from],d=AP[RW.to];
  const px=lng=>(lng+180)/360*400, py=lat=>(90-lat)/180*200;
  return `<svg viewBox="0 0 400 200" style="width:100%;height:140px;background:var(--raised);border-radius:8px;margin-bottom:8px">
    ${AIRPORTS.map(a=>`<circle cx="${px(a.lng)}" cy="${py(a.lat)}" r="1.5" fill="#5A6B8C"/>`).join("")}
    <circle cx="${px(o.lng)}" cy="${py(o.lat)}" r="4" fill="${S.livery.base}"/>
    <circle cx="${px(d.lng)}" cy="${py(d.lat)}" r="4" fill="var(--warn)"/>
    <line x1="${px(o.lng)}" y1="${py(o.lat)}" x2="${px(d.lng)}" y2="${py(d.lat)}" stroke="${S.livery.base}" stroke-width="1.5" opacity="0.7"/>
    <circle cx="${px(o.lng)}" cy="${py(o.lat)}" r="${dist/111/360*400}" fill="none" stroke="${S.livery.base}" stroke-dasharray="4 3" opacity="0.5"/>
    <text x="8" y="192" font-size="10" fill="#8DA0C0">Dashed ring ≈ route distance ${fmtKm(dist)}</text></svg>`;
}
window.rwSet=function(k,v){RW[k]=v;if(k==="type")RW.acId=null;renderRW();};
window.rwStep=function(d){RW.step+=d;renderRW();};
window.rwConfirm=function(){
  const ac=acById(RW.acId);
  const r={id:S.nextRouteId++,type:RW.type,from:RW.from,to:RW.to,acId:ac.id,acModel:ac.model,freq:RW.freq,m:RW.m,svc:RW.type==="pax"?RW.svc:0,marketing:false,loads:[],legsToday:0,dayRef:S.day,nextDep:Math.max(S.t,(S.day-1)*1440+360),bellyUsedToday:0,profitToday:0,paxToday:0,seatsToday:0};
  S.routes.push(r);
  closeModal();
  toast("Route opened",r.from+"–"+r.to+" · "+r.freq+"×/day","ok");
  renderRouteLines(); renderAirportMarkers();
  checkAchievements(); save();
  if(currentScreen()==="routes")renderRoutes();
  $("#spotlight").classList.add("hidden");
};

// ---------- Airports screen ----------
const APSORT={key:"tier",dir:-1};
function renderAirports(){
  const el=$("#screen-airports");
  const q=(el.dataset.q||"").toLowerCase();
  const hostModel=el.dataset.host||"";
  let rows=AIRPORTS.map(a=>({...a,dist:S.mainHub?distKm(S.mainHub,a.iata):0,mc:CLASS_ORDER.indexOf(maxClassAt(a)),
    status:S.hubs.includes(a.iata)?"Hub":S.routes.some(r=>r.from===a.iata||r.to===a.iata)?"Served":"—",
    canHost:!hostModel||canOperate(AC[hostModel],a)}));
  const total=rows.length;
  if(q)rows=rows.filter(a=>a.iata.toLowerCase().includes(q)||a.city.toLowerCase().includes(q));
  rows.sort((x,y)=>{const k=APSORT.key;return (x[k]>y[k]?1:x[k]<y[k]?-1:0)*APSORT.dir;});
  const shown=rows.slice(0,300);
  const myModels=[...new Set(S.fleet.map(a=>a.model))];
  const rivalRows=[{name:S.airline+" (you)",code:S.code,color:S.livery.base,fleet:S.fleet.length,routes:S.routes.length,base:S.mainHub}]
    .concat(RIVALS.map(rv=>{const extra=S.rivalExtra.filter(x=>x.airline===rv.name).length;
      return {name:rv.name,code:rv.code,color:rv.color,fleet:rv.routes.length+extra+4,routes:rv.routes.length+extra,base:rv.base};}));
  el.innerHTML=`<div class="inner"><h1>Airports <span class="sub">${fmtNum(total)} worldwide</span></h1>
    <div class="row mb"><input type="text" id="apSearch" placeholder="Search ${fmtNum(total)} airports…" value="${esc(el.dataset.q||"")}" style="max-width:320px">
    <span class="chip">Can host: <select id="apHost" style="width:auto;padding:2px 6px;font-size:12px">${['<option value="">any aircraft</option>'].concat(myModels.map(m=>`<option ${hostModel===m?"selected":""}>${m}</option>`)).join("")}</select></span></div>
    <div class="card mb" style="padding:0 8px"><table><thead><tr>
      ${[["iata","IATA"],["city","City"],["tier","Tier"],["rw","Longest runway"],["mc","Max class"],["dist","Distance from "+(S.mainHub||"—")],["status","Status"]].map(([k,l])=>`<th data-k="${k}">${l} ${APSORT.key===k?(APSORT.dir>0?"▲":"▼"):""}</th>`).join("")}</tr></thead>
      <tbody>${shown.map(a=>`<tr class="${a.canHost?"":"dim-row"}" ${a.canHost?"":`title="${runwayReason(AC[hostModel],a)}"`}><td><b>${a.iata}</b></td><td>${esc(a.city)}</td><td><span class="stars">${"★".repeat(a.tier)}</span></td><td>${fmtNum(a.rw)} ft${a.elev>2000?` <span class="sub">@${fmtNum(a.elev)} ft</span>`:""}</td><td><span class="badge">${a.mc>=0?CLASS_ORDER[a.mc]:"—"}</span></td><td>${a.iata===S.mainHub?"—":fmtKm(a.dist)}</td><td>${a.status==="Hub"?'<span class="badge brand">HUB</span>':a.status}</td></tr>`).join("")}</tbody></table>
      ${rows.length>300?`<p class="sub" style="padding:8px 10px">Showing 300 of ${fmtNum(rows.length)} — refine your search.</p>`:""}</div>
    <h3>Airlines</h3>
    <p class="sub mb">Interlining links your network with a partner's: +10% demand on your routes touching their airports. $250K to sign, $10K/day to maintain.</p>
    <div class="card" style="padding:0 8px"><table><thead><tr><th>Airline</th><th>Code</th><th>Base</th><th>Fleet</th><th>Routes</th><th>Interlining</th></tr></thead>
      <tbody>${rivalRows.map((r,i)=>`<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${r.color};margin-right:8px"></span><b>${esc(r.name)}</b></td><td>${r.code}</td><td>${r.base}</td><td>${r.fleet}</td><td>${r.routes}</td><td>${i===0?"—":
        S.interline[r.name]?`<span class="badge ok">ACTIVE</span> <button class="btn sm" onclick="toggleInterline('${esc(r.name)}')">Cancel</button>`:
        `<button class="btn sm primary" onclick="toggleInterline('${esc(r.name)}')" ${S.cash<250e3?"disabled":""}>Sign $250K</button>`}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#apSearch").oninput=e=>{el.dataset.q=e.target.value;renderAirports();$("#apSearch").focus();const v=$("#apSearch");v.setSelectionRange(v.value.length,v.value.length);};
  $("#apHost").onchange=e=>{el.dataset.host=e.target.value;renderAirports();};
  window.toggleInterline=function(name){
    if(S.interline[name]){S.interline[name]=false;toast("Interlining cancelled","Agreement with "+name+" ended");}
    else{if(S.cash<250e3)return;spend(250e3,"interline");S.interline[name]=true;toast("Interlining signed","+10% demand on routes touching "+name+"'s network","ok");}
    renderAirports();save();
  };
  $$("#screen-airports th[data-k]").forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(APSORT.key===k)APSORT.dir*=-1;else{APSORT.key=k;APSORT.dir=1;}renderAirports();});
}

// ---------- Finances ----------
function renderFinances(){
  const el=$("#screen-finances");
  const hist=S.pnl.slice(-30);
  const nw=netWorth();
  // chart
  const W=1180,H=220,pad=36;
  let chart="";
  if(hist.length>=2){
    const vals=hist.map(p=>p.net);
    const mn=Math.min(0,...vals),mx=Math.max(1,...vals);
    const x=i=>pad+i/(hist.length-1)*(W-pad*2), y=v=>H-24-((v-mn)/(mx-mn||1))*(H-48);
    const pts=vals.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
    const grid=[0.25,0.5,0.75].map(f=>{const v=mn+(mx-mn)*f;return `<line x1="${pad}" x2="${W-pad}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="4" y="${y(v)+4}" font-size="10" fill="#5A6B8C">${fmtMoney(v)}</text>`;}).join("");
    chart=`<svg viewBox="0 0 ${W} ${H}" style="width:100%" id="pnlChart">${grid}
      <line x1="${pad}" x2="${W-pad}" y1="${y(0)}" y2="${y(0)}" stroke="#5A6B8C"/>
      <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2"/>
      ${vals.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="7" fill="transparent" data-d="Day ${hist[i].day}: ${fmtMoney(v)}" class="pnlpt"/><circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${v>=0?"var(--ok)":"var(--bad)"}"/>`).join("")}</svg>`;
  }else chart=`<p class="sub">P&L chart appears after 2 full days.</p>`;
  // donut
  const sum=k=>hist.reduce((s,p)=>s+(p[k]||0),0);
  const segs=[["Fuel",sum("fuel"),"#FF5C6C"],["Crew",sum("crew"),"#FFB020"],["Fees",sum("fees"),"#4DA3FF"],["Maint",sum("maint"),"#2ECC8F"],["Lease",sum("lease"),"#B388FF"],["Overhead",sum("overhead"),"#8DA0C0"],["Marketing",sum("marketing"),"#F472B6"],["Service",sum("svc"),"#66D9E8"],["Interline",sum("interline"),"#9AA7FF"]];
  const tot=segs.reduce((s,x)=>s+x[1],0)||1;
  let acc=0;
  const donut=segs.map(([l,v,c])=>{const a0=acc/tot*2*Math.PI-Math.PI/2;acc+=v;const a1=acc/tot*2*Math.PI-Math.PI/2;
    if(v<=0)return"";
    const large=(a1-a0)>Math.PI?1:0;
    return `<path d="M ${60+45*Math.cos(a0)} ${60+45*Math.sin(a0)} A 45 45 0 ${large} 1 ${60+45*Math.cos(a1)} ${60+45*Math.sin(a1)}" fill="none" stroke="${c}" stroke-width="16"/>`;}).join("");
  // fuel sparkline
  const fh=S.fuelHist;
  const fpts=fh.map((v,i)=>`${i/(Math.max(1,fh.length-1))*180},${34-(v-0.7)/0.9*30}`).join(" ");
  const loansHTML=S.loans.map((l,i)=>`<div class="line spread" style="padding:6px 0"><span>Loan ${fmtMoney(l.amount)} · ${fmtMoney(l.amount*0.0003)}/day interest</span><button class="btn sm" onclick="repayLoan(${i})" ${S.cash<l.amount?"disabled":""}>Repay</button></div>`).join("")||'<p class="sub">No active loans.</p>';
  el.innerHTML=`<div class="inner"><h1>Finances</h1>
    <div class="fin-cards">
      <div class="card"><div class="lbl">Cash</div><div class="val ${S.cash>=0?"":"neg"}">${fmtMoney(S.cash)}</div></div>
      <div class="card"><div class="lbl">Net worth · Level ${S.level}</div><div class="val">${fmtMoney(nw)}</div><div class="sub">${S.level<10?"Next level at "+fmtMoney(LEVELS[S.level]):"Max level"}</div></div>
      <div class="card"><div class="lbl">Yesterday's P&L</div><div class="val ${hist.length&&hist[hist.length-1].net>=0?"pos":"neg"}">${hist.length?fmtMoney(hist[hist.length-1].net):"—"}</div></div>
      <div class="card"><div class="lbl">Fuel index</div><div class="val">${effFuelIdx().toFixed(2)}</div><svg viewBox="0 0 180 36" style="width:100%;height:24px"><polyline points="${fpts}" fill="none" stroke="var(--warn)" stroke-width="1.5"/></svg></div>
    </div>
    <div class="card mb" style="position:relative"><h3>30-day P&L</h3>${chart}</div>
    <div class="grid2">
      <div class="card"><h3>Cost breakdown (30d)</h3>
        <div class="row"><svg viewBox="0 0 120 120" style="width:140px">${donut}</svg>
        <div>${segs.map(([l,v,c])=>`<div class="line"><span><i style="display:inline-block;width:9px;height:9px;background:${c};border-radius:2px;margin-right:6px"></i>${l}</span> <span style="margin-left:12px">${fmtMoney(v)}</span></div>`).join("")}</div></div></div>
      <div class="card"><h3>Loans (${S.loans.length}/2)</h3>${loansHTML}
        ${S.loans.length<2?`<div class="field" style="margin-top:12px"><label>Amount: $<span id="loanV">50</span>M</label><input type="range" id="loanAmt" min="10" max="150" value="50"></div>
        <button class="btn primary" onclick="takeLoan()">Take Loan (0.03%/day)</button>`:""}</div>
    </div></div>`;
  $$("#pnlChart .pnlpt").forEach(c=>{
    c.onmousemove=e=>{let tip=RT.chartTip;if(!tip){tip=document.createElement("div");tip.className="chart-tip";document.body.appendChild(tip);RT.chartTip=tip;}
      tip.textContent=c.dataset.d;tip.style.left=e.pageX+10+"px";tip.style.top=e.pageY-24+"px";tip.style.display="block";};
    c.onmouseleave=()=>{if(RT.chartTip)RT.chartTip.style.display="none";};
  });
  const la=$("#loanAmt"); if(la)la.oninput=()=>$("#loanV").textContent=la.value;
}
window.takeLoan=function(){
  const amt=+$("#loanAmt").value*1e6;
  S.loans.push({amount:amt});
  S.cash+=amt; flashCash(amt);
  toast("Loan received",fmtMoney(amt)+" at 0.03%/day","ok");
  renderFinances(); save();
};
window.repayLoan=function(i){
  const l=S.loans[i]; if(S.cash<l.amount)return;
  S.cash-=l.amount; flashCash(-l.amount);
  S.loans.splice(i,1);
  toast("Loan repaid",fmtMoney(l.amount));
  renderFinances(); save();
};

// ---------- Livery Studio ----------
let LDRAFT=null;
function renderLivery(){
  const el=$("#screen-livery");
  LDRAFT=LDRAFT||{...S.livery,name:S.airline,code:S.code};
  el.innerHTML=`<div class="inner"><h1>Livery Studio</h1>
    <div class="livery-wrap">
      <div class="livery-left" id="lvPreview">${fuselageSVG(LDRAFT,{name:LDRAFT.code,uid:"lv"})}</div>
      <div class="livery-right">
        <div class="row mb">
          <div><label>Base</label><input type="color" id="lvBase" value="${LDRAFT.base}"></div>
          <div><label>Accent</label><input type="color" id="lvAccent" value="${LDRAFT.accent}"></div>
          <div><label>Tail</label><input type="color" id="lvTail" value="${LDRAFT.tail}"></div>
        </div>
        <label>Pattern</label>
        <div class="swatches">${PATTERNS.map(p=>`<button class="${LDRAFT.pattern===p?"sel":""}" data-p="${p}">${p}</button>`).join("")}</div>
        <label>Tail logo</label>
        <div class="logo-grid">${LOGOS.map(l=>`<button class="${LDRAFT.logo===l?"sel":""}" data-l="${l}"><svg viewBox="0 0 14 14">${(LOGO_PATHS[l]||"").replace(/FILLC/g,"#E8EEF9")}</svg></button>`).join("")}</div>
        <div class="field"><label>Airline name</label><input type="text" id="lvName" value="${esc(LDRAFT.name)}" maxlength="24"></div>
        <div class="field"><label>2-letter code</label><input type="text" id="lvCode" value="${esc(LDRAFT.code)}" maxlength="2" style="width:80px;text-transform:uppercase"></div>
        <button class="btn primary" id="lvApply">Apply</button>
      </div></div></div>`;
  const upd=()=>{
    LDRAFT.base=$("#lvBase").value;LDRAFT.accent=$("#lvAccent").value;LDRAFT.tail=$("#lvTail").value;
    LDRAFT.name=$("#lvName").value;LDRAFT.code=($("#lvCode").value||"XX").toUpperCase();
    $("#lvPreview").innerHTML=fuselageSVG(LDRAFT,{name:LDRAFT.code,uid:"lv"});
  };
  ["lvBase","lvAccent","lvTail","lvName","lvCode"].forEach(i=>$("#"+i).oninput=upd);
  $$(".swatches button").forEach(b=>b.onclick=()=>{LDRAFT.pattern=b.dataset.p;renderLivery();});
  $$(".logo-grid button").forEach(b=>b.onclick=()=>{LDRAFT.logo=b.dataset.l;renderLivery();});
  $("#lvApply").onclick=()=>{
    S.livery={base:LDRAFT.base,accent:LDRAFT.accent,tail:LDRAFT.tail,pattern:LDRAFT.pattern,logo:LDRAFT.logo};
    S.airline=LDRAFT.name||S.airline; S.code=LDRAFT.code||S.code;
    applyBrand();
    if(RT.map){renderAirportMarkers();renderRouteLines();
      for(const k in RT.planeMarkers){RT.map.removeLayer(RT.planeMarkers[k]);delete RT.planeMarkers[k];}}
    toast("Livery applied","Your new look is live across the fleet","ok"); save();
  };
}
function applyBrand(){
  document.documentElement.style.setProperty("--brand",S.livery.base);
  $("#tbAirline").textContent=S.airline;
  $("#sideName").textContent=S.airline;
  $("#tbLogo").textContent=S.code; $("#sideLogo").textContent=S.code;
  $("#tbLogo").style.background=S.livery.base; $("#sideLogo").style.background=S.livery.base;
}

// ---------- Achievements ----------
function renderAch(){
  $("#screen-achievements").innerHTML=`<div class="inner"><h1>Achievements <span class="sub">${Object.keys(S.ach).length}/${ACHIEVEMENTS.length}</span></h1>
    <div class="ach-grid">${ACHIEVEMENTS.map(a=>{const got=S.ach[a.id];
      return `<div class="ach ${got?"":"locked"}"><span class="ico">${a.icon}</span><div><b>${a.name}</b><small>${a.desc}${got?" · Day "+got.day:""}</small></div></div>`;}).join("")}</div></div>`;
}

// ---------- Save modal ----------
function openSaveModal(){
  openModal(`<h2>Save / Data</h2>
    <div class="row mb"><button class="btn primary" id="svNow">Save Now</button><button class="btn" id="svExport">Export</button><button class="btn" id="svImport">Import</button><button class="btn danger" id="svReset">Reset Game</button></div>
    <textarea id="svText" rows="8" placeholder="Export puts save JSON here; paste JSON and press Import."></textarea>
    <div class="row" style="margin-top:12px"><button class="btn" onclick="closeModal()">Close</button></div>`);
  $("#svNow").onclick=()=>{save();toast("Saved","Game saved","ok");};
  $("#svExport").onclick=()=>{$("#svText").value=JSON.stringify(S);toast("Exported","Copy the JSON below");};
  $("#svImport").onclick=()=>{
    try{const s=JSON.parse($("#svText").value);
      if(!s.airline||!s.fleet)throw 0;
      localStorage.setItem(SAVE_KEY,JSON.stringify(s));location.reload();
    }catch(e){toast("Import failed","Invalid save JSON","bad");}
  };
  $("#svReset").onclick=()=>{
    openModal(`<h2>Reset game?</h2><p class="mb">This permanently deletes your airline.</p>
      <div class="row"><button class="btn danger" onclick="hardReset()">Delete & Restart</button><button class="btn" onclick="closeModal()">Cancel</button></div>`);
  };
}

// ---------- First-run wizard ----------
const WZ={step:0,name:"",code:"",diff:"Normal",hub:null,hubQ:"",ac:"A220-300",lease:false,base:"#4DA3FF",accent:"#E8EEF9",pattern:"cheatline"};
function renderWizard(){
  const w=$("#wizard");
  w.classList.remove("hidden");
  let body="";
  if(WZ.step===0){
    body=`<h1>Welcome to SkyEmpire ✈️</h1><p class="sub mb">Build your airline from a single plane to a global empire.</p>
      <div class="field"><label>Airline name</label><input type="text" id="wzName" value="${esc(WZ.name)}" maxlength="24" placeholder="e.g. Meridian Air"></div>
      <div class="field"><label>2-letter code</label><input type="text" id="wzCode" value="${esc(WZ.code)}" maxlength="2" style="width:80px;text-transform:uppercase" placeholder="MA"></div>
      <label>Difficulty</label>
      <div class="row mb">${["Easy","Normal","Hard"].map(d=>`<button class="btn ${WZ.diff===d?"primary":""}" data-d="${d}">${d}<br><span class="sub">${d==="Easy"?"$100M":d==="Normal"?"$50M":"$25M"}</span></button>`).join("")}</div>`;
  }else if(WZ.step===1){
    const recs=["SEA","MUC","BKK"];
    const eligible=AIRPORTS.filter(a=>a.tier<=3&&a.rw>=6200);
    const shown=(WZ.hubQ?eligible.filter(a=>a.iata.toLowerCase().includes(WZ.hubQ)||a.city.toLowerCase().includes(WZ.hubQ)):eligible.filter(a=>recs.includes(a.iata)).concat(eligible.filter(a=>!recs.includes(a.iata)&&a.tier===3).sort((x,y)=>y.rw-x.rw))).slice(0,48);
    body=`<h1>Choose your starting hub</h1><p class="sub">Tier 1–3 airports with a runway ≥ 6,200 ft (your starter jet must fit). ★ = recommended. ${fmtNum(eligible.length)} eligible — search for more.</p>
      <input type="text" id="wzHubQ" placeholder="Search city or IATA…" value="${esc(WZ.hubQ||"")}" style="margin:8px 0">
      <div class="hub-pick">${shown.map(a=>`<button class="${WZ.hub===a.iata?"sel":""}" data-h="${a.iata}"><b>${a.iata}</b> ${recs.includes(a.iata)?"⭐":""}<br>${esc(a.city)} <span class="stars">${"★".repeat(a.tier)}</span></button>`).join("")}</div>`;
  }else if(WZ.step===2){
    const opts=["A220-300","E195-E2","ATR 72-600","737 MAX 8"];
    const startCash=(WZ.diff==="Easy"?100e6:WZ.diff==="Hard"?25e6:50e6)-TIERS[AP[WZ.hub].tier].hubCost;
    const canBuy=AC[WZ.ac].price<=startCash;
    if(!canBuy)WZ.lease=true;
    body=`<h1>Your first aircraft</h1>
      <p class="sub mb">💡 We recommend the <b>A220-300</b>: 145 seats, 6,200 km range and low operating costs — it can profitably fly almost any starter route.</p>
      <div class="hub-pick" style="grid-template-columns:repeat(2,1fr)">${opts.map(m=>{const a=AC[m];
        return `<button class="${WZ.ac===m?"sel":""}" data-a="${m}"><b>${m}</b> ${m==="A220-300"?"⭐":""}<br><span class="sub">${a.cap} seats · ${fmtKm(a.range)} · ${fmtMoney(a.price)} / ${fmtMoney(a.lease)}/mo lease</span></button>`;}).join("")}</div>
      <div class="row"><button class="btn ${!WZ.lease?"primary":""}" data-l="0" ${canBuy?"":"disabled"}>Buy${canBuy?"":" (not enough cash after hub)"}</button><button class="btn ${WZ.lease?"primary":""}" data-l="1">Lease</button></div>
      <p class="sub" style="margin-top:8px">Cash after hub: ${fmtMoney(startCash)}</p>`;
  }else{
    body=`<h1>Quick livery</h1>
      <div class="row mb"><div><label>Base color</label><input type="color" id="wzBase" value="${WZ.base}"></div>
      <div><label>Accent</label><input type="color" id="wzAccent" value="${WZ.accent}"></div></div>
      <label>Pattern</label>
      <div class="swatches">${PATTERNS.slice(0,4).map(p=>`<button class="${WZ.pattern===p?"sel":""}" data-p="${p}">${p}</button>`).join("")}</div>
      <div id="wzPrev">${fuselageSVG({base:WZ.base,accent:WZ.accent,tail:WZ.base,pattern:WZ.pattern,logo:"bird"},{name:WZ.code||"??",uid:"wz"})}</div>
      <p class="sub">You can fine-tune everything later in the Livery Studio.</p>`;
  }
  const canNext=WZ.step===0?true:WZ.step===1?!!WZ.hub:true;
  w.innerHTML=`<div class="wiz-card">
    <div class="wiz-steps">${[0,1,2,3].map(i=>`<span class="${i<=WZ.step?"done":""}"></span>`).join("")}</div>
    ${body}
    <div class="row" style="margin-top:20px;justify-content:space-between">
      <button class="btn" id="wzBack" ${WZ.step===0?"disabled":""}>Back</button>
      <button class="btn primary" id="wzNext" ${canNext?"":"disabled"}>${WZ.step===3?"Take Off ✈️":"Next"}</button></div></div>`;
  if(WZ.step===0){
    $("#wzName").oninput=e=>WZ.name=e.target.value;
    $("#wzCode").oninput=e=>WZ.code=e.target.value.toUpperCase();
    $$("[data-d]").forEach(b=>b.onclick=()=>{WZ.diff=b.dataset.d;renderWizard();});
  }
  if(WZ.step===1){
    $$("[data-h]").forEach(b=>b.onclick=()=>{WZ.hub=b.dataset.h;renderWizard();});
    $("#wzHubQ").oninput=e=>{WZ.hubQ=e.target.value.toLowerCase();renderWizard();const v=$("#wzHubQ");v.focus();v.setSelectionRange(v.value.length,v.value.length);};
  }
  if(WZ.step===2){$$("[data-a]").forEach(b=>b.onclick=()=>{WZ.ac=b.dataset.a;renderWizard();});
    $$("[data-l]").forEach(b=>b.onclick=()=>{WZ.lease=b.dataset.l==="1";renderWizard();});}
  if(WZ.step===3){
    const upd=()=>{WZ.base=$("#wzBase").value;WZ.accent=$("#wzAccent").value;
      $("#wzPrev").innerHTML=fuselageSVG({base:WZ.base,accent:WZ.accent,tail:WZ.base,pattern:WZ.pattern,logo:"bird"},{name:WZ.code||"??",uid:"wz"});};
    $("#wzBase").oninput=upd;$("#wzAccent").oninput=upd;
    $$(".swatches button").forEach(b=>b.onclick=()=>{WZ.pattern=b.dataset.p;renderWizard();});
  }
  $("#wzBack").onclick=()=>{WZ.step--;renderWizard();};
  $("#wzNext").onclick=()=>{
    if(WZ.step===0&&!WZ.name){WZ.name="Sky Airways";}
    if(WZ.step===0&&!WZ.code)WZ.code=WZ.name.slice(0,2).toUpperCase();
    if(WZ.step<3){WZ.step++;renderWizard();return;}
    startGame();
  };
}
function startGame(){
  S=defaultState();
  S.started=true;
  S.airline=WZ.name||"Sky Airways"; S.code=WZ.code||"SA";
  S.difficulty=WZ.diff;
  S.cash=WZ.diff==="Easy"?100e6:WZ.diff==="Hard"?25e6:50e6;
  S.livery={base:WZ.base,accent:WZ.accent,tail:WZ.base,pattern:WZ.pattern,logo:"bird"};
  S.hubs=[WZ.hub]; S.mainHub=WZ.hub;
  S.cash-=TIERS[AP[WZ.hub].tier].hubCost;
  const spec=AC[WZ.ac];
  if(!WZ.lease&&S.cash<spec.price)WZ.lease=true;
  if(WZ.lease)S.cash-=spec.lease/30; else S.cash-=spec.price;
  S.fleet.push({id:S.nextAcId++,model:WZ.ac,hub:WZ.hub,condition:100,biz:0,prem:0,leased:WZ.lease,inFlight:false,status:"ok",statusUntil:0,hoursToday:0,profitToday:0});
  AIRCRAFT.filter(a=>a.classic).forEach(a=>S.usedRolls[a.model]=Math.round(rand(65,85)));
  $("#wizard").classList.add("hidden");
  bootUI();
  // suggested first route
  const best=AIRPORTS.filter(a=>a.iata!==WZ.hub&&distKm(WZ.hub,a.iata)<=spec.range&&canOperate(spec,a)&&canOperate(spec,AP[WZ.hub]))
    .map(a=>({a,pool:Math.min(TIERS[AP[WZ.hub].tier].pool,TIERS[a.tier].pool)*falloff(distKm(WZ.hub,a.iata))*famousMult(WZ.hub,a.iata)}))
    .sort((x,y)=>y.pool-x.pool)[0];
  const sp=$("#spotlight");
  sp.innerHTML=`💡 Open your first route${best?" — we suggest <b>"+WZ.hub+"–"+best.a.iata+"</b> ("+esc(best.a.city)+")":""} <button id="spGo">New Route</button><button id="spX">✕</button>`;
  sp.classList.remove("hidden");
  $("#spGo").onclick=()=>{openRouteWizard(best?{to:best.a.iata}:null);if(best){RW.step=2;RW.to=best.a.iata;renderRW();}};
  $("#spX").onclick=()=>sp.classList.add("hidden");
  save();
}

// ---------- Boot ----------
function bootUI(){
  $("#app").classList.remove("hidden");
  applyBrand();
  renderNav();
  renderTopbar();
  updateBanner();
  initMap();
  if(S.sideCollapsed)$("#sidebar").classList.add("collapsed");
  showScreen("map");
  RT.lastMin=Math.floor(S.t);
}
function init(){
  const saved=load();
  if(saved&&saved.started&&!saved.gameOver){
    S=saved;
    // migrate pre-FRS saves
    if(S.image===undefined)S.image=50;
    if(!S.interline)S.interline={};
    if(S.today.svc===undefined){S.today.svc=0;S.today.interline=0;}
    S.routes.forEach(r=>{if(r.svc===undefined)r.svc=r.type==="pax"?1:0;});
    S.fleet.forEach(a=>{if(a.inFlight&&!S.flights.some(f=>routeById(f.routeId)&&routeById(f.routeId).acId===a.id))a.inFlight=false;});
    bootUI();
  }else{
    renderWizard();
  }
  // global controls
  $$("#speedCtl button").forEach(b=>b.onclick=()=>{
    RT.speed=+b.dataset.speed;
    $$("#speedCtl button").forEach(x=>x.classList.toggle("active",x===b));
  });
  document.addEventListener("keydown",e=>{
    if(e.code==="Space"&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)){
      e.preventDefault();
      let target;
      if(RT.speed===0){target=RT.prevSpeed||1;}
      else{RT.prevSpeed=RT.speed;target=0;}
      $$("#speedCtl button").forEach(x=>x.classList.toggle("active",+x.dataset.speed===target));
      RT.speed=target;
    }
  });
  $("#collapseBtn").onclick=()=>{
    $("#sidebar").classList.toggle("collapsed");
    if(S){S.sideCollapsed=$("#sidebar").classList.contains("collapsed");save();}
    setTimeout(()=>RT.map&&RT.map.invalidateSize(),220);
  };
  $("#saveBtn").onclick=openSaveModal;
  $("#modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal();});
  window.closeModal=closeModal;
  requestAnimationFrame(t=>{RT.lastReal=t;requestAnimationFrame(loop);});
}
init();

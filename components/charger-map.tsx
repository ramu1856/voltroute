"use client";
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { Point, Station, Amenity, RoadRoute } from '@/lib/ev';
import type { AvailabilityInfo } from '@/lib/station-evidence';
import { riskStyles, type RiskSection } from '@/lib/trip-assessment';
import 'leaflet/dist/leaflet.css';
export default function ChargerMap({center,stations,selected,amenities,route,backupRoute,mainId,backupId,riskSections,focusedRiskId,onRiskFocus,availability,onSelect,onSearch}:{center:Point;stations:Station[];selected:Station|null;amenities:Amenity[];route:RoadRoute|null;backupRoute:RoadRoute|null;mainId?:string;backupId?:string;riskSections:RiskSection[];focusedRiskId:string|null;onRiskFocus:(id:string)=>void;availability:Map<string,AvailabilityInfo>;onSelect:(s:Station)=>void;onSearch:(p:Point)=>void}) {
 const container=useRef<HTMLDivElement>(null), map=useRef<Leaflet.Map|null>(null), L=useRef<typeof Leaflet|null>(null), layer=useRef<Leaflet.LayerGroup|null>(null),initialCenter=useRef(center);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[viewRevision,setViewRevision]=useState(0);
 const choose=useRef(onSelect),focusRisk=useRef(onRiskFocus);
 useEffect(()=>{choose.current=onSelect;focusRisk.current=onRiskFocus;},[onSelect,onRiskFocus]);
 useEffect(()=>{let disposed=false;let resize:ResizeObserver|undefined;
  import('leaflet').then(lib=>{if(disposed||!container.current)return;L.current=lib;const first=initialCenter.current;const m=lib.map(container.current,{scrollWheelZoom:false}).setView([first.lat,first.lon],12);map.current=m;
   lib.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>setError('Some map tiles could not load. The station list still works.')).addTo(m);
   m.on('zoomend moveend',()=>setViewRevision(v=>v+1));layer.current=lib.layerGroup().addTo(m);resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(container.current);setReady(true);
  }).catch(()=>setError('Map could not load. Use the station list below.'));
  return()=>{disposed=true;resize?.disconnect();map.current?.remove();map.current=null;};
 },[]);
 useEffect(()=>{if(ready)map.current?.setView([center.lat,center.lon],12);},[ready,center.lat,center.lon]);
 useEffect(()=>{
  if(!ready||!L.current||!layer.current)return;const lib=L.current;layer.current.clearLayers();
  const hasRisks=riskSections.length>0;
  if(route)lib.polyline(route.coordinates.map(([lon,lat])=>[lat,lon]),{color:hasRisks?'#9ca9b1':'#428cff',weight:4}).addTo(layer.current);
  if(backupRoute)lib.polyline(backupRoute.coordinates.map(([lon,lat])=>[lat,lon]),{color:hasRisks?'#9ca9b1':'#f5a65b',weight:5,dashArray:'8 7'}).addTo(layer.current);
  for(const section of riskSections){
   const points=section.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
   if(section.id===focusedRiskId)lib.polyline(points,{color:'#fff',weight:10,opacity:.9,interactive:false}).addTo(layer.current);
   const label=document.createElement('span');label.textContent=`${section.path==='backup'?'Backup from main':'Main route'} · ${section.fromMile.toFixed(1)}–${section.toMile.toFixed(1)} mi · ${riskStyles[section.level].label}. ${section.reason} ${section.assumption||''}`;
   lib.polyline(points,{color:riskStyles[section.level].color,weight:section.id===focusedRiskId?7:6,dashArray:section.path==='backup'?'8 7':undefined}).bindTooltip(label,{sticky:true}).on('click',()=>focusRisk.current(section.id)).addTo(layer.current);
  }
  const add=(lat:number,lon:number,text:string,color:string,radius:number,click?:()=>void)=>{const el=document.createElement('span');el.textContent=text;const marker=lib.circleMarker([lat,lon],{radius,fillColor:color,color:'#10241a',weight:2,fillOpacity:1}).bindTooltip(el).addTo(layer.current!);if(click)marker.on('click',click);};
  add(center.lat,center.lon,center.label,'#5b8def',8);
  const m=map.current!;
  const drawStation=(s:Station)=>{const info=availability.get(s.id);const role=s.id===mainId?'Main stop: ':s.id===backupId?'Backup stop: ':'';add(s.lat,s.lon,`${role}${s.name} · ${info?.label||'Status unknown'}`,info?.freshness==='live'?'#74db93':info?.freshness==='recent'?'#ffce70':'#a3adb0',selected?.id===s.id?12:8,()=>choose.current(s));};
  const groups=new Map<string,Station[]>();
  const pinned:Station[]=[];
  for(const s of stations){
   if(s.id===selected?.id||s.id===mainId||s.id===backupId){pinned.push(s);continue;}
   const point=m.project([s.lat,s.lon],m.getZoom());
   const key=`${Math.floor(point.x/56)}:${Math.floor(point.y/56)}`;
   const group=groups.get(key)||[];group.push(s);groups.set(key,group);
  }
  for(const group of groups.values()){
   if(group.length===1){drawStation(group[0]);continue;}
   const lat=group.reduce((sum,s)=>sum+s.lat,0)/group.length,lon=group.reduce((sum,s)=>sum+s.lon,0)/group.length;
   const label=`${group.length} mapped stations. Zoom in or choose a station.`;
   const icon=lib.divIcon({className:'station-cluster',html:`<span>${group.length}</span>`,iconSize:[44,44],iconAnchor:[22,22]});
   const marker=lib.marker([lat,lon],{icon,title:label,alt:label,keyboard:true}).addTo(layer.current);
   const list=document.createElement('div');list.className='cluster-stations';
   const heading=document.createElement('strong');heading.textContent=`${group.length} mapped stations`;list.appendChild(heading);
   for(const s of group){const button=document.createElement('button');button.type='button';button.textContent=`${s.name} · ${s.connectors.join(', ')||'Connector unknown'}`;button.onclick=()=>{choose.current(s);m.closePopup();};list.appendChild(button);}
   marker.bindPopup(list,{maxHeight:240,maxWidth:280});
   marker.on('click',()=>{if(m.getZoom()<19){marker.closePopup();m.fitBounds(group.map(s=>[s.lat,s.lon] as [number,number]),{padding:[45,45],maxZoom:Math.min(19,m.getZoom()+2)});}});
  }
  for(const s of pinned)drawStation(s);
  for(const p of amenities)add(p.lat,p.lon,`${p.kind==='food'?'Food':p.kind==='shopping'?'Shopping':'Restroom'}: ${p.name}`,p.kind==='food'?'#f5a65b':p.kind==='shopping'?'#f6d66d':'#9288ff',6);
 },[ready,viewRevision,center,stations,selected,amenities,route,backupRoute,mainId,backupId,availability,riskSections,focusedRiskId]);
 useEffect(()=>{const focused=riskSections.find(section=>section.id===focusedRiskId);const coordinates=focused?.coordinates||[...(route?.coordinates||[]),...(backupRoute?.coordinates||[])];if(ready&&coordinates.length)map.current?.fitBounds(coordinates.map(([lon,lat])=>[lat,lon] as [number,number]),{padding:[35,35],maxZoom:14});},[ready,route,backupRoute,focusedRiskId,riskSections]);
 return <div className="real-map"><div ref={container} className="leaflet-host" aria-label="Interactive charging-station map" />
  <button className="search-area" disabled={!ready} onClick={()=>{const c=map.current!.getCenter();onSearch({lat:c.lat,lon:c.lng,label:'Selected map area'});}}>Search this map area</button>
  {error&&<p className="map-error" role="status">{error}</p>}
 </div>;
}

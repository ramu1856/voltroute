"use client";
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { Point, Station, Amenity, RoadRoute } from '@/lib/ev';
import { evidenceTime, type AvailabilityInfo } from '@/lib/station-evidence';
import { riskStyles, type RiskSection } from '@/lib/trip-assessment';
import 'leaflet/dist/leaflet.css';
type MapStyle='road'|'satellite';
export default function ChargerMap({center,stations,selected,amenities,route,routeFocusToken,navigationRecenterToken,navigationMode,navigationLocation,backupRoute,mainId,backupId,riskSections,focusedRiskId,onRiskFocus,availability,onSelect,onSearch,fetchedAt}:{center:Point;stations:Station[];selected:Station|null;amenities:Amenity[];route:RoadRoute|null;routeFocusToken:number;navigationRecenterToken:number;navigationMode:boolean;navigationLocation:{lat:number;lon:number;accuracyMeters:number|null;heading:number|null}|null;backupRoute:RoadRoute|null;mainId?:string;backupId?:string;riskSections:RiskSection[];focusedRiskId:string|null;onRiskFocus:(id:string)=>void;availability:Map<string,AvailabilityInfo>;onSelect:(s:Station)=>void;onSearch:(p:Point)=>void;fetchedAt:string}) {
 const container=useRef<HTMLDivElement>(null), map=useRef<Leaflet.Map|null>(null), L=useRef<typeof Leaflet|null>(null), layer=useRef<Leaflet.LayerGroup|null>(null),routeLayer=useRef<Leaflet.LayerGroup|null>(null),navigationLayer=useRef<Leaflet.LayerGroup|null>(null),initialCenter=useRef(center);
 const baseLayers=useRef<{road:Leaflet.TileLayer|null;roadFallback:Leaflet.TileLayer|null;satellite:Leaflet.TileLayer|null;labels:Leaflet.TileLayer|null}>({road:null,roadFallback:null,satellite:null,labels:null});
 const roadFallbackActive=useRef(false),mapStyleRef=useRef<MapStyle>('road');
 const lastNavigationRouteRef=useRef<RoadRoute|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[viewRevision,setViewRevision]=useState(0),[mapStyle,setMapStyle]=useState<MapStyle>('road');
 const visibleBounds=useRef<[number,number][]>([]);
 const choose=useRef(onSelect),focusRisk=useRef(onRiskFocus);
 useEffect(()=>{mapStyleRef.current=mapStyle;},[mapStyle]);
 useEffect(()=>{choose.current=onSelect;focusRisk.current=onRiskFocus;},[onSelect,onRiskFocus]);
 const applyMapStyle=(nextStyle:MapStyle)=>{
  const m=map.current;
  if(!m)return;
  const {road,roadFallback,satellite,labels}=baseLayers.current;
  for(const tile of [road,roadFallback,satellite,labels])if(tile&&m.hasLayer(tile))m.removeLayer(tile);
  if(nextStyle==='satellite'){satellite?.addTo(m);labels?.addTo(m);return;}
  const activeRoad=roadFallbackActive.current?roadFallback:road;
  activeRoad?.addTo(m);
 };
 useEffect(()=>{let disposed=false;let resize:ResizeObserver|undefined;
  import('leaflet').then(lib=>{if(disposed||!container.current)return;L.current=lib;const first=initialCenter.current;const m=lib.map(container.current,{scrollWheelZoom:false,preferCanvas:true}).setView([first.lat,first.lon],12);map.current=m;
   const road=lib.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,attribution:'© OpenStreetMap contributors'});
   const roadFallback=lib.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,attribution:'Tiles © Esri'});
   const satellite=lib.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,attribution:'Tiles © Esri'});
   const labels=lib.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,attribution:'Labels © Esri'});
   road.on('tileerror',()=>{
    if(roadFallbackActive.current)return;
    roadFallbackActive.current=true;
    setError('Primary map tiles were unavailable. Showing fallback road map.');
    if(mapStyleRef.current==='road')applyMapStyle('road');
   });
   satellite.on('tileerror',()=>{
    if(mapStyleRef.current!=='satellite')return;
    setError('Satellite tiles were unavailable on this connection. Showing road map.');
    setMapStyle('road');
   });
   labels.on('tileerror',()=>{if(mapStyleRef.current==='satellite')setError('Some satellite labels could not load.');});
   baseLayers.current={road,roadFallback,satellite,labels};
   applyMapStyle('road');
   m.on('zoomend moveend',()=>setViewRevision(v=>v+1));layer.current=lib.layerGroup().addTo(m);routeLayer.current=lib.layerGroup().addTo(m);navigationLayer.current=lib.layerGroup().addTo(m);resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(container.current);setReady(true);
  }).catch(()=>setError('Map could not load. Use the station list below.'));
  return()=>{disposed=true;resize?.disconnect();map.current?.remove();map.current=null;layer.current=null;routeLayer.current=null;navigationLayer.current=null;baseLayers.current={road:null,roadFallback:null,satellite:null,labels:null};roadFallbackActive.current=false;};
 },[]);
 useEffect(()=>{
  if(!ready||!map.current)return;
  applyMapStyle(mapStyle);
 },[ready,mapStyle]);
 useEffect(()=>{if(ready)map.current?.setView([center.lat,center.lon],12);},[ready,center.lat,center.lon]);
 const routeHasGeometry=!!route?.coordinates?.length&&route.coordinates.length>1;
 useEffect(()=>{
  if(navigationMode&&routeHasGeometry&&route)lastNavigationRouteRef.current=route;
 },[navigationMode,route,routeHasGeometry]);
 useEffect(()=>{
  if(!ready||!L.current||!layer.current)return;const lib=L.current;layer.current.clearLayers();
  const bounds:[number,number][]=[];
  const add=(lat:number,lon:number,text:string,color:string,radius:number,click?:()=>void)=>{bounds.push([lat,lon]);const el=document.createElement('span');el.textContent=text;const marker=lib.circleMarker([lat,lon],{radius,fillColor:color,color:'#10241a',weight:2,fillOpacity:1}).bindTooltip(el).addTo(layer.current!);if(click)marker.on('click',click);};
  const hasRisks=riskSections.length>0;
  if(route&&!navigationMode){
   const routeCoordinates=route.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
   lib.polyline(routeCoordinates,{color:hasRisks?'#9ca9b1':'#428cff',weight:4}).addTo(layer.current);
   if(route.coordinates.length){
    const [startLon,startLat]=route.coordinates[0];
    const [endLon,endLat]=route.coordinates[route.coordinates.length-1];
    add(startLat,startLon,'Trip start','#5b8def',6);
    add(endLat,endLon,'Trip destination','#5b8def',8);
   }
  }
  if(backupRoute){
   lib.polyline(backupRoute.coordinates.map(([lon,lat])=>[lat,lon]),{color:hasRisks?'#9ca9b1':'#f5a65b',weight:5,dashArray:'8 7'}).addTo(layer.current);
   if(backupRoute.coordinates.length){
    const [backupEndLon,backupEndLat]=backupRoute.coordinates[backupRoute.coordinates.length-1];
    add(backupEndLat,backupEndLon,'Backup destination','#f5a65b',7);
   }
  }
  for(const section of riskSections){
   const points=section.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
   bounds.push(...points);
   if(section.id===focusedRiskId)lib.polyline(points,{color:'#fff',weight:10,opacity:.9,interactive:false}).addTo(layer.current);
   const label=document.createElement('span');label.textContent=`${section.path==='backup'?'Backup from main':'Main route'} · ${section.fromMile.toFixed(1)}–${section.toMile.toFixed(1)} mi · ${riskStyles[section.level].label}. ${section.reason} ${section.assumption||''}`;
   lib.polyline(points,{color:riskStyles[section.level].color,weight:section.id===focusedRiskId?7:6,dashArray:section.path==='backup'?'8 7':undefined}).bindTooltip(label,{sticky:true}).on('click',()=>focusRisk.current(section.id)).addTo(layer.current);
  }
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
  visibleBounds.current=bounds;
 },[ready,viewRevision,center,stations,selected,amenities,route,navigationMode,backupRoute,mainId,backupId,availability,riskSections,focusedRiskId]);
 useEffect(()=>{
  if(!ready||!L.current||!routeLayer.current)return;
  const lib=L.current;
  routeLayer.current.clearLayers();
  const routeToDraw=navigationMode?(routeHasGeometry&&route?route:lastNavigationRouteRef.current):null;
  if(!navigationMode||!routeToDraw?.coordinates.length)return;
  const routeCoordinates=routeToDraw.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
  lib.polyline(routeCoordinates,{color:'#d5e0ff',weight:10,opacity:.9,interactive:false}).addTo(routeLayer.current);
  lib.polyline(routeCoordinates,{color:'#355dff',weight:6}).addTo(routeLayer.current);
  const [startLon,startLat]=routeToDraw.coordinates[0];
  const [endLon,endLat]=routeToDraw.coordinates[routeToDraw.coordinates.length-1];
  lib.circleMarker([startLat,startLon],{radius:6,fillColor:'#5b8def',color:'#10241a',weight:2,fillOpacity:1}).bindTooltip('Trip start').addTo(routeLayer.current);
  lib.circleMarker([endLat,endLon],{radius:8,fillColor:'#5b8def',color:'#10241a',weight:2,fillOpacity:1}).bindTooltip('Trip destination').addTo(routeLayer.current);
 },[ready,navigationMode,route,routeFocusToken,routeHasGeometry]);
 useEffect(()=>{
  if(!ready||!L.current||!navigationLayer.current)return;
  const lib=L.current;
  navigationLayer.current.clearLayers();
  if(!navigationMode||!navigationLocation)return;
  if(navigationLocation.accuracyMeters&&navigationLocation.accuracyMeters>0){
   lib.circle([navigationLocation.lat,navigationLocation.lon],{radius:Math.min(220,navigationLocation.accuracyMeters),color:'#7ab3ff',fillColor:'#7ab3ff',fillOpacity:.15,weight:1}).addTo(navigationLayer.current);
  }
  lib.circleMarker([navigationLocation.lat,navigationLocation.lon],{radius:8,color:'#fff',weight:3,fillColor:'#2f6bff',fillOpacity:1}).addTo(navigationLayer.current);
  if(navigationLocation.heading!==null){
   const headingRadians=navigationLocation.heading*Math.PI/180;
   const tipLat=navigationLocation.lat+(Math.cos(headingRadians)*0.0014);
   const tipLon=navigationLocation.lon+(Math.sin(headingRadians)*0.0014);
   lib.polyline([[navigationLocation.lat,navigationLocation.lon],[tipLat,tipLon]],{color:'#2f6bff',weight:4,lineCap:'round'}).addTo(navigationLayer.current);
  }
 },[ready,navigationMode,navigationLocation,navigationLocation?.lat,navigationLocation?.lon,navigationLocation?.accuracyMeters,navigationLocation?.heading]);
 useEffect(()=>{
  if(navigationMode)return;
  const focused=riskSections.find(section=>section.id===focusedRiskId);
  const coordinates=focused?.coordinates||[...(route?.coordinates||[]),...(backupRoute?.coordinates||[])];
  if(ready&&coordinates.length)map.current?.fitBounds(coordinates.map(([lon,lat])=>[lat,lon] as [number,number]),{padding:[35,35],maxZoom:14});
 },[ready,route,backupRoute,focusedRiskId,riskSections,navigationMode]);
 useEffect(()=>{
  if(navigationMode||!ready||!route?.coordinates.length)return;
  map.current?.fitBounds(route.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]),{padding:[35,35],maxZoom:14});
 },[ready,route,routeFocusToken,navigationMode]);
 useEffect(()=>{
  const routeToFocus=navigationMode?(routeHasGeometry&&route?route:lastNavigationRouteRef.current):null;
  if(!ready||!navigationMode||!routeToFocus?.coordinates.length||!map.current)return;
  const focusPoints=routeToFocus.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
  if(navigationLocation)focusPoints.push([navigationLocation.lat,navigationLocation.lon]);
  map.current.fitBounds(focusPoints,{padding:[34,34],maxZoom:14});
 },[ready,navigationMode,route,navigationRecenterToken,navigationLocation?.lat,navigationLocation?.lon,navigationLocation,routeHasGeometry]);
 useEffect(()=>{
  if(navigationMode)return;
  lastNavigationRouteRef.current=null;
  routeLayer.current?.clearLayers();
  navigationLayer.current?.clearLayers();
 },[navigationMode]);
 return <div className="map-panel-shell">
  {!navigationMode&&<div className="map-hud map-hud-inline" aria-live="polite">
   <span className="map-hud-live">Live map</span>
   <span>{stations.length} chargers shown</span>
   {fetchedAt&&<span>Updated {evidenceTime(fetchedAt)}</span>}
   <div className="map-hud-actions">
    <button type="button" disabled={!ready} aria-pressed={mapStyle==='road'} onClick={()=>setMapStyle('road')}>Road map</button>
    <button type="button" disabled={!ready} aria-pressed={mapStyle==='satellite'} onClick={()=>setMapStyle('satellite')}>Satellite</button>
    <button type="button" className="map-search-trigger" disabled={!ready} onClick={()=>{const c=map.current?.getCenter();if(!c)return;onSearch({lat:c.lat,lon:c.lng,label:'Selected map area'});}}>Search this map area</button>
   </div>
  </div>}
  <div className="real-map"><div ref={container} className="leaflet-host" aria-label="Interactive charging-station map" />
   {error&&<p className="map-error" role="status">{error}</p>}
  </div>
 </div>;
}

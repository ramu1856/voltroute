import { env } from 'cloudflare:workers';
import { requireSupabaseUser } from './supabase-server.ts';
import { LocalRateLimitError, ServiceError } from './service-error.ts';
import { loadDirectory } from './directory-cache.ts';
import { WORKER_SITE_URL } from './site-config.ts';
export { LocalRateLimitError, ServiceError } from './service-error.ts';
const memoryRateLimits=new Map<string,number>();
const memoryCache=new Map<string,{payload:string;expires:number}>();
function hasDatabase(){return !!env.DB;}
export function database() { if(!env.DB) throw new Error('Account storage is temporarily unavailable. Please try again later.'); return env.DB; }
export async function requireUser(request:Request) {return requireSupabaseUser(request);}
export function sameOrigin(request:Request) { if(request.headers.get('origin')!==new URL(request.url).origin) throw new ServiceError('This request must come from VoltRoute.',403); }
export async function limit(key:string,ms:number) {
  const now=Date.now();
  if(!hasDatabase()){
    const next=memoryRateLimits.get(key)||0;
    if(next>now) throw new LocalRateLimitError();
    memoryRateLimits.set(key,now+ms);
    return;
  }
  const result=await database().prepare('INSERT INTO provider_limits (key,next) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET next=excluded.next WHERE provider_limits.next <= ? RETURNING key').bind(key,now+ms,now).first();
  if(!result) throw new LocalRateLimitError();
}
export async function cached<T>(key:string,provider:string,seconds:number,loader:()=>Promise<T>):Promise<{data:T; fetchedAt:string}> {
  if(!hasDatabase()){
    const hit=memoryCache.get(key);
    if(hit&&hit.expires>Date.now()) return JSON.parse(hit.payload);
    await limit(`provider:${provider}`,2500);
    const data=await loader();const value={data,fetchedAt:new Date().toISOString()};
    memoryCache.set(key,{payload:JSON.stringify(value),expires:Date.now()+seconds*1000});
    return value;
  }
  const db=database();
  const hit=await db.prepare('SELECT payload FROM provider_cache WHERE key=? AND expires>?').bind(key,Date.now()).first<{payload:string}>();
  if(hit) return JSON.parse(hit.payload);
  await limit(`provider:${provider}`,2500);
  const data=await loader();const value={data,fetchedAt:new Date().toISOString()};
  await db.prepare('INSERT INTO provider_cache(key,payload,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires').bind(key,JSON.stringify(value),Date.now()+seconds*1000).run();
  return value;
}
export async function cachedDirectory<T>(key:string,loader:()=>Promise<T>) {
  if(!hasDatabase()){
    return loadDirectory({
      read:async()=>memoryCache.get(key)||null,
      write:async row=>{memoryCache.set(key,row);},
      refresh:async()=>{
        try { await limit('provider:overpass',2500); }
        catch(error) { if(!(error instanceof LocalRateLimitError))throw error;await new Promise(resolve=>setTimeout(resolve,2600));await limit('provider:overpass',2500); }
        return loader();
      },
    });
  }
  const db=database();
  return loadDirectory({
    read:()=>db.prepare('SELECT payload,expires FROM provider_cache WHERE key=?').bind(key).first<{payload:string;expires:number}>(),
    write:row=>db.prepare('INSERT INTO provider_cache(key,payload,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires').bind(key,row.payload,row.expires).run(),
    refresh:async()=>{
      // A station selection can follow a search immediately. Wait once for our
      // own shared gate; upstream quota errors are never automatically retried.
      try { await limit('provider:overpass',2500); }
      catch(error) { if(!(error instanceof LocalRateLimitError))throw error;await new Promise(resolve=>setTimeout(resolve,2600));await limit('provider:overpass',2500); }
      return loader();
    },
  });
}
export async function fetchJson(url:string,options:RequestInit={}) {
  try {
    const response=await fetch(url,{...options,headers:{'User-Agent':`VoltRoute/2.0 (+${WORKER_SITE_URL})`,'Accept':'application/json',...options.headers},signal:AbortSignal.timeout(22000)});
    if(!response.ok) throw new ServiceError(`The map data provider is unavailable (${response.status}). Please try again later.`,response.status===429?429:503);
    return await response.json();
  } catch(error) {if(error instanceof ServiceError)throw error;throw new ServiceError('The map data provider did not respond. Please try again later.');}
}
export function failure(error:unknown) {const status=error instanceof ServiceError?error.status:503;return Response.json({error: error instanceof Error?error.message:'Service unavailable'},{status,headers:{'Cache-Control':'no-store'}});}

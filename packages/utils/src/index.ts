/**
 * @exam/utils — small dependency-free helpers shared between web and api.
 * Keep this package free of framework/runtime-specific code (no DOM, no Node "fs").
 */
export function generateId(prefix?: string): string { const runtimeCrypto=(typeof globalThis!=='undefined'?(globalThis as any).crypto:undefined) as Crypto|undefined; let rnd:string; if(runtimeCrypto?.randomUUID) rnd=runtimeCrypto.randomUUID(); else if(runtimeCrypto?.getRandomValues){const bytes=new Uint8Array(16);runtimeCrypto.getRandomValues(bytes);rnd=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');} else rnd=`${Date.now().toString(36)}-${processSafeCounter++}`; return prefix?`${prefix}_${rnd}`:rnd; }
let processSafeCounter=0;
export function nowTs():number{return Date.now();}
export function generateShareCode():string{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const cryptoApi=(typeof globalThis!=='undefined'?(globalThis as any).crypto:undefined) as Crypto|undefined;if(!cryptoApi?.getRandomValues)throw new Error('Secure random generator unavailable');const limit=256-(256%chars.length);let code='';while(code.length<6){const bytes=new Uint8Array(12);cryptoApi.getRandomValues(bytes);for(const b of bytes){if(b>=limit)continue;code+=chars[b%chars.length];if(code.length===6)break;}}return code;}
export function clamp(n:number,min:number,max:number):number{return Math.min(Math.max(n,min),max);}
/** Deterministic PRNG shuffle for persisted competition sessions. */
export function shuffleWithSeed<T>(items:T[],seed:string):T[]{const arr=[...items];let state=2166136261>>>0;for(let i=0;i<seed.length;i++){state^=seed.charCodeAt(i);state=Math.imul(state,16777619)>>>0;}const next=()=>{state=(Math.imul(state^(state>>>15),2246822519)+3266489917)>>>0;state^=state>>>13;state=Math.imul(state,1274126177)>>>0;state^=state>>>16;return (state >>> 0)/0x100000000;};for(let i=arr.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}
export function formatDuration(seconds:number):string{const m=Math.floor(seconds/60);const s=Math.floor(seconds%60);return `${m}:${s.toString().padStart(2,'0')}`;}
export {durationFromMinutes,durationToMinutes,validateDurationSeconds} from './duration';

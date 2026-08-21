import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AiKey = { id:string; name:string; key:string; model:string; enabled:boolean; failures:number; cooldownUntil:number; createdAt:number; lastUsedAt?:number };

let db: DatabaseSync | undefined;
let seeded = false;
const memoryKeys = new Map<string,AiKey>();

export function initAiPool(database?: DatabaseSync) {
  db = database;
  seeded = false;
  seed();
}

function envAiKey(): AiKey | undefined {
  const envKey = process.env.GROQ_API_KEY?.trim();
  if (!envKey) return undefined;
  return {id:"env-default",name:"Groq mặc định",key:envKey,model:process.env.GROQ_MODEL?.trim()||"llama-3.3-70b-versatile",enabled:true,failures:0,cooldownUntil:0,createdAt:Date.now()};
}

function seed() {
  if (seeded) return;
  seeded = true;
  // GROQ_API_KEY is an environment variable and is intentionally not copied to DB.
  // Keys added from the Admin UI are persisted in SQLite so redeploy/restart does not remove them.
  if (db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_keys (id TEXT PRIMARY KEY,name TEXT NOT NULL,api_key TEXT NOT NULL,model TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,failures INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_used_at INTEGER);`);
  }
}

export type AiLimits = { chatPerMinute:number; explainPerMinute:number; jsonPerMinute:number };

export function getAiLimits(): AiLimits {
  seed();
  const fallback:AiLimits={chatPerMinute:20,explainPerMinute:10,jsonPerMinute:5};
  if(!db) return fallback;
  try {
    const rows=(db.prepare("SELECT key,value FROM ai_settings WHERE key IN ('AI_CHAT_RATE_LIMIT_PER_MINUTE','AI_EXPLAIN_RATE_LIMIT_PER_MINUTE','AI_JSON_RATE_LIMIT_PER_MINUTE')").all() as any[]);
    const map=new Map(rows.map(r=>[String(r.key),Number(r.value)]));
    const read=(key:string,fallbackValue:number)=>{const v=map.get(key);return typeof v==='number'&&Number.isFinite(v)?v:fallbackValue};
    return {chatPerMinute:read('AI_CHAT_RATE_LIMIT_PER_MINUTE',fallback.chatPerMinute),explainPerMinute:read('AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',fallback.explainPerMinute),jsonPerMinute:read('AI_JSON_RATE_LIMIT_PER_MINUTE',fallback.jsonPerMinute)};
  } catch { return fallback; }
}

export function setAiLimits(limits:Partial<AiLimits>, updatedBy?:string) {
  seed();
  if(!db) return;
  const now=Date.now();
  const entries:[string,number|undefined][]=[['AI_CHAT_RATE_LIMIT_PER_MINUTE',limits.chatPerMinute],['AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',limits.explainPerMinute],['AI_JSON_RATE_LIMIT_PER_MINUTE',limits.jsonPerMinute]];
  for(const [key,value] of entries){if(value===undefined)continue;db.prepare("INSERT INTO ai_settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(key,value,now,updatedBy??null);}
}

function rowToKey(row:any): AiKey {
  return {id:String(row.id),name:String(row.name),key:String(row.api_key),model:String(row.model),enabled:Number(row.enabled)===1,failures:Number(row.failures??0),cooldownUntil:Number(row.cooldown_until??0),createdAt:Number(row.created_at),lastUsedAt:row.last_used_at==null?undefined:Number(row.last_used_at)};
}

function allStored(): AiKey[] {
  if (!db) return [...memoryKeys.values()];
  return (db.prepare("SELECT id,name,api_key,model,enabled,failures,cooldown_until,created_at,last_used_at FROM ai_keys ORDER BY created_at ASC").all() as any[]).map(rowToKey);
}

export function listAiKeys() {
  seed();
  const env = envAiKey();
  const stored = allStored();
  const keys = env ? [env, ...stored.filter(k=>k.id!=="env-default")] : stored;
  return keys.map(({key,...x})=>({...x,maskedKey:key.slice(0,7)+"••••••"+key.slice(-4)}));
}

export function addAiKey(name:string,key:string,model?:string) {
  seed();
  const id=crypto.randomUUID();
  const value={id,name:name.trim()||"Groq API",key:key.trim(),model:model?.trim()||"llama-3.3-70b-versatile",enabled:true,failures:0,cooldownUntil:0,createdAt:Date.now()};
  if (db) db.prepare("INSERT INTO ai_keys(id,name,api_key,model,enabled,failures,cooldown_until,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,NULL)").run(value.id,value.name,value.key,value.model,1,0,0,value.createdAt);
  else memoryKeys.set(id,value);
  return id;
}

export function deleteAiKey(id:string) {
  seed();
  if (id==="env-default") return false;
  if (!db) return memoryKeys.delete(id);
  return Number(db.prepare("DELETE FROM ai_keys WHERE id=?").run(id).changes) === 1;
}

export function setAiKey(id:string,enabled:boolean) {
  seed();
  if (id==="env-default") return false;
  if (!db) { const k=memoryKeys.get(id); if(!k)return false; k.enabled=enabled; return true; }
  return Number(db.prepare("UPDATE ai_keys SET enabled=? WHERE id=?").run(enabled?1:0,id).changes) === 1;
}

function candidates(): AiKey[] {
  const env = envAiKey();
  const stored = allStored();
  const keys = env ? [env, ...stored.filter(k=>k.id!=="env-default")] : stored;
  const now=Date.now();
  return keys.filter(k=>k.enabled&&k.cooldownUntil<=now);
}

function updateRuntime(key:AiKey, patch:Partial<AiKey>) {
  Object.assign(key,patch);
  if (key.id==="env-default") return;
  if (!db) { memoryKeys.set(key.id,key); return; }
  db.prepare("UPDATE ai_keys SET failures=?,cooldown_until=?,last_used_at=? WHERE id=?").run(key.failures,key.cooldownUntil,key.lastUsedAt??null,key.id);
}

export async function groqChat(messages:Array<{role:"system"|"user"|"assistant";content:string}>, temperature=0.2) {
  seed();
  const pool=candidates();
  if(!pool.length) throw new Error("AI_PROVIDER_UNAVAILABLE");
  let last:unknown;
  for(const k of pool) {
    try {
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
      const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${k.key}`},body:JSON.stringify({model:k.model,messages,temperature}),signal:controller.signal});
      clearTimeout(timer);
      if(!res.ok) {
        const text=await res.text(); last=new Error(`GROQ_${res.status}`);
        if(res.status===429||res.status>=500){
          const failures=k.failures+1;
          updateRuntime(k,{failures,cooldownUntil:Date.now()+Math.min(60000,2000*2**Math.min(failures,5))});
          continue;
        }
        throw new Error(text.slice(0,300));
      }
      const data:any=await res.json();
      updateRuntime(k,{failures:0,cooldownUntil:0,lastUsedAt:Date.now()});
      return String(data?.choices?.[0]?.message?.content??"");
    } catch(e) { last=e; }
  }
  throw last instanceof Error?last:new Error("AI_PROVIDER_UNAVAILABLE");
}

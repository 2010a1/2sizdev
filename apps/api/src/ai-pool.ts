import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AiKey = {
  id: string; name: string; key: string; model: string; enabled: boolean; provider: "gemini";
  failures: number; cooldownUntil: number; createdAt: number; lastUsedAt?: number;
  rpmLimit: number; windowStart: number; windowCount: number;
};

let db: DatabaseSync | undefined;
let seeded = false;
const memoryKeys = new Map<string, AiKey>();
const envRuntimeKeys = new Map<string, AiKey>();
let memoryCursor = 0;

export function initAiPool(database?: DatabaseSync) { db = database; seeded = false; seed(); }

function envLimit() { const n = Number(process.env.GEMINI_RPM_LIMIT ?? 15); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 15; }
function envModels() { return (process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite").trim() || "gemini-3.1-flash-lite"; }
function envKeys(): AiKey[] {
  // Supports either a comma/newline separated pool or explicit numbered keys.
  // Numbered variables make adding five (or more) independent keys easy in hosting panels.
  const values: string[] = [];
  const pooled = process.env.GEMINI_API_KEYS?.trim() || "";
  if (pooled) values.push(...pooled.split(/[,\n]+/));
  for (let i = 1; i <= 20; i++) {
    const value = process.env[`GEMINI_API_KEY_${i}`]?.trim();
    if (value) values.push(value);
  }
  if (!values.length && process.env.GEMINI_API_KEY?.trim()) values.push(process.env.GEMINI_API_KEY.trim());

  const unique = [...new Set(values.map(key => key.trim()).filter(Boolean))];
  return unique.map((key, index) => {
    const id = `env-gemini-${index}`;
    const previous = envRuntimeKeys.get(id);
    const value = previous ?? { id, name: `Gemini env #${index + 1}`, key, model: envModels(), provider: "gemini" as const, enabled: true, failures: 0, cooldownUntil: 0, createdAt: index, rpmLimit: envLimit(), windowStart: 0, windowCount: 0 };
    value.key = key; value.model = envModels(); value.rpmLimit = envLimit();
    envRuntimeKeys.set(id, value); return value;
  });
}

export type AiLimits = { chatPerMinute:number; explainPerMinute:number; jsonPerMinute:number };

const memoryAiLimits = new Map<string, number>();

function seed() {
  if (seeded) return; seeded = true;
  if (db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_keys (id TEXT PRIMARY KEY,name TEXT NOT NULL,api_key TEXT NOT NULL,model TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'gemini',enabled INTEGER NOT NULL DEFAULT 1,failures INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0,rpm_limit INTEGER NOT NULL DEFAULT 15,window_start INTEGER NOT NULL DEFAULT 0,window_count INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_used_at INTEGER);`);
    db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);`);
    const columns = new Set((db.prepare("PRAGMA table_info(ai_keys)").all() as any[]).map(r => String(r.name)));
    if (!columns.has("provider")) db.exec("ALTER TABLE ai_keys ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini'");
    if (!columns.has("rpm_limit")) db.exec("ALTER TABLE ai_keys ADD COLUMN rpm_limit INTEGER NOT NULL DEFAULT 15");
    if (!columns.has("window_start")) db.exec("ALTER TABLE ai_keys ADD COLUMN window_start INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("window_count")) db.exec("ALTER TABLE ai_keys ADD COLUMN window_count INTEGER NOT NULL DEFAULT 0");
  }
}

export function getAiLimits(): AiLimits {
  seed();
  const fallback:AiLimits={chatPerMinute:20,explainPerMinute:10,jsonPerMinute:5};
  if(!db){
    const read=(key:string,fallbackValue:number)=>{const v=memoryAiLimits.get(key);return typeof v==='number'&&Number.isFinite(v)?v:fallbackValue};
    return {chatPerMinute:read('AI_CHAT_RATE_LIMIT_PER_MINUTE',fallback.chatPerMinute),explainPerMinute:read('AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',fallback.explainPerMinute),jsonPerMinute:read('AI_JSON_RATE_LIMIT_PER_MINUTE',fallback.jsonPerMinute)};
  }
  try {
    const rows=(db.prepare("SELECT key,value FROM ai_settings WHERE key IN ('AI_CHAT_RATE_LIMIT_PER_MINUTE','AI_EXPLAIN_RATE_LIMIT_PER_MINUTE','AI_JSON_RATE_LIMIT_PER_MINUTE')").all() as any[]);
    const map=new Map(rows.map(r=>[String(r.key),Number(r.value)]));
    const read=(key:string,fallbackValue:number)=>{const v=map.get(key);return typeof v==='number'&&Number.isFinite(v)?v:fallbackValue};
    return {chatPerMinute:read('AI_CHAT_RATE_LIMIT_PER_MINUTE',fallback.chatPerMinute),explainPerMinute:read('AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',fallback.explainPerMinute),jsonPerMinute:read('AI_JSON_RATE_LIMIT_PER_MINUTE',fallback.jsonPerMinute)};
  } catch { return fallback; }
}

export function setAiLimits(limits:Partial<AiLimits>, updatedBy?:string) {
  seed(); const now=Date.now();
  const entries:[string,number|undefined][]=[['AI_CHAT_RATE_LIMIT_PER_MINUTE',limits.chatPerMinute],['AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',limits.explainPerMinute],['AI_JSON_RATE_LIMIT_PER_MINUTE',limits.jsonPerMinute]];
  for(const [key,value] of entries){if(value===undefined)continue;if(!db){memoryAiLimits.set(key,value);continue;}db.prepare("INSERT INTO ai_settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(key,value,now,updatedBy??null);}
}

function rowToKey(row:any): AiKey { return {id:String(row.id),name:String(row.name),key:String(row.api_key),model:String(row.model),provider:"gemini",enabled:Number(row.enabled)===1,failures:Number(row.failures??0),cooldownUntil:Number(row.cooldown_until??0),createdAt:Number(row.created_at),lastUsedAt:row.last_used_at==null?undefined:Number(row.last_used_at),rpmLimit:Math.max(1,Number(row.rpm_limit??15)),windowStart:Number(row.window_start??0),windowCount:Number(row.window_count??0)}; }
function allStored(): AiKey[] { if(!db)return [...memoryKeys.values()]; return (db.prepare("SELECT id,name,api_key,model,enabled,failures,cooldown_until,rpm_limit,window_start,window_count,created_at,last_used_at FROM ai_keys WHERE provider='gemini' ORDER BY created_at ASC").all() as any[]).map(rowToKey); }
export function listAiKeys(){seed();const keys=[...envKeys(),...allStored().filter(k=>!k.id.startsWith("env-gemini-"))];return keys.map(({key,...x})=>({...x,maskedKey:key.slice(0,7)+"••••••"+key.slice(-4)}));}

export function addAiKey(name:string,key:string,model?:string,rpmLimit=15){
  seed(); const id=crypto.randomUUID(); const value:AiKey={id,name:name.trim()||"Gemini API",key:key.trim(),model:model?.trim()||envModels(),provider:"gemini",enabled:true,failures:0,cooldownUntil:0,createdAt:Date.now(),rpmLimit:Math.max(1,Math.min(1000,Math.floor(rpmLimit))),windowStart:0,windowCount:0};
  if(db)db.prepare("INSERT INTO ai_keys(id,name,api_key,model,provider,enabled,failures,cooldown_until,rpm_limit,window_start,window_count,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)").run(value.id,value.name,value.key,value.model,value.provider,1,0,0,value.rpmLimit,0,0,value.createdAt); else memoryKeys.set(id,value); return id;
}
export function deleteAiKey(id:string){seed();if(id.startsWith("env-gemini-"))return false;if(!db)return memoryKeys.delete(id);return Number(db.prepare("DELETE FROM ai_keys WHERE id=?").run(id).changes)===1;}
export function setAiKey(id:string,enabled:boolean){seed();if(id.startsWith("env-gemini-"))return false;if(!db){const k=memoryKeys.get(id);if(!k)return false;k.enabled=enabled;return true;}return Number(db.prepare("UPDATE ai_keys SET enabled=? WHERE id=?").run(enabled?1:0,id).changes)===1;}

function storedKey(id:string): AiKey | undefined { if(!db)return memoryKeys.get(id); const row=db.prepare("SELECT id,name,api_key,model,enabled,failures,cooldown_until,rpm_limit,window_start,window_count,created_at,last_used_at FROM ai_keys WHERE id=?").get(id) as any; return row?rowToKey(row):undefined; }
function reserveSlot(key: AiKey): boolean {
  const now=Date.now(), start=Math.floor(now/60000)*60000;
  if(key.cooldownUntil>now||!key.enabled)return false;
  if(!db){
    const current=key.id.startsWith("env-gemini-") ? (envRuntimeKeys.get(key.id) ?? key) : (memoryKeys.get(key.id) ?? key);
    if(current.windowStart!==start){current.windowStart=start;current.windowCount=0;}
    if(current.windowCount>=current.rpmLimit)return false;
    current.windowCount++; if(current.id.startsWith("env-gemini-")) envRuntimeKeys.set(current.id,current); else memoryKeys.set(current.id,current); key.windowStart=current.windowStart;key.windowCount=current.windowCount; return true;
  }
  // Atomic reservation: the transaction is synchronous, so two concurrent HTTP handlers cannot both reserve slot 15.
  try {
    db.exec("BEGIN IMMEDIATE;");
    const row=db.prepare("SELECT enabled,cooldown_until,rpm_limit,window_start,window_count FROM ai_keys WHERE id=?").get(key.id) as any;
    if(!row||Number(row.enabled)!==1||Number(row.cooldown_until)>now){db.exec("ROLLBACK;");return false;}
    const ws=Number(row.window_start)===start?Number(row.window_start):start;
    const count=Number(row.window_start)===start?Number(row.window_count):0;
    const limit=Math.max(1,Number(row.rpm_limit)||15);
    if(count>=limit){db.exec("COMMIT;");return false;}
    db.prepare("UPDATE ai_keys SET window_start=?,window_count=? WHERE id=?").run(ws,count+1,key.id);
    db.exec("COMMIT;"); key.windowStart=ws;key.windowCount=count+1;key.rpmLimit=limit;return true;
  } catch(e){try{db.exec("ROLLBACK;")}catch{};return false;}
}

function updateRuntime(key:AiKey, patch:Partial<AiKey>){Object.assign(key,patch);if(key.id.startsWith("env-gemini-")){envRuntimeKeys.set(key.id,key);return;}if(!db){memoryKeys.set(key.id,key);return;}db.prepare("UPDATE ai_keys SET failures=?,cooldown_until=?,last_used_at=?,enabled=? WHERE id=?").run(key.failures,key.cooldownUntil,key.lastUsedAt??null,key.enabled?1:0,key.id);}
function candidates(){const now=Date.now();return [...envKeys(),...allStored().filter(k=>!k.id.startsWith("env-gemini-"))].filter(k=>k.enabled&&k.cooldownUntil<=now);}
function retryAfterMs(res:Response){const raw=res.headers.get("retry-after");const n=raw?Number(raw):NaN;return Number.isFinite(n)?Math.max(1000,n*1000):60000;}

export async function geminiChat(messages:Array<{role:"system"|"user"|"assistant";content:string}>, temperature=0.2) {
  seed(); const pool=candidates(); if(!pool.length)throw new Error("AI_PROVIDER_UNAVAILABLE"); let last:unknown; let checked=0;
  // Round-robin starting point avoids one key receiving all traffic while every key is under its own atomic RPM cap.
  const ordered=pool.map((_,i)=>pool[(memoryCursor+i)%pool.length]); memoryCursor=(memoryCursor+1)%Math.max(pool.length,1);
  for(const k of ordered){checked++; if(!reserveSlot(k))continue;
    try {
      const contents=messages.filter(m=>m.role!=="system").map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
      const system=messages.find(m=>m.role==='system')?.content;
      const body:any={contents};if(system)body.systemInstruction={parts:[{text:system}]};
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
      const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(k.model)}:generateContent?key=${encodeURIComponent(k.key)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal});clearTimeout(timer);
      if(!res.ok){const text=await res.text();last=new Error(`GEMINI_${res.status}`);if(res.status===429||res.status>=500){const failures=k.failures+1;updateRuntime(k,{failures,cooldownUntil:Date.now()+retryAfterMs(res)});continue;}throw new Error(text.slice(0,300));}
      const data:any=await res.json();const answer=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text??"").join("")??"");updateRuntime(k,{failures:0,cooldownUntil:0,lastUsedAt:Date.now()});return answer;
    }catch(e){last=e;}
  }
  throw last instanceof Error?last:new Error(checked?"AI_PROVIDER_RATE_LIMITED":"AI_PROVIDER_UNAVAILABLE");
}


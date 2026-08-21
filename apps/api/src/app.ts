import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import crypto from "node:crypto";
import { importExam, exportExam } from "@exam/exam-format";
import { ExamContentSchema } from "@exam/schemas";
import { z } from "zod";
import { hashPassword, verifyPassword, newSession, hashSessionToken, MemoryAuthStore, SqliteAuthStore, type AuthStore, type Account, type SecurityEvent, type SecurityAlert, type Role, type AccountStatus } from "./auth.js";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limit.js";
import { initAiPool, listAiKeys, addAiKey, deleteAiKey, setAiKey, groqChat, getAiLimits, setAiLimits } from "./ai-pool.js";
import {
  MemoryServerRepository,
  MemoryShareRepository,
  MemorySyncRepository,
  createSqliteRepositories,
  type ServerRepository,
  type ShareRepository,
  type SyncRepository,
  type ServerEntity
} from "./repositories.js";

const entityTypes = ["exam","question","examAsset","vocabulary","vocabQuestion","vocabularySet","vocabularySetItem","legacy"] as const;
const operations = ["CREATE","UPDATE","DELETE"] as const;
const pushSchema = z.object({
  deviceId: z.string().min(1).max(200),
  mutations: z.array(z.object({
    mutationId: z.string().min(1).max(200),
    profileId: z.string().min(1).max(200),
    deviceId: z.string().min(1).max(200),
    entityType: z.enum(entityTypes),
    entityId: z.string().min(1).max(300),
    operation: z.enum(operations),
    baseRevision: z.number().int().nonnegative(),
    updatedAt: z.number().finite(),
    payload: z.unknown().optional()
  }).strict()).max(500)
}).strict();
const shareSchema = z.object({
  packageType: z.enum(["exam", "vocabularySet"]).default("exam"),
  packageBase64: z.string().min(1).max(36_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
  formatVersion: z.number().int().nonnegative(),
  expiresIn: z.enum(["24h","7d","never"]),
  ownerDeviceId: z.string().max(200).optional()
}).strict();

type BuildOptions = {
  serverRepository?: ServerRepository;
  syncRepository?: SyncRepository;
  shareRepository?: ShareRepository;
  authStore?: AuthStore;
};

function envNumber(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
function allowedOrigins() {
  return (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",").map(s => s.trim()).filter(Boolean);
}
function key(profileId: string, entityType: string, entityId: string) {
  return `${profileId}:${entityType}:${entityId}`;
}
function expiry(value: "24h" | "7d" | "never") {
  return value === "never" ? undefined : Date.now() + (value === "24h" ? 86_400_000 : 604_800_000);
}
function createShareCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const alphabetSize = chars.length;
  const limit = 256 - (256 % alphabetSize);
  let code = "";
  while (code.length < 6) {
    for (const byte of crypto.randomBytes(12)) {
      if (byte >= limit) continue;
      code += chars[byte % alphabetSize];
      if (code.length === 6) break;
    }
  }
  return code;
}
function compare(incoming: { updatedAt: number; deviceId: string }, current: ServerEntity) {
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt ? "incoming" : "current";
  return incoming.deviceId > current.deviceId ? "incoming" : "current";
}
function isValidBase64(value: string) {
  if (value.length % 4 !== 0) return false;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length > 0 && bytes.toString("base64") === value;
  } catch { return false; }
}
// Deployment topology is Internet -> nginx -> Fastify (exactly one hop).
// `trustProxy: true` would trust the ENTIRE X-Forwarded-For chain and take the
// left-most (client-supplied) address as req.ip, which nginx's
// `X-Forwarded-For $proxy_add_x_forwarded_for` directive APPENDS to rather than
// replaces -- so an attacker sending `X-Forwarded-For: 1.2.3.4` would have that
// spoofed value trusted as their IP for rate limiting, security events, and
// audit logs. Using a numeric hop count instead makes Fastify (via proxy-addr)
// trust only the nearest N proxies and read the address just beyond that
// boundary, which is the one nginx itself appended -- i.e. the real client IP.
// TRUST_PROXY=true is kept as a convenience alias for "1 trusted hop" (our
// actual topology); set TRUST_PROXY to an explicit integer if that topology
// ever changes (e.g. an extra load balancer in front of nginx).
function resolveTrustProxy(): boolean | ((address: string, hop: number) => boolean) {
  const raw = (process.env.TRUST_PROXY ?? "false").trim().toLowerCase();
  if (raw === "" || raw === "false") return false;

  // Fastify supports numeric hop counts at runtime, but the installed Fastify
  // 5 typings in this lockfile do not expose the numeric form. A trust function
  // expresses the same policy while remaining type-safe: trust only the nearest
  // N proxy hops and never an unbounded X-Forwarded-For chain.
  const hops = raw === "true" ? 1 : Number(raw);
  if (!Number.isInteger(hops) || hops <= 0) return false;
  return (_address: string, hop: number) => hop < hops;
}

export function buildApp(options: BuildOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "production" ? { level: process.env.LOG_LEVEL ?? "info" } : false,
    trustProxy: resolveTrustProxy(),
    bodyLimit: 36 * 1024 * 1024,
    requestTimeout: envNumber("REQUEST_TIMEOUT_MS", 10_000, 1_000, 120_000),
    connectionTimeout: envNumber("CONNECTION_TIMEOUT_MS", 10_000, 1_000, 120_000)
  });
  const productionRepositories = !options.serverRepository && !options.syncRepository && !options.shareRepository && (process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "test" ? "memory" : "sqlite")) === "sqlite"
    ? createSqliteRepositories(process.env.DATABASE_URL)
    : undefined;
  const serverRepository = options.serverRepository ?? productionRepositories?.serverRepository ?? new MemoryServerRepository();
  const syncRepository = options.syncRepository ?? productionRepositories?.syncRepository ?? new MemorySyncRepository();
  const shareRepository = options.shareRepository ?? productionRepositories?.shareRepository ?? new MemoryShareRepository();
  const authStore: AuthStore = options.authStore ?? (productionRepositories?.db ? new SqliteAuthStore(productionRepositories.db) : new MemoryAuthStore());
  initAiPool(productionRepositories?.db);
  const loginRate: RateLimiter = new MemoryRateLimiter();
  const registerRate: RateLimiter = new MemoryRateLimiter();
  const adminRate: RateLimiter = new MemoryRateLimiter();
  const activityRate: RateLimiter = new MemoryRateLimiter();
  const shareRate: RateLimiter = new MemoryRateLimiter();
  const shareCreateRate: RateLimiter = new MemoryRateLimiter();
  const officialDownloadRate: RateLimiter = new MemoryRateLimiter();
  const requestRateLimiter: RateLimiter = new MemoryRateLimiter();
  const shareLimit = envNumber("SHARE_LOOKUP_RATE_LIMIT_PER_MINUTE", 60, 1, 10_000);
  const generalLimit = envNumber("RATE_LIMIT_PER_MINUTE", 120, 1, 10_000);
  const shareCodePattern = /^[A-HJ-NP-Z2-9]{6,10}$/;

  app.register(cors, { credentials: true, origin: (origin, cb) => {
    const origins=allowedOrigins().filter(value=>value!=="*");
    if (!origin || origins.includes(origin)) cb(null, true);
    else cb(new Error("CORS origin denied"), false);
  }});

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const cookie = String(req.headers.cookie ?? '');
      const origin = String(req.headers.origin ?? '');
      if (cookie.includes('exam_session=') && origin && !allowedOrigins().includes('*') && !allowedOrigins().includes(origin)) return reply.code(403).send({ error: { code: 'CSRF_ORIGIN_DENIED', message: 'Origin không được phép.' } });
    }
    const ip = req.ip;
    const now = Date.now();
    requestRateLimiter.clearExpired(now);
    const rate = requestRateLimiter.consume(ip, generalLimit);
    if (!rate.allowed) { void authStore.addSecurityEvent({id:crypto.randomUUID(),action:'RATE_LIMITED',severity:'WARNING',ip:req.ip,userAgent:String(req.headers['user-agent']??''),endpoint:req.url,result:'BLOCKED',createdAt:now}); return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests" } }); }
  });

  app.addHook("onClose", async () => {
    for(const timer of discordTimers.values()) clearTimeout(timer);
    discordTimers.clear();
    await Promise.all([serverRepository.close(), syncRepository.close(), shareRepository.close(), authStore.cleanup(), authStore.close()]);
  });

  app.setErrorHandler((error, req, reply) => {
    const raw = error as any;
    const status = raw.statusCode && raw.statusCode < 500 ? raw.statusCode : 500;
    // Keep the browser response safe, but make Railway logs actionable.
    req.log.error({ operation: req.method, path: req.url, errorCode: raw.code, errorMessage: raw.message, stack: raw.stack }, "request failed");
    if (reply.sent) return;
    if (raw.statusCode === 413) return reply.code(413).send({ error: { code: "TOO_LARGE", message: "Request body is too large" } });
    if (raw.code === "FST_ERR_CTP_INVALID_JSON_BODY") return reply.code(400).send({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } });
    if (raw.code === "SQLITE_BUSY" || raw.code === "SQLITE_LOCKED" || /database is locked|database table is locked/i.test(String(raw.message ?? ""))) {
      return reply.code(503).send({ error: { code: "STORAGE_BUSY", message: "Kho dữ liệu đang bận, vui lòng thử lại sau." } });
    }
    return reply.code(status).send({ error: { code: "INTERNAL_ERROR", message: "Request could not be completed" } });
  });

  // Useful fallback when the API is accidentally exposed directly instead of behind nginx.
  app.get("/", async () => ({ ok: true, service: "exam-api", message: "API is running; use the web service for the application UI." }));
  app.get("/api/health", async () => ({ ok: true, service: "exam-api", time: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()) }));

  // AI / Groq: all provider keys stay server-side. UI never receives the raw key.
  app.get("/api/ai/status", async () => ({ enabled: Boolean(process.env.GROQ_API_KEY) || listAiKeys().length > 0 }));
  app.post("/api/ai/chat", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const aiChatLimit=getAiLimits().chatPerMinute;if(aiChatLimit<=0)return reply.code(403).send({error:{code:"AI_DISABLED",message:"AI chat hiện đang bị admin tắt."}});if (!bucket(activityRate, `ai-chat:${user.id}`, Math.min(1000,aiChatLimit))) return reply.code(429).send({error:{code:"AI_RATE_LIMITED",message:"AI đang được hỏi quá nhanh. Vui lòng thử lại sau."}});
    const parsed=z.object({message:z.string().trim().min(1).max(4000),history:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(8000)})).max(10).optional()}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_REQUEST",message:"Nội dung không hợp lệ."}});
    try {
      const history=(parsed.data.history??[]).map(x=>({role:x.role,content:x.content}));
      const answer=await groqChat([{role:"system",content:"Bạn là trợ lý học tập của web Thi Thử. Trả lời ngắn gọn, dễ hiểu bằng tiếng Việt. Không bịa dữ kiện khi không chắc."},...history,{role:"user",content:parsed.data.message}]);
      return {answer};
    } catch(e) { req.log.warn({err:e},"AI chat failed"); return reply.code(503).send({error:{code:"AI_UNAVAILABLE",message:"AI hiện đang bận hoặc hết hạn mức. Vui lòng thử lại sau."}}); }
  });
  app.post("/api/ai/explain", async (req, reply) => {
    const user=await requireUser(req,reply); if(!user)return;
    const aiExplainLimit=getAiLimits().explainPerMinute;if(aiExplainLimit<=0)return reply.code(403).send({error:{code:"AI_DISABLED",message:"Tính năng giải thích AI hiện đang bị admin tắt."}});if(!bucket(activityRate,`ai-explain:${user.id}`,Math.min(1000,aiExplainLimit)))return reply.code(429).send({error:{code:"AI_RATE_LIMITED",message:"Bạn đã yêu cầu giải thích quá nhiều. Vui lòng thử lại sau."}});
    const parsed=z.object({
      question:z.preprocess(v=>typeof v==="string"?v:String(v??""),z.string().trim().min(1).max(30000)),
      userAnswer:z.preprocess(v=>typeof v==="string"?v:String(v??""),z.string().max(10000)),
      correctAnswer:z.preprocess(v=>typeof v==="string"?v:String(v??""),z.string().max(10000)),
      existingExplanation:z.preprocess(v=>v==null||v===""?undefined:typeof v==="string"?v:String(v),z.string().max(10000).optional())
    }).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_REQUEST",message:"Dữ liệu câu hỏi không hợp lệ."}});
    try { const answer=await groqChat([{role:"system",content:"Bạn là gia sư tiếng Việt. Giải thích ngắn gọn, dễ hiểu. Bắt buộc dùng Markdown đơn giản: tiêu đề **Giải thích:**, sau đó 2-4 gạch đầu dòng. Dùng **Đáp án đúng**, **Đáp án học sinh**, **Vì sao** để làm nổi bật. Chỉ gọi đáp án bằng nội dung chữ mà học sinh nhìn thấy; tuyệt đối không nhắc ID nội bộ như q1_o1, q1_o2, optionId hoặc mã kỹ thuật. Không dùng dấu backslash trước dấu *. Không trả lời JSON."},{role:"user",content:`Câu hỏi:\n${parsed.data.question}\n\nĐáp án học sinh:\n${parsed.data.userAnswer}\n\nĐáp án đúng:\n${parsed.data.correctAnswer}\n\nGiải thích có sẵn (nếu có):\n${parsed.data.existingExplanation??"Không có"}`}]); return {answer}; }
    catch(e){req.log.warn({err:e},"AI explanation failed");return reply.code(503).send({error:{code:"AI_UNAVAILABLE",message:"AI hiện không khả dụng."}});}
  });
  app.post("/api/ai/repair-json", async (req, reply) => {
    const user=await requireUser(req,reply); if(!user)return;
    const aiJsonLimit=getAiLimits().jsonPerMinute;if(aiJsonLimit<=0)return reply.code(403).send({error:{code:"AI_DISABLED",message:"Tính năng sửa JSON bằng AI hiện đang bị admin tắt."}});if(!bucket(activityRate,`ai-json:${user.id}`,Math.min(1000,aiJsonLimit)))return reply.code(429).send({error:{code:"AI_RATE_LIMITED",message:"Bạn đã yêu cầu sửa JSON quá nhiều. Vui lòng thử lại sau."}});
    const parsed=z.object({json:z.string().max(500000),error:z.string().max(5000).optional()}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_REQUEST",message:"JSON đầu vào không hợp lệ."}});
    try {
      const answer=await groqChat([{role:"system",content:"Bạn chuyên sửa JSON đề thi. Chỉ trả về một JSON object hợp lệ, KHÔNG markdown, KHÔNG ba dấu backtick, KHÔNG lời giải thích bên ngoài JSON. Giữ nguyên dữ liệu hợp lệ, chỉ sửa lỗi cú pháp/cấu trúc cần thiết. Kết quả phải parse được bằng JSON.parse()."},{role:"user",content:`JSON cần sửa:\n${parsed.data.json}\n\nLỗi validator:\n${parsed.data.error??"JSON.parse thất bại"}`}]);
      let clean=answer.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
      JSON.parse(clean);
      return {json:clean};
    } catch(e){req.log.warn({err:e},"AI JSON repair failed");return reply.code(503).send({error:{code:"AI_REPAIR_FAILED",message:"AI không trả về JSON hợp lệ. Hãy thử lại."}});}
  });
  app.get("/api/admin/ai/settings", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;return {limits:getAiLimits()};});
  app.patch("/api/admin/ai/settings", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({chatPerMinute:z.number().int().min(0).max(1000),explainPerMinute:z.number().int().min(0).max(1000),jsonPerMinute:z.number().int().min(0).max(1000)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_AI_LIMITS',message:'Giới hạn AI không hợp lệ.'}});setAiLimits(parsed.data,admin.id);await audit(req,admin,'ADMIN_UPDATE_AI_LIMITS','ai-settings','SUCCESS',parsed.data);return {ok:true,limits:getAiLimits()};});
  app.get("/api/admin/ai/keys", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;return {keys:listAiKeys()};});
  app.post("/api/admin/ai/keys", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({name:z.string().trim().min(1).max(100),key:z.string().trim().min(20).max(300),model:z.string().trim().max(100).optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_KEY",message:"API key không hợp lệ."}});const id=addAiKey(parsed.data.name,parsed.data.key,parsed.data.model);await event(req,{userId:admin.id,username:admin.username,action:"ADD_AI_KEY",severity:"INFO",result:"SUCCESS",metadata:{keyId:id,name:parsed.data.name}});return {ok:true,id};});
  app.patch("/api/admin/ai/keys/:id", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({enabled:z.boolean()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_KEY",message:"Dữ liệu không hợp lệ."}});if(!setAiKey(String((req.params as any).id),parsed.data.enabled))return reply.code(404).send({error:{code:"NOT_FOUND",message:"Không tìm thấy API key"}});return {ok:true};});
  app.delete("/api/admin/ai/keys/:id", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;if(!deleteAiKey(String((req.params as any).id)))return reply.code(404).send({error:{code:"NOT_FOUND",message:"Không tìm thấy API key"}});return {ok:true};});

  app.get("/api/health/database", async (_req, reply) => { try { if (productionRepositories?.db) productionRepositories.db.prepare('SELECT 1').get(); return {ok:true,database:'ready'}; } catch { return reply.code(503).send({ok:false,database:'unavailable'}); } });

  app.get("/api/health/storage", async (_req, reply) => {
    try {
      // Exercise the same repositories used by share/sync without exposing paths.
      await shareRepository.get("HEALTH2");
      await syncRepository.pull(0, "__health__", 1);
      return { ok: true, storage: "ready" };
    } catch (error) {
      _req.log.error({ err: error }, "storage health check failed");
      return reply.code(503).send({ ok: false, storage: "unavailable" });
    }
  });

  const publicUser = (u:Account) => ({ id:u.id, name:u.displayName, username:u.username, email:u.email, role:u.role, status:u.status, createdAt:u.createdAt, lastLoginAt:u.lastLoginAt, mustChangePassword:Boolean(u.mustChangePassword) });
  const cookieName = "exam_session";
  function cookieValue(req:any){ const raw=String(req.headers.cookie??""); const match=raw.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`)); return match?.[1]; }
  async function currentUser(req:any){ const token=cookieValue(req); if(!token) return undefined; const session=await authStore.getSession(hashSessionToken(token)); if(!session||session.expiresAt<Date.now()){if(session)await authStore.deleteSession(session.tokenHash);return undefined;} const user=await authStore.getUser(session.userId); if(!user||user.status==='DELETED'||user.status==='BANNED') return undefined; const at=Date.now(); if(user.status==='SUSPENDED'&&(!user.suspendedUntil||user.suspendedUntil>at)) return undefined; if(user.status==='LOCKED'&&(!user.lockedUntil||user.lockedUntil>at)) return undefined; if(user.status==='SUSPENDED'&&user.suspendedUntil&&user.suspendedUntil<=at) await authStore.updateUser(user.id,{status:'ACTIVE',suspendedUntil:undefined}); if(user.status==='LOCKED'&&user.lockedUntil&&user.lockedUntil<=at) await authStore.updateUser(user.id,{status:'ACTIVE',lockedUntil:undefined,failedAttempts:0}); const fresh=await authStore.getUser(user.id); if(!fresh||fresh.status!=='ACTIVE') return undefined; await authStore.touchSession(session.id,at); return fresh; }
  async function currentSession(req:any){const token=cookieValue(req);if(!token)return undefined;return authStore.getSession(hashSessionToken(token));}
  async function requireUser(req:any,reply:any,allowMustChange=false){ const user=await currentUser(req); if(!user){reply.code(401).send({error:{code:'UNAUTHENTICATED',message:'Vui lòng đăng nhập.'}});return undefined;} if(user.mustChangePassword&&!allowMustChange&&!String(req.url).startsWith('/api/account')){reply.code(403).send({error:{code:'PASSWORD_CHANGE_REQUIRED',message:'Bạn phải đổi mật khẩu tạm thời trước khi tiếp tục.'}});return undefined;} return user; }
  async function requireAdmin(req:any,reply:any){ const user=await requireUser(req,reply); if(!user)return; if(user.role!=='ADMIN'){reply.code(403).send({error:{code:'FORBIDDEN',message:'Bạn không có quyền truy cập.'}});return;} if(!bucket(adminRate,user.id,envNumber('ADMIN_RATE_LIMIT_PER_MINUTE',120,1,2000))){await event(req,{userId:user.id,username:user.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'});return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Admin API rate limit exceeded'}});} return user; }
  async function event(req:any,input:Omit<SecurityEvent,'id'|'createdAt'>){ try{await authStore.addSecurityEvent({...input,id:crypto.randomUUID(),createdAt:Date.now(),ip:req.ip,userAgent:String(req.headers['user-agent']??''),endpoint:req.url});}catch{} }
  async function audit(req:any,admin:Account,action:string,targetId?:string,result='SUCCESS',metadata?:Record<string,unknown>){try{await authStore.addAuditLog({id:crypto.randomUUID(),adminId:admin.id,action,targetId,ip:req.ip,userAgent:String(req.headers['user-agent']??''),result,metadata,createdAt:Date.now()});await event(req,{userId:admin.id,username:admin.username,action,severity:'INFO',result,metadata});}catch{}}
  async function featureEnabled(key:string){const flags=await authStore.getFeatureFlags();return flags.find(x=>x.key===key)?.enabled!==false;}
  const discordTimers=new Map<string,ReturnType<typeof setTimeout>>();
  async function raiseAlert(req:any,input:{type:string;severity:SecurityAlert['severity'];userId?:string;reason:string;requestCount?:number;metadata?:Record<string,unknown>}){
    const key=`${input.type}:${input.userId??req.ip}`;
    const alertUser=input.userId?await authStore.getUser(input.userId):undefined;
    const requestCount=Math.max(1,input.requestCount??1);
    const result=await authStore.upsertSecurityAlert({
      id:crypto.randomUUID(),type:input.type,severity:input.severity,status:'NEW',userId:input.userId,ip:req.ip,reason:input.reason,requestCount,
      metadata:{...(input.metadata??{}),username:alertUser?.username,userAgent:String(req.headers['user-agent']??'')},createdAt:Date.now(),updatedAt:Date.now()
    },60000);
    if(result.created) await event(req,{userId:input.userId,username:alertUser?.username,action:'SUSPICIOUS_ACTIVITY',severity:input.severity,result:'ALERT_CREATED',metadata:{type:input.type,reason:input.reason,requestCount}});
    if(input.severity==='HIGH'||input.severity==='CRITICAL') scheduleDiscordAlert(result.alert.id,key);
  }
  function scheduleDiscordAlert(alertId:string,key:string){const previous=discordTimers.get(key);if(previous)clearTimeout(previous);const timer=setTimeout(()=>{discordTimers.delete(key);void sendDiscordAlertById(alertId);},1500);discordTimers.set(key,timer);}
  async function sendDiscordAlertById(alertId:string){const alert=await authStore.getSecurityAlert(alertId);if(alert)await sendDiscordAlert(alert);}
  async function sendDiscordAlert(alert:SecurityAlert){
    const url=process.env.DISCORD_SECURITY_WEBHOOK_URL;
    if(!url)return;
    const username=typeof alert.metadata?.username==='string'&&alert.metadata.username.trim()?alert.metadata.username:'—';
    const userAgent=typeof alert.metadata?.userAgent==='string'?alert.metadata.userAgent:'—';
    const payload={content:`🚨 SECURITY ALERT\nAccount: ${username}\nUser ID: ${alert.userId??'—'}\nIP: ${alert.ip??'—'}\nUser-Agent: ${userAgent}\nTime: ${new Date(alert.updatedAt).toISOString()}\nSeverity: ${alert.severity}\nType: ${alert.type}\nReason: ${alert.reason}\nRequest count: ${alert.requestCount}`};
    for(let attempt=0;attempt<3;attempt++){try{
      const c=new AbortController();const t=setTimeout(()=>c.abort(),1500);
      try {
        const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:c.signal});
        if(response.ok)return;
        throw new Error(`DISCORD_HTTP_${response.status}`);
      } finally { clearTimeout(t); }
    }catch(error){
      if(attempt===2){console.warn(JSON.stringify({event:'discord_security_webhook_failed',alertId:alert.id,attempts:3,error:String((error as any)?.message??error)}));return;}
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }}
  }
  function bucket(limiter:RateLimiter,key:string,limit:number){return limiter.consume(key,limit).allowed;}
  async function seedAdmin(){const login=String(process.env.ADMIN_INITIAL_USERNAME??'admin').trim();const password=process.env.ADMIN_INITIAL_PASSWORD;if(!password)return;const existing=await authStore.getUserByLogin(login);if(!existing){await authStore.createUser({id:crypto.randomUUID(),username:login,displayName:login,passwordHash:hashPassword(password),role:'ADMIN'});}}
  function vietnamDayStart(date = new Date()){ const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); const y=parts.find(p=>p.type==='year')!.value; const m=parts.find(p=>p.type==='month')!.value; const d=parts.find(p=>p.type==='day')!.value; return new Date(`${y}-${m}-${d}T00:00:00+07:00`).getTime(); }
  async function seedFeatureFlags(){for(const key of ['REGISTRATION','TOURNAMENT','ENGLISH_PRACTICE','SHARE_CODE','OFFICIAL_EXAM','SYNC']){const flags=await authStore.getFeatureFlags();if(!flags.some(f=>f.key===key))await authStore.setFeatureFlag(key,true);}}
  void seedAdmin();
  void seedFeatureFlags();

  app.get('/api/auth/me', async (req) => { const user=await currentUser(req); return { authenticated:Boolean(user), user:user?publicUser(user):null }; });
  app.post('/api/auth/register', async (req,reply)=>{
    if(!(await featureEnabled('REGISTRATION'))) return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Đăng ký tài khoản hiện đang tắt.'}});
    if(!bucket(registerRate,req.ip,envNumber('REGISTER_RATE_LIMIT_PER_MINUTE',5,1,100))) { await event(req,{action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); await raiseAlert(req,{type:'MASS_REGISTER_DETECTED',severity:'HIGH',reason:'Registration rate limit exceeded'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần đăng ký, vui lòng thử lại sau.'}}); }
    const parsed=z.object({name:z.string().trim().min(2).max(80),username:z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9._-]+$/),password:z.string().min(10).max(200),confirmPassword:z.string().max(200)}).strict().safeParse(req.body);
    if(!parsed.success||parsed.data.password!==parsed.data.confirmPassword)return reply.code(400).send({error:{code:'INVALID_REGISTER',message:'Tên, username hoặc mật khẩu không hợp lệ.'}});
    if(await authStore.getUserByLogin(parsed.data.username))return reply.code(409).send({error:{code:'ACCOUNT_EXISTS',message:'Tên đăng nhập đã được sử dụng.'}});
    const user=await authStore.createUser({id:crypto.randomUUID(),username:parsed.data.username,displayName:parsed.data.name,passwordHash:hashPassword(parsed.data.password)}); await event(req,{userId:user.id,username:user.username,action:'REGISTER',severity:'INFO',result:'SUCCESS'}); return reply.code(201).send({user:publicUser(user)});
  });
  app.post('/api/auth/login', async (req,reply)=>{
    if(!bucket(loginRate,req.ip,envNumber('LOGIN_RATE_LIMIT_PER_MINUTE',10,1,100))) { await event(req,{action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); await raiseAlert(req,{type:'BRUTE_FORCE_DETECTED',severity:'HIGH',reason:'Login rate limit exceeded'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Thông tin đăng nhập không chính xác.'}}); }
    const parsed=z.object({username:z.string().trim().min(1).max(200),password:z.string().min(1).max(200)}).strict().safeParse(req.body); if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_LOGIN',message:'Thông tin đăng nhập không chính xác.'}});
    const user=await authStore.getUserByLogin(parsed.data.username); const valid=user?verifyPassword(parsed.data.password,await authStore.getPasswordHash(user.id)??''):false; const loginNow=Date.now(); const expiredRestriction=Boolean(user&&(user.status==='LOCKED'&&user.lockedUntil&&user.lockedUntil<=loginNow || user.status==='SUSPENDED'&&user.suspendedUntil&&user.suspendedUntil<=loginNow));
    if(!user||user.status==='BANNED'||user.status==='DELETED'||(user.status==='LOCKED'&&!expiredRestriction)||(user.status==='SUSPENDED'&&!expiredRestriction)||!valid){ if(user){const fails=user.failedAttempts+1; const lock=fails>=5?Date.now()+15*60_000:undefined; await authStore.updateUser(user.id,{failedAttempts:fails,lockedUntil:lock,status:lock?'LOCKED':'ACTIVE'}); if(lock){await event(req,{userId:user.id,username:user.username,action:'ACCOUNT_LOCKED',severity:'WARNING',result:'LOCKED'});await raiseAlert(req,{type:'BRUTE_FORCE_DETECTED',severity:'HIGH',userId:user.id,reason:'Repeated failed login attempts',requestCount:fails});}} await event(req,{userId:user?.id,username:user?.username,action:'LOGIN_FAILED',severity:'WARNING',result:'FAILED'}); return reply.code(401).send({error:{code:'INVALID_CREDENTIALS',message:'Thông tin đăng nhập không chính xác.'}}); }
    const at=Date.now(); await authStore.updateUser(user.id,{failedAttempts:0,lockedUntil:undefined,suspendedUntil:undefined,lastLoginAt:at,status:'ACTIVE'}); const created=newSession(user.id,30,{userAgent:String(req.headers['user-agent']??''),ip:req.ip}); await authStore.createSession(created.session); reply.header('Set-Cookie',`${cookieName}=${created.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`); await event(req,{userId:user.id,username:user.username,action:user.role==='ADMIN'?'ADMIN_LOGIN':'LOGIN_SUCCESS',severity:'INFO',result:'SUCCESS'}); return {user:publicUser({...user,lastLoginAt:at})};
  });
  app.post('/api/auth/logout', async(req,reply)=>{const token=cookieValue(req);if(token){const s=await authStore.getSession(hashSessionToken(token));if(s){await authStore.deleteSession(s.tokenHash);const logoutUser=await authStore.getUser(s.userId);await event(req,{userId:s.userId,username:logoutUser?.username,action:logoutUser?.role==='ADMIN'?'ADMIN_LOGOUT':'LOGOUT',severity:'INFO',result:'SUCCESS'});}}reply.header('Set-Cookie',`${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);return {ok:true};});
  app.post('/api/auth/change-password', async(req,reply)=>{const user=await requireUser(req,reply,true);if(!user)return;const parsed=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(10).max(200),confirmPassword:z.string().max(200)}).strict().safeParse(req.body);if(!parsed.success||parsed.data.newPassword!==parsed.data.confirmPassword)return reply.code(400).send({error:{code:'INVALID_PASSWORD_CHANGE',message:'Mật khẩu mới không hợp lệ.'}});if(!verifyPassword(parsed.data.currentPassword,await authStore.getPasswordHash(user.id)??''))return reply.code(400).send({error:{code:'INVALID_CURRENT_PASSWORD',message:'Mật khẩu hiện tại không chính xác.'}});await authStore.setPassword(user.id,hashPassword(parsed.data.newPassword),false);const session=await currentSession(req);await authStore.revokeSessions(user.id,session?.id);await event(req,{userId:user.id,username:user.username,action:'PASSWORD_CHANGED',severity:'INFO',result:'SUCCESS'});return {ok:true};});
  app.get('/api/account', async(req,reply)=>{const user=await requireUser(req,reply,true);if(!user)return;return {user:publicUser(user),stats:await authStore.userActivityStats(user.id)}});
  app.get('/api/account/activity', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid pagination'}});return {events:await authStore.listSecurityEvents((q.data.page-1)*q.data.limit,q.data.limit,{userId:user.id}),total:await authStore.countSecurityEvents({userId:user.id})};});
  app.get('/api/account/sessions', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const session=await currentSession(req);const rows=await authStore.listSessions(user.id);return {sessions:rows.map(s=>({id:s.id,createdAt:s.createdAt,lastSeenAt:s.lastSeenAt,expiresAt:s.expiresAt,userAgent:s.userAgent,ip:s.id===session?.id?s.ip:undefined,current:s.id===session?.id}))};});
  app.post('/api/account/sessions/revoke-others', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const session=await currentSession(req);await authStore.revokeSessions(user.id,session?.id);await event(req,{userId:user.id,action:'FORCE_LOGOUT',severity:'INFO',result:'SUCCESS'});return {ok:true};});
  app.post('/api/account/delete', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const parsed=z.object({password:z.string().min(1),confirmation:z.literal('DELETE')}).strict().safeParse(req.body);if(!parsed.success||!verifyPassword(parsed.data.password,await authStore.getPasswordHash(user.id)??''))return reply.code(400).send({error:{code:'INVALID_DELETE_CONFIRMATION',message:'Xác nhận xóa tài khoản không hợp lệ.'}});await serverRepository.purgeUser(user.id);await shareRepository.purgeUser(user.id);await authStore.updateUser(user.id,{status:'DELETED',deletedAt:Date.now()});await authStore.revokeSessions(user.id);await event(req,{userId:user.id,username:user.username,action:'ACCOUNT_DELETED',severity:'HIGH',result:'SUCCESS'});reply.header('Set-Cookie',`${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);return {ok:true};});
  app.get('/api/features', async()=>({flags:await authStore.getFeatureFlags()}));
  app.get('/api/official-exams', async(req,reply)=>{if(!(await featureEnabled('OFFICIAL_EXAM')))return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Official Exam hiện đang tắt.'}});const includeUnpublished=String((req.query as any)?.includeUnpublished??'false')==='true';if(includeUnpublished){const admin=await requireAdmin(req,reply);if(!admin)return;}return {exams:(await authStore.listOfficialExams(includeUnpublished)).map(x=>({...x,packageBase64:undefined}))};});
  app.get('/api/official-exams/:id', async(req,reply)=>{if(!(await featureEnabled('OFFICIAL_EXAM')))return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Official Exam hiện đang tắt.'}});const id=String((req.params as any).id);const row=await authStore.getOfficialExam(id);if(!row||row.deletedAt)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});return {...row,packageBase64:undefined};});
  app.get('/api/official-exams/:id/package', async(req,reply)=>{
    if(!(await featureEnabled('OFFICIAL_EXAM')))return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Official Exam hiện đang tắt.'}});
    if(!bucket(officialDownloadRate,req.ip,envNumber('OFFICIAL_DOWNLOAD_RATE_LIMIT_PER_MINUTE',30,1,500))){const u=await currentUser(req);await event(req,{userId:u?.id,username:u?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'});return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lượt tải Official Exam.'}});}
    const row=await authStore.getOfficialExam(String((req.params as any).id));
    if(!row||row.deletedAt)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});
    const user=await currentUser(req);await event(req,{userId:user?.id,username:user?.username,action:'DOWNLOAD_OFFICIAL_EXAM',severity:'INFO',result:'SUCCESS',metadata:{examId:row.id,version:row.version}});
    return {id:row.id,title:row.title,version:row.version,contentHash:row.contentHash,packageBase64:row.packageBase64};
  });
  app.post('/api/activity', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;if(!bucket(activityRate,user.id,envNumber('ACTIVITY_RATE_LIMIT_PER_MINUTE',60,1,1000))){await event(req,{userId:user.id,username:user.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'});return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều activity request.'}});}const parsed=z.object({kind:z.enum(['practice','tournament','english']),profileId:z.string().max(200).optional(),examId:z.string().max(300).optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_ACTIVITY',message:'Invalid activity'}});const flag=parsed.data.kind==='tournament'?'TOURNAMENT':parsed.data.kind==='english'?'ENGLISH_PRACTICE':undefined;if(flag&&!(await featureEnabled(flag)))return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Tính năng hiện đang tắt.'}});await authStore.addActivity({id:crypto.randomUUID(),userId:user.id,...parsed.data,createdAt:Date.now()});return {ok:true};});

  app.get('/api/admin/stats', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const range=String((req.query as any)?.range??'7d');const todayStart=vietnamDayStart();const yesterdayStart=todayStart-86400000;const today=await authStore.stats(todayStart,Date.now());const yesterday=await authStore.stats(yesterdayStart,todayStart);const seven=await authStore.stats(todayStart-7*86400000,Date.now());const thirty=await authStore.stats(todayStart-30*86400000,Date.now());return {range,stats:range==='30d'?thirty:range==='1d'?today:seven,periods:{today,yesterday,last7Days:seven,last30Days:thirty},timezone:'Asia/Ho_Chi_Minh'};});
  app.get('/api/admin/users', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),search:z.string().max(200).optional(),status:z.enum(['ACTIVE','SUSPENDED','BANNED','DELETED','LOCKED','LIMITED']).optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});return {users:(await authStore.listUsers((q.data.page-1)*q.data.limit,q.data.limit,q.data.search,q.data.status)).map(publicUser),total:await authStore.countUsersFiltered(q.data.search,q.data.status)};});
  app.get('/api/admin/users/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const target=await authStore.getUser(id);if(!target)return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});return {user:publicUser(target),stats:await authStore.userActivityStats(id),sessions:(await authStore.listSessions(id)).map(s=>({id:s.id,createdAt:s.createdAt,lastSeenAt:s.lastSeenAt,expiresAt:s.expiresAt,userAgent:s.userAgent,ip:s.ip}))};});
  app.patch('/api/admin/users/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const target=await authStore.getUser(id);if(!target||target.status==='DELETED')return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});const parsed=z.object({displayName:z.string().trim().min(2).max(80).optional(),email:z.union([z.string().trim().email().max(200),z.literal('')]).optional(),role:z.enum(['USER','ADMIN']).optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_USER_UPDATE',message:'Dữ liệu tài khoản không hợp lệ.'}});if(id===admin.id&&parsed.data.role&&parsed.data.role!=='ADMIN')return reply.code(400).send({error:{code:'LAST_ADMIN_PROTECTION',message:'Không thể tự hạ quyền admin hiện tại.'}});await authStore.updateUser(id,{displayName:parsed.data.displayName,email:parsed.data.email||undefined,role:parsed.data.role});await audit(req,admin,'ADMIN_UPDATE_USER',id,'SUCCESS',{fields:Object.keys(parsed.data)});return {ok:true,user:publicUser((await authStore.getUser(id))!)};});
  app.post('/api/admin/users/:id/restriction', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const parsed=z.object({status:z.enum(['ACTIVE','SUSPENDED','BANNED','LOCKED','LIMITED']),reason:z.string().max(300).optional(),suspendedUntil:z.number().int().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_RESTRICTION',message:'Invalid restriction'}});const target=await authStore.getUser(id);if(!target)return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});if(target.role==='ADMIN'&&id===admin.id&&parsed.data.status!=='ACTIVE')return reply.code(400).send({error:{code:'LAST_ADMIN_PROTECTION',message:'Không thể tự khóa tài khoản admin hiện tại.'}});await authStore.updateUser(id,{status:parsed.data.status,suspendedUntil:parsed.data.status==='SUSPENDED'?(parsed.data.suspendedUntil??Date.now()+24*86400000):undefined});if(parsed.data.status!=='ACTIVE')await authStore.revokeSessions(id);if(parsed.data.status==='SUSPENDED')await event(req,{userId:id,action:'ACCOUNT_SUSPENDED',severity:'HIGH',result:'SUCCESS'});if(parsed.data.status==='BANNED')await event(req,{userId:id,action:'ACCOUNT_BANNED',severity:'CRITICAL',result:'SUCCESS'});if(parsed.data.status==='LOCKED')await event(req,{userId:id,action:'ACCOUNT_LOCKED',severity:'HIGH',result:'SUCCESS'});await audit(req,admin,parsed.data.status==='ACTIVE'?'ADMIN_UNLOCK_USER':'ADMIN_LOCK_USER',id,'SUCCESS',{status:parsed.data.status,reason:parsed.data.reason});return {ok:true};});
  app.post('/api/admin/users/:id/reset-password', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const parsed=z.object({temporaryPassword:z.string().min(10).max(200)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_PASSWORD',message:'Temporary password không hợp lệ.'}});const target=await authStore.getUser(id);if(!target||target.status==='DELETED')return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});await authStore.setPassword(id,hashPassword(parsed.data.temporaryPassword),true);await authStore.revokeSessions(id);await event(req,{userId:id,action:'PASSWORD_RESET',severity:'HIGH',result:'SUCCESS'});await audit(req,admin,'ADMIN_RESET_PASSWORD',id);return {ok:true};});
  app.post('/api/admin/users/:id/force-logout', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);if(!(await authStore.getUser(id)))return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});await authStore.revokeSessions(id);await audit(req,admin,'ADMIN_FORCE_LOGOUT',id);return {ok:true};});
  app.delete('/api/admin/users/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const target=await authStore.getUser(id);if(!target)return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});if(target.role==='ADMIN')return reply.code(400).send({error:{code:'ADMIN_PROTECTED',message:'Không thể xóa tài khoản ADMIN.'}});await serverRepository.purgeUser(id);await shareRepository.purgeUser(id);await authStore.updateUser(id,{status:'DELETED',deletedAt:Date.now()});await authStore.revokeSessions(id);await audit(req,admin,'ADMIN_DELETE_USER',id,'SUCCESS');return {ok:true};});
  app.get('/api/admin/security', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),search:z.string().max(200).optional(),severity:z.enum(['INFO','WARNING','HIGH','CRITICAL']).optional(),action:z.string().max(100).optional(),since:z.coerce.number().int().optional(),until:z.coerce.number().int().optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});const filters={search:q.data.search,severity:q.data.severity,action:q.data.action,since:q.data.since,until:q.data.until};return {events:await authStore.listSecurityEvents((q.data.page-1)*q.data.limit,q.data.limit,filters),total:await authStore.countSecurityEvents(filters)};});
  app.get('/api/admin/alerts', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),status:z.enum(['NEW','REVIEWED','RESOLVED']).optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});return {alerts:await authStore.listSecurityAlerts((q.data.page-1)*q.data.limit,q.data.limit,q.data.status)};});
  app.post('/api/admin/alerts/:id/status', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const parsed=z.object({status:z.enum(['NEW','REVIEWED','RESOLVED'])}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_STATUS',message:'Invalid status'}});await authStore.updateSecurityAlert(String((req.params as any).id),parsed.data.status);await audit(req,user,'ADMIN_UPDATE_SECURITY_ALERT',String((req.params as any).id));return {ok:true};});
  app.get('/api/admin/audit', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});return {logs:await authStore.listAuditLogs((q.data.page-1)*q.data.limit,q.data.limit)};});
  app.get('/api/admin/features', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;return {flags:await authStore.getFeatureFlags()};});
  app.patch('/api/admin/features/:key', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const key=String((req.params as any).key);const parsed=z.object({enabled:z.boolean()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_FLAG',message:'Invalid feature flag'}});await authStore.setFeatureFlag(key,parsed.data.enabled,user.id);await audit(req,user,'ADMIN_UPDATE_FEATURE_FLAG',key,'SUCCESS',{enabled:parsed.data.enabled});return {ok:true};});
  app.get('/api/admin/system', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const started=Date.now();let database:'OK'|'ERROR'='OK';try{if(productionRepositories?.db)productionRepositories.db.prepare('SELECT 1').get()}catch{database='ERROR'}let storage:'OK'|'ERROR'='OK';try{await shareRepository.get('HEALTH2');await syncRepository.pull(0,'__health__',1)}catch{storage='ERROR'}return {api:{status:'ONLINE',uptimeSeconds:Math.round(process.uptime())},database:{status:database},storage:{status:storage},sync:{status:storage},latencyMs:Date.now()-started};});
  app.get('/api/admin/search', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({q:z.string().trim().min(1).max(200)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid search'}});const users=await authStore.listUsers(0,20,q.data.q);const official=(await authStore.listOfficialExams(true)).filter(e=>`${e.id} ${e.title}`.toLowerCase().includes(q.data.q.toLowerCase())).slice(0,20);const localExams=await serverRepository.searchExamIds(q.data.q,20);const exams=[...official.map(e=>({id:e.id,title:e.title,version:e.version,source:'official'})),...localExams.map(e=>({id:e.entityId,title:typeof (e.payload as any)?.title==='string'?(e.payload as any).title:'Local exam',version:Number((e.payload as any)?.version??0),source:'user'}))].slice(0,20);const events=await authStore.listSecurityEvents(0,20,{search:q.data.q});const shareCode=/^[A-HJ-NP-Z2-9]{6,10}$/i.test(q.data.q)?q.data.q.toUpperCase():'';const share=shareCode?await shareRepository.get(shareCode):undefined;return {users:users.map(publicUser),exams,shares:share?[{shareId:share.shareId,code:share.code,packageType:share.packageType,createdAt:share.createdAt,expiresAt:share.expiresAt}]:[],events};});
  app.post('/api/admin/official-exams', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({id:z.string().min(1).max(300).optional(),title:z.string().min(1).max(300).optional(),subject:z.string().min(1).max(100).optional(),grade:z.number().int().optional(),version:z.number().int().min(1).optional(),contentHash:z.string().regex(/^sha256:[a-f0-9]{64}$/i).optional(),packageBase64:z.string().min(1).optional(),questionCount:z.number().int().nonnegative().optional(),metadata:z.record(z.string(),z.unknown()).optional(),content:z.unknown().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_OFFICIAL_EXAM',message:'Invalid official exam'}});try{let bytes:Uint8Array;if(parsed.data.content){const content=ExamContentSchema.parse(parsed.data.content);bytes=await exportExam({content});}else if(parsed.data.packageBase64){bytes=Buffer.from(parsed.data.packageBase64,'base64');}else return reply.code(400).send({error:{code:'INVALID_OFFICIAL_EXAM',message:'Cần packageBase64 hoặc content JSON'}});const imported=await importExam(new Uint8Array(bytes));if(parsed.data.contentHash&&imported.contentHash.toLowerCase()!==parsed.data.contentHash.toLowerCase())return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Package hash không khớp'}});if(parsed.data.version!==undefined&&imported.content.version!==parsed.data.version)return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Package version không khớp'}});const existing=await authStore.getOfficialExam(imported.content.id);if(existing&&imported.content.version<=existing.version)return reply.code(409).send({error:{code:'VERSION_CONFLICT',message:'Version mới phải lớn hơn version hiện tại.'}});const row={id:imported.content.id,title:imported.content.title,subject:imported.content.subject,grade:imported.content.grade,version:imported.content.version,contentHash:imported.contentHash,packageBase64:Buffer.from(bytes).toString('base64'),questionCount:imported.content.questions.length,metadata:parsed.data.metadata,createdAt:existing?.createdAt??Date.now(),updatedAt:Date.now(),publishedAt:Date.now(),deletedAt:undefined};const stored=await authStore.upsertOfficialExam(row);if(!stored)return reply.code(409).send({error:{code:'VERSION_CONFLICT',message:'Version mới phải lớn hơn version hiện tại.'}});await audit(req,admin,existing?'ADMIN_UPDATE_OFFICIAL_EXAM':'ADMIN_CREATE_OFFICIAL_EXAM',row.id);return {ok:true,exam:{...row,packageBase64:undefined}};}catch{return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Official Exam package không hợp lệ'}})}});
  app.patch('/api/admin/official-exams/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const current=await authStore.getOfficialExam(id);if(!current)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});const parsed=z.object({title:z.string().min(1).max(300).optional(),subject:z.string().min(1).max(100).optional(),grade:z.number().int().optional(),metadata:z.record(z.string(),z.unknown()).optional(),published:z.boolean().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_UPDATE',message:'Invalid update'}});await authStore.updateOfficialExam({...current,...parsed.data,title:parsed.data.title??current.title,subject:parsed.data.subject??current.subject,updatedAt:Date.now(),publishedAt:parsed.data.published===false?undefined:current.publishedAt??Date.now(),deletedAt:parsed.data.published===false?Date.now():undefined});await audit(req,admin,parsed.data.published===false?'ADMIN_UNPUBLISH_OFFICIAL_EXAM':'ADMIN_UPDATE_OFFICIAL_EXAM',id);return {ok:true};});
  app.delete('/api/admin/official-exams/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const current=await authStore.getOfficialExam(id);if(!current)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});await authStore.unpublishOfficialExam(id);await audit(req,admin,'ADMIN_DELETE_OFFICIAL_EXAM',id);return {ok:true};});

  app.post("/api/sync/push", async (req, reply) => {
    const syncUser = await currentUser(req);
    const syncKey = syncUser?.id ?? req.ip;
    if (!bucket(activityRate, `sync:${syncKey}`, envNumber('SYNC_RATE_LIMIT_PER_MINUTE',30,1,500))) { await event(req,{userId:syncUser?.id,username:syncUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều sync request.'}}); }
    if (!(await featureEnabled('SYNC'))) return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Sync hiện đang tắt.'}});
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid sync request" } });
    const createExamCount=parsed.data.mutations.filter(m=>m.entityType==='exam'&&m.operation==='CREATE').length;
    if(createExamCount>0){const key=`exam:${syncUser?.id??req.ip}`;if(!bucket(activityRate,key,envNumber('CREATE_EXAM_RATE_LIMIT_PER_MINUTE',10,1,200))){await event(req,{userId:syncUser?.id,username:syncUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED',metadata:{createExamCount}});await raiseAlert(req,{type:'MASS_EXAM_CREATION',severity:'HIGH',userId:syncUser?.id,reason:'Exam creation rate limit exceeded',requestCount:createExamCount});return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần tạo đề.'}});}}
    if (!bucket(activityRate, `sync:${parsed.data.deviceId}`, envNumber('SYNC_RATE_LIMIT_PER_MINUTE', 30, 1, 500))) { await event(req,{userId:syncUser?.id,username:syncUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Sync đang được giới hạn tốc độ.' } }); }
    const acknowledgements: string[] = [];
    const conflicts: unknown[] = [];
    let serverCursor = 0;
    for (const m of parsed.data.mutations) {
      if (m.operation !== "DELETE" && (!m.payload || typeof m.payload !== "object" || Array.isArray(m.payload))) {
        return reply.code(400).send({ error: { code: "INVALID_PAYLOAD", message: "Mutation payload must be an object" } });
      }
      if (m.deviceId !== parsed.data.deviceId) return reply.code(400).send({ error: { code: "DEVICE_MISMATCH", message: "Mutation device does not match request device" } });
      const effectiveProfileId = syncUser ? `${syncUser.id}:${m.profileId}` : m.profileId;
      const existingEntity = await serverRepository.get(effectiveProfileId, m.entityType, m.entityId);
      if (m.entityType === 'exam' && existingEntity?.payload && typeof existingEntity.payload === 'object' && (existingEntity.payload as any).source === 'official') return reply.code(403).send({ error: { code: 'OFFICIAL_EXAM_PROTECTED', message: 'Official Exam không thể bị sửa hoặc xóa bởi user.' } });
      if (m.entityType === 'exam' && m.payload && typeof m.payload === 'object' && (m.payload as any).source === 'official') return reply.code(403).send({ error: { code: 'OFFICIAL_EXAM_PROTECTED', message: 'Official Exam chỉ được quản lý bởi admin.' } });
      await syncRepository.transaction(async () => {
        if (!(await syncRepository.rememberMutation(m.mutationId, m.deviceId))) { acknowledgements.push(m.mutationId); return; }
        const current = await serverRepository.get(effectiveProfileId, m.entityType, m.entityId);
        if (current && m.baseRevision !== current.revision) {
          const winner = compare({ updatedAt: m.updatedAt, deviceId: m.deviceId }, current);
          if (winner === "current") {
            conflicts.push({
              mutationId: m.mutationId, entityType: m.entityType, entityId: m.entityId,
              current: {
                cursor: 0, entityType: m.entityType, entityId: m.entityId, profileId: m.profileId,
                revision: current.revision, operation: current.deletedAt ? "DELETE" : "UPDATE",
                payload: current.payload, updatedAt: current.updatedAt, deviceId: current.deviceId, deletedAt: current.deletedAt
              }
            });
            return;
          }
        }
        const revision = (current?.revision ?? 0) + 1;
        const now = Math.max(m.updatedAt, Date.now());
        const deletedAt = m.operation === "DELETE" ? now : undefined;
        const entity: ServerEntity = {
          profileId: effectiveProfileId, entityType: m.entityType, entityId: m.entityId, revision,
          payload: m.operation === "DELETE" ? undefined : m.payload,
          updatedAt: now, deviceId: m.deviceId, deletedAt
        };
        await serverRepository.put(key(m.profileId, m.entityType, m.entityId), entity);
        serverCursor = await syncRepository.append({ ...entity, operation: m.operation });
        if(m.entityType==='exam' && syncUser && (m.operation==='CREATE'||m.operation==='DELETE')) await event(req,{userId:syncUser.id,username:syncUser.username,action:m.operation==='CREATE'?'CREATE_EXAM':'DELETE_EXAM',severity:'INFO',result:'SUCCESS',metadata:{examId:m.entityId}});
        if(m.entityType==='exam' && m.operation==='CREATE' && syncUser) { const recent=await authStore.countSecurityEventsSince(Date.now()-60000,'CREATE_EXAM'); if(recent>=10) await raiseAlert(req,{type:'MASS_EXAM_CREATION',severity:'HIGH',userId:syncUser.id,reason:'High exam creation volume',requestCount:recent}); }
        acknowledgements.push(m.mutationId);
      });
    }
    return { acknowledgements, conflicts, serverCursor };
  });

  app.get("/api/sync/pull", async (req, reply) => {
    const parsed = z.object({
      cursor: z.coerce.number().int().nonnegative().default(0),
      profileId: z.string().min(1).max(200)
    }).strict().safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "Invalid cursor" } });
    const syncUser = await currentUser(req);
    const effectiveProfileId = syncUser ? `${syncUser.id}:${parsed.data.profileId}` : parsed.data.profileId;
    const result = await syncRepository.pull(parsed.data.cursor, effectiveProfileId, 500);
    if (syncUser) result.changes = result.changes.map(c => ({ ...c, profileId: parsed.data.profileId }));
    return result;
  });

  app.post("/api/share", async (req, reply) => {
    if (!(await featureEnabled('SHARE_CODE'))) return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Share code hiện đang tắt.'}});
    const shareUser = await currentUser(req);
    const createKeys = [`ip:${req.ip}`, `account:${shareUser?.id ?? 'anonymous'}`];
    if (!createKeys.every(k=>bucket(shareCreateRate, k, envNumber('SHARE_CREATE_RATE_LIMIT_PER_MINUTE', 10, 1, 1000)))) { const u=await currentUser(req); await event(req,{userId:u?.id,username:u?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); await raiseAlert(req,{type:'MASS_SHARE_DETECTED',severity:'HIGH',userId:u?.id,reason:'Share creation rate limit exceeded'}); return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Quá nhiều lần tạo share.' } }); }
    const parsed = shareSchema.safeParse(req.body);
    if (!parsed.success || !isValidBase64(parsed.data?.packageBase64 ?? "")) {
      return reply.code(400).send({ error: { code: "INVALID_SHARE", message: "Invalid share payload" } });
    }
    const bytes = Buffer.from(parsed.data.packageBase64, "base64");
    if (bytes.length > 25 * 1024 * 1024) return reply.code(413).send({ error: { code: "TOO_LARGE", message: "Package exceeds 25 MB" } });
    if (parsed.data.packageType === "exam") {
      let imported;
      try { imported = await importExam(new Uint8Array(bytes)); }
      catch { return reply.code(400).send({ error: { code: "INVALID_PACKAGE", message: "Invalid .exam package" } }); }
      if (imported.contentHash.toLowerCase() !== parsed.data.contentHash.toLowerCase() || imported.formatVersion !== parsed.data.formatVersion) {
        return reply.code(400).send({ error: { code: "HASH_MISMATCH", message: "Package hash/version mismatch" } });
      }
    } else {
      const actualHash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      if (actualHash.toLowerCase() !== parsed.data.contentHash.toLowerCase()) return reply.code(400).send({ error: { code: "HASH_MISMATCH", message: "Package hash/version mismatch" } });
      try {
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (payload?.type !== "vocabularySet" || !payload?.set?.name || !Array.isArray(payload.words)) throw new Error();
      } catch { return reply.code(400).send({ error: { code: "INVALID_PACKAGE", message: "Invalid vocabulary share package" } }); }
    }
    const rowBase = {
      shareId: crypto.randomUUID(), packageBase64: parsed.data.packageBase64,
      contentHash: parsed.data.contentHash, formatVersion: parsed.data.formatVersion, packageType: parsed.data.packageType,
      createdAt: Date.now(), expiresAt: expiry(parsed.data.expiresIn), ownerDeviceId: shareUser ? undefined : parsed.data.ownerDeviceId, ownerUserId: shareUser?.id
    };
    let row: typeof rowBase & { code: string; storageKey: string } | undefined;
    for (let attempt = 0; attempt < 12; attempt++) {
      const shareCode = createShareCode();
      try {
        if (await shareRepository.get(shareCode)) continue;
      } catch (error) {
        req.log.error({ err: error }, "share lookup failed during code allocation");
        return reply.code(503).send({ error: { code: "SHARE_STORAGE_UNAVAILABLE", message: "Không thể truy cập kho chia sẻ lúc này." } });
      }
      const extension = parsed.data.packageType === "vocabularySet" ? "json" : "exam";
      const candidate = { ...rowBase, code: shareCode, storageKey: `shared-exams/${shareCode}.${extension}` };
      try {
        await shareRepository.create(candidate);
        row = candidate;
        break;
      } catch (error) {
        const code = String((error as any)?.code ?? "");
        const message = String((error as any)?.message ?? "");
        const isCollision = code === "EEXIST" || code.includes("CONSTRAINT") || message.toLowerCase().includes("unique");
        if (isCollision) continue;
        req.log.error({ err: error, shareCode, packageType: parsed.data.packageType }, "share creation failed");
        return reply.code(503).send({ error: { code: "SHARE_STORAGE_UNAVAILABLE", message: "Không thể lưu nội dung chia sẻ lúc này." } });
      }
    }
    if (!row) return reply.code(503).send({ error: { code: "CODE_EXHAUSTED", message: "Không thể tạo mã chia sẻ, vui lòng thử lại." } });
    await event(req,{userId:shareUser?.id,username:shareUser?.username,action:'CREATE_SHARE',severity:'INFO',result:'SUCCESS',metadata:{shareId:row.shareId,packageType:row.packageType}});
    return { shareId: row.shareId, shareCode: row.code, contentHash: row.contentHash, formatVersion: row.formatVersion, packageType: row.packageType ?? parsed.data.packageType, storageKey: row.storageKey, createdAt: row.createdAt, expiresAt: row.expiresAt, shareUrl: `/share/${row.code}` };
  });

  app.get("/api/share/:code", async (req, reply) => {
    const ip = req.ip;
    if (!shareRate.consume(ip, shareLimit).allowed) { const u=await currentUser(req); await event(req,{userId:u?.id,username:u?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many share lookups" } }); }
    const code = String((req.params as { code: string }).code).toUpperCase();
    if (!shareCodePattern.test(code)) return reply.code(400).send({ error: { code: "INVALID_CODE", message: "Invalid share code" } });
    const row = await shareRepository.get(code);
    if (!row || row.deleted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Share not found" } });
    if (row.expiresAt && row.expiresAt < Date.now()) return reply.code(410).send({ error: { code: "EXPIRED", message: "Share expired" } });
    let packageType = row.packageType ?? "exam";
    if (packageType === "exam") {
      try { await importExam(new Uint8Array(Buffer.from(row.packageBase64, "base64"))); }
      catch {
        try { const payload = JSON.parse(Buffer.from(row.packageBase64, "base64").toString("utf8")); if (payload?.type === "vocabularySet") packageType = "vocabularySet"; } catch {}
      }
    }
    return { shareId: row.shareId, shareCode: row.code, packageBase64: row.packageBase64, contentHash: row.contentHash, formatVersion: row.formatVersion, packageType, storageKey: row.storageKey, createdAt: row.createdAt, expiresAt: row.expiresAt, shareUrl: `/share/${row.code}` };
  });

  app.delete("/api/share/:code", async (req, reply) => {
    const code = String((req.params as { code: string }).code).toUpperCase();
    if (!shareCodePattern.test(code)) return reply.code(400).send({ error: { code: "INVALID_CODE", message: "Invalid share code" } });
    const row = await shareRepository.get(code);
    if (!row || row.deleted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Share not found" } });
    const user = await currentUser(req);
    if (row.ownerUserId) { if (!user || user.id !== row.ownerUserId) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Share owner required" } }); }
    else { const deviceId = String(req.headers["x-device-id"] ?? ""); if (row.ownerDeviceId && deviceId !== row.ownerDeviceId) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Share owner required" } }); }
    await shareRepository.delete(code);
    return { ok: true };
  });

  return app;
}

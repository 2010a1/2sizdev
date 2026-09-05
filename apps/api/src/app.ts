import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import cors from "@fastify/cors";
import crypto from "node:crypto";
import { importExam, exportExam } from "@exam/exam-format";
import { ExamContentSchema } from "@exam/schemas";
import { z } from "zod";
import { hashPassword, verifyPassword, newSession, hashSessionToken, MemoryAuthStore, SqliteAuthStore, type AuthStore, type Account, type SecurityEvent, type SecurityAlert, type Role, type AccountStatus } from "./auth.js";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limit.js";
import { initAiPool, listAiKeys, addAiKey, deleteAiKey, setAiKey, geminiChat, getAiLimits, setAiLimits } from "./ai-pool.js";
import { initNotifications, listMessages, getMessage, createMessage, updateMessage, deleteMessage, deliverMessage, dueScheduledMessages, listForUser, markRead, deleteForUser, purgeUser as purgeUserNotifications, type NotificationCategory } from "./notifications.js";
import { initSettings, getSettings, setSettings, SETTING_RANGES } from "./settings.js";
import {
  MemoryServerRepository,
  MemoryShareRepository,
  MemorySyncRepository,
  createSqliteRepositories,
  defaultSharedExamsDir,
  type ServerRepository,
  type ShareRepository,
  type SyncRepository,
  type ServerEntity
} from "./repositories.js";
import { runStorageGc, storageStats } from "./gc.js";

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
  expiresIn: z.enum(["24h","7d","never"]).default("7d"),
  ownerDeviceId: z.string().max(200).optional(),
  ownerAvatar: z.string().max(300_000).optional(),
  sourceEntityId: z.string().max(300).optional()
}).strict();

type BuildOptions = {
  serverRepository?: ServerRepository;
  syncRepository?: SyncRepository;
  shareRepository?: ShareRepository;
  authStore?: AuthStore;
  // Optional SQLite handle. Callers that build their own repositories via
  // createSqliteRepositories(...) and pass that whole object through as options
  // (e.g. `buildApp(createSqliteRepositories(url))`) can rely on the auth store
  // still being backed by the same database, instead of silently falling back
  // to a fresh, non-persistent in-memory auth store.
  db?: DatabaseSync;
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

// Constant-cost verify for unknown usernames: without it a missing user skipped
// scrypt entirely and login latency itself leaked which usernames exist.
const LOGIN_TIMING_DUMMY_HASH=hashPassword('timing-equalizer-not-a-real-password');
export function buildApp(options: BuildOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "production" ? { level: process.env.LOG_LEVEL ?? "info" } : false,
    trustProxy: resolveTrustProxy(),
    bodyLimit: 1024 * 1024,
    requestTimeout: envNumber("REQUEST_TIMEOUT_MS", 10_000, 1_000, 120_000),
    connectionTimeout: envNumber("CONNECTION_TIMEOUT_MS", 10_000, 1_000, 120_000)
  });
  const productionRepositories = !options.serverRepository && !options.syncRepository && !options.shareRepository && (process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "test" ? "memory" : "sqlite")) === "sqlite"
    ? createSqliteRepositories(process.env.DATABASE_URL)
    : undefined;
  const serverRepository = options.serverRepository ?? productionRepositories?.serverRepository ?? new MemoryServerRepository();
  const syncRepository = options.syncRepository ?? productionRepositories?.syncRepository ?? new MemorySyncRepository();
  const shareRepository = options.shareRepository ?? productionRepositories?.shareRepository ?? new MemoryShareRepository();
  const sqliteHandle = productionRepositories?.db ?? options.db;
  const authStore: AuthStore = options.authStore ?? (sqliteHandle ? new SqliteAuthStore(sqliteHandle) : new MemoryAuthStore());
  initAiPool(sqliteHandle);
  initNotifications(sqliteHandle);
  initSettings(sqliteHandle);
  const loginRate: RateLimiter = new MemoryRateLimiter();
  const registerRate: RateLimiter = new MemoryRateLimiter();
  const adminRate: RateLimiter = new MemoryRateLimiter();
  const activityRate: RateLimiter = new MemoryRateLimiter();
  const shareRate: RateLimiter = new MemoryRateLimiter();
  const shareCreateRate: RateLimiter = new MemoryRateLimiter();
  const officialDownloadRate: RateLimiter = new MemoryRateLimiter();
  const requestRateLimiter: RateLimiter = new MemoryRateLimiter();
  const shareLimit = envNumber("SHARE_LOOKUP_RATE_LIMIT_PER_MINUTE", 60, 1, 10_000);
  // General request cap is admin-editable at runtime (system settings); the old
  // env var only seeds the initial DB value now.
  const generalLimit = () => getSettings().generalRateLimitPerMinute;
  // Accept current codes plus legacy/imported alphanumeric share codes.
  // The server still looks up the exact code in the repository, so broadening
  // the character set does not grant access by itself.
  const shareCodePattern = /^[A-Z0-9]{6,10}$/;

  app.register(cors, { credentials: true, origin: (origin, cb) => {
    const origins=allowedOrigins().filter(value=>value!=="*");
    // cb(null, false) denies without throwing: an errored callback used to
    // surface as a generic 500 before the CSRF hook could answer 403.
    if (!origin || origins.includes(origin)) cb(null, true);
    else cb(null, false);
  }});

  // Body-less requests (DELETE, GET) legitimately carry no payload, but some
  // clients still send "content-type: application/json" out of habit. Fastify's
  // built-in JSON parser treats that combination as an error
  // (FST_ERR_CTP_EMPTY_JSON_BODY, HTTP 400) even though no route here reads
  // req.body for those methods. Override the default parser so an empty body
  // is accepted as "no body" (req.body === undefined) instead of rejected.
  // Non-empty bodies are still parsed as JSON and malformed JSON still fails
  // with the same 400 INVALID_JSON contract as before (see setErrorHandler),
  // so routes that require a body (POST/PUT) are unaffected: their zod
  // .safeParse(req.body) still rejects undefined/invalid payloads.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body !== "string" || body.length === 0) { done(null, undefined); return; }
    try {
      done(null, JSON.parse(body));
    } catch {
      const error = new Error("Body is not valid JSON but content-type is set to 'application/json'") as Error & { statusCode?: number; code?: string };
      error.statusCode = 400;
      error.code = "FST_ERR_CTP_INVALID_JSON_BODY";
      done(error, undefined);
    }
  });

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
    // Sweep every limiter, not just the general one: the per-feature limiters are
    // keyed by ip/user id and would otherwise retain expired buckets forever,
    // growing without bound on a long-running single-process deployment.
    for (const limiter of [loginRate, registerRate, adminRate, activityRate, shareRate, shareCreateRate, officialDownloadRate]) limiter.clearExpired(now);
    requestRateLimiter.clearExpired(now);
    const rate = requestRateLimiter.consume(ip, generalLimit());
    if (!rate.allowed) { void authStore.addSecurityEvent({id:crypto.randomUUID(),action:'RATE_LIMITED',severity:'WARNING',ip:req.ip,userAgent:String(req.headers['user-agent']??''),endpoint:req.url,result:'BLOCKED',createdAt:now}); return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests" } }); }
  });

  // Notifications: resolve recipients from the auth store, fan out per-user rows.
  async function publishNotification(id: string) {
    const msg = getMessage(id);
    if (!msg || msg.status === "SENT") return msg;
    let recipients: string[] = [];
    if (msg.audience === "ALL") recipients = await authStore.listActiveUserIds();
    else for (const uid of msg.targetUserIds ?? []) { const u = await authStore.getUser(uid); if (u && u.status === "ACTIVE") recipients.push(uid); }
    return deliverMessage(id, recipients);
  }
  // Scheduled messages fire on a timer (prod) and opportunistically whenever
  // an admin lists messages or a user polls — covers timer-less deployments.
  async function sweepScheduledNotifications() {
    for (const msg of dueScheduledMessages()) {
      try { await publishNotification(msg.id); }
      catch (error) { app.log.warn({ err: error, messageId: msg.id }, "scheduled notification delivery failed"); }
    }
  }

  app.addHook("onClose", async () => {
    if (gcTimer) clearInterval(gcTimer);
    if (notificationTimer) clearInterval(notificationTimer);
    for(const timer of discordTimers.values()) clearTimeout(timer);
    discordTimers.clear();
    // serverRepository/syncRepository/authStore may still need the shared SQLite
    // handle to be open (SqliteAuthStore.cleanup runs DELETE statements against
    // it). Only shareRepository.close() actually closes that shared handle
    // (SqliteShareRepository.close calls db.close()), so it must run last, after
    // every other consumer of the same db has finished its own cleanup.
    await Promise.all([serverRepository.close(), syncRepository.close(), authStore.cleanup(), authStore.close()]);
    await shareRepository.close();
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

  app.post("/api/images/imgbb", { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const limit = envNumber("IMGBB_UPLOAD_RATE_LIMIT_PER_MINUTE", 10, 1, 100);
    if (!bucket(activityRate, `imgbb-upload:${user.id}`, limit)) return reply.code(429).send({error:{code:"IMAGE_RATE_LIMITED",message:"Bạn upload ảnh quá nhanh. Vui lòng thử lại sau."}});
    const parsed = z.object({base64:z.string().min(1).max(14_000_000),name:z.string().trim().min(1).max(180),mimeType:z.enum(["image/jpeg","image/png","image/webp","image/gif"])}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_IMAGE",message:"Ảnh không hợp lệ."}});
    const apiKey=process.env.IMGBB_API_KEY?.trim();
    if(!apiKey)return reply.code(503).send({error:{code:"IMGBB_NOT_CONFIGURED",message:"ImgBB chưa được cấu hình trên server."}});
    try {
      const form=new URLSearchParams(); form.set("key",apiKey); form.set("image",parsed.data.base64); form.set("name",parsed.data.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120));
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20_000);
      const response=await fetch("https://api.imgbb.com/1/upload",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form.toString(),signal:controller.signal}); clearTimeout(timer);
      const body:any=await response.json().catch(()=>({}));
      if(!response.ok || !body?.success) return reply.code(502).send({error:{code:"IMGBB_UPLOAD_FAILED",message:"Không thể upload ảnh lên ImgBB."}});
      return {url:String(body.data?.url??body.data?.display_url??""),displayUrl:String(body.data?.display_url??body.data?.url??"")};
    } catch { return reply.code(502).send({error:{code:"IMGBB_UPLOAD_FAILED",message:"ImgBB hiện không khả dụng."}}); }
  });

  // AI / Gemini: all provider keys stay server-side. UI never receives the raw key.
  app.post("/api/ai/chat", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const aiChatLimit=getAiLimits().chatPerMinute;if(aiChatLimit<=0)return reply.code(403).send({error:{code:"AI_DISABLED",message:"AI chat hiện đang bị admin tắt."}});if (!bucket(activityRate, `ai-chat:${user.id}`, Math.min(1000,aiChatLimit))) return reply.code(429).send({error:{code:"AI_RATE_LIMITED",message:"AI đang được hỏi quá nhanh. Vui lòng thử lại sau."}});
    const parsed=z.object({message:z.string().trim().min(1).max(4000),history:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(8000)})).max(10).optional()}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_REQUEST",message:"Nội dung không hợp lệ."}});
    try {
      const history=(parsed.data.history??[]).map(x=>({role:x.role,content:x.content}));
      const answer=await geminiChat([{role:"system",content:"Bạn là trợ lý học tập của web Thi Thử. Trả lời ngắn gọn, dễ hiểu bằng tiếng Việt. Không bịa dữ kiện khi không chắc."},...history,{role:"user",content:parsed.data.message}]);
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
    try { const answer=await geminiChat([{role:"system",content:"Bạn là gia sư tiếng Việt. Giải thích ngắn gọn, dễ hiểu. Bắt buộc dùng Markdown đơn giản: tiêu đề **Giải thích:**, sau đó 2-4 gạch đầu dòng. Dùng **Đáp án đúng**, **Đáp án học sinh**, **Vì sao** để làm nổi bật. Chỉ gọi đáp án bằng nội dung chữ mà học sinh nhìn thấy; tuyệt đối không nhắc ID nội bộ như q1_o1, q1_o2, optionId hoặc mã kỹ thuật. Không dùng dấu backslash trước dấu *. Không trả lời JSON."},{role:"user",content:`Câu hỏi:\n${parsed.data.question}\n\nĐáp án học sinh:\n${parsed.data.userAnswer}\n\nĐáp án đúng:\n${parsed.data.correctAnswer}\n\nGiải thích có sẵn (nếu có):\n${parsed.data.existingExplanation??"Không có"}`}]); return {answer}; }
    catch(e){req.log.warn({err:e},"AI explanation failed");return reply.code(503).send({error:{code:"AI_UNAVAILABLE",message:"AI hiện không khả dụng."}});}
  });
  app.post("/api/ai/repair-json", async (req, reply) => {
    const user=await requireUser(req,reply); if(!user)return;
    const aiJsonLimit=getAiLimits().jsonPerMinute;if(aiJsonLimit<=0)return reply.code(403).send({error:{code:"AI_DISABLED",message:"Tính năng sửa JSON bằng AI hiện đang bị admin tắt."}});if(!bucket(activityRate,`ai-json:${user.id}`,Math.min(1000,aiJsonLimit)))return reply.code(429).send({error:{code:"AI_RATE_LIMITED",message:"Bạn đã yêu cầu sửa JSON quá nhiều. Vui lòng thử lại sau."}});
    const parsed=z.object({json:z.string().max(500000),error:z.string().max(5000).optional()}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_REQUEST",message:"JSON đầu vào không hợp lệ."}});
    try {
      const answer=await geminiChat([{role:"system",content:"Bạn chuyên sửa JSON đề thi. Chỉ trả về một JSON object hợp lệ, KHÔNG markdown, KHÔNG ba dấu backtick, KHÔNG lời giải thích bên ngoài JSON. Giữ nguyên dữ liệu hợp lệ, chỉ sửa lỗi cú pháp/cấu trúc cần thiết. Kết quả phải parse được bằng JSON.parse()."},{role:"user",content:`JSON cần sửa:\n${parsed.data.json}\n\nLỗi validator:\n${parsed.data.error??"JSON.parse thất bại"}`}]);
      let clean=answer.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
      JSON.parse(clean);
      return {json:clean};
    } catch(e){req.log.warn({err:e},"AI JSON repair failed");return reply.code(503).send({error:{code:"AI_REPAIR_FAILED",message:"AI không trả về JSON hợp lệ. Hãy thử lại."}});}
  });
  app.get("/api/admin/ai/settings", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;return {limits:getAiLimits()};});
  app.patch("/api/admin/ai/settings", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({chatPerMinute:z.number().int().min(0).max(1000),explainPerMinute:z.number().int().min(0).max(1000),jsonPerMinute:z.number().int().min(0).max(1000)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_AI_LIMITS',message:'Giới hạn AI không hợp lệ.'}});setAiLimits(parsed.data,admin.id);await audit(req,admin,'ADMIN_UPDATE_AI_LIMITS','ai-settings','SUCCESS',parsed.data);return {ok:true,limits:getAiLimits()};});
  app.get("/api/admin/ai/keys", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;return {keys:listAiKeys()};});
  app.post("/api/admin/ai/keys", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({name:z.string().trim().min(1).max(100),key:z.string().trim().min(20).max(300),model:z.string().trim().max(100).optional(),rpmLimit:z.number().int().min(1).max(1000).default(15)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_KEY",message:"API key không hợp lệ."}});const id=addAiKey(parsed.data.name,parsed.data.key,parsed.data.model,parsed.data.rpmLimit);await audit(req,admin,'ADMIN_ADD_AI_KEY',id,'SUCCESS',{name:parsed.data.name});await event(req,{userId:admin.id,username:admin.username,action:"ADD_AI_KEY",severity:"INFO",result:"SUCCESS",metadata:{keyId:id,name:parsed.data.name}});return {ok:true,id};});
  app.patch("/api/admin/ai/keys/:id", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({enabled:z.boolean()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:"INVALID_AI_KEY",message:"Dữ liệu không hợp lệ."}});if(!setAiKey(String((req.params as any).id),parsed.data.enabled))return reply.code(404).send({error:{code:"NOT_FOUND",message:"Không tìm thấy API key"}});await audit(req,admin,'ADMIN_UPDATE_AI_KEY',String((req.params as any).id),'SUCCESS',{enabled:parsed.data.enabled});return {ok:true};});
  app.delete("/api/admin/ai/keys/:id", async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;if(!deleteAiKey(String((req.params as any).id)))return reply.code(404).send({error:{code:"NOT_FOUND",message:"Không tìm thấy API key"}});await audit(req,admin,'ADMIN_DELETE_AI_KEY',String((req.params as any).id),'SUCCESS');return {ok:true};});

  app.get("/api/health/database", async (_req, reply) => { try { if (productionRepositories?.db) productionRepositories.db.prepare('SELECT 1').get(); return {ok:true,database:'ready'}; } catch { return reply.code(503).send({ok:false,database:'unavailable'}); } });

  // ---- Vocabulary translate (online dictionary proxy) ----
  // Google Translate's free gtx endpoint: no API key, no daily per-IP quota
  // (MyMemory capped out fast). Unrecognized words are echoed back unchanged
  // — filtered to null so the client keeps them for manual entry. Results
  // are cached server-side.
  const translateCache = new Map<string, string | null>();
  app.get("/api/vocabulary/translate", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!bucket(activityRate, `vocab-translate:${user.id}`, envNumber('VOCAB_TRANSLATE_RATE_LIMIT_PER_MINUTE', 10, 1, 100)))
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Bạn đang dịch quá nhanh. Vui lòng thử lại sau." } });
    const q = z.object({ words: z.string().trim().min(1).max(2000) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Danh sách từ không hợp lệ." } });
    const words = [...new Set(q.data.words.split(",").map(w => w.trim().toLowerCase()).filter(w => /^[a-z][a-z' -]{0,49}$/.test(w)))].slice(0, 20);
    const out: Record<string, string | null> = {};
    const pending: string[] = [];
    for (const w of words) { if (translateCache.has(w)) out[w] = translateCache.get(w)!; else pending.push(w); }
    await Promise.all(pending.map(async w => {
      try {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(w)}`, { signal: controller.signal });
        clearTimeout(timer);
        const body: any = await res.json().catch(() => null);
        const text = String(body?.[0]?.[0]?.[0] ?? "").trim();
        const meaning = res.ok && text && text.toLowerCase() !== w ? text : null;
        out[w] = meaning;
        if (translateCache.size > 2000) translateCache.clear();
        translateCache.set(w, meaning);
      } catch { out[w] = null; }
    }));
    return { translations: out };
  });

  // ---- Notifications: user side ----
  app.get("/api/notifications", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid pagination" } });
    // Opportunistic sweep: with users polling every 30s, due scheduled
    // messages fire even on memory-driver builds without the 60s timer.
    await sweepScheduledNotifications();
    const { rows, total, unread } = listForUser(user.id, (q.data.page - 1) * q.data.limit, q.data.limit);
    return { notifications: rows, total, unread };
  });
  app.post("/api/notifications/read", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const parsed = z.object({ ids: z.array(z.string().min(1).max(100)).max(500).optional(), all: z.boolean().optional() }).strict().safeParse(req.body);
    if (!parsed.success || (!parsed.data.ids && !parsed.data.all)) return reply.code(400).send({ error: { code: "INVALID_READ_REQUEST", message: "Yêu cầu không hợp lệ." } });
    const updated = markRead(user.id, parsed.data.all ? undefined : parsed.data.ids);
    return { ok: true, updated };
  });
  app.delete("/api/notifications/:id", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!deleteForUser(user.id, String((req.params as any).id))) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy thông báo." } });
    return { ok: true };
  });

  // ---- Notifications: admin side ----
  // No zod .default() here: this schema is also .partial()'d for PATCH, and a
  // defaulted field silently injects its default on every partial parse —
  // which once reset audience back to ALL on an unrelated title edit.
  const notificationInputSchema = z.object({
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
    category: z.enum(["announcement", "info", "warning", "success"]).optional(),
    link: z.string().trim().max(500).refine(v => v === "" || v.startsWith("/"), "Link nội bộ phải bắt đầu bằng /").optional(),
    audience: z.enum(["ALL", "USERS"]).optional(),
    targetUserIds: z.array(z.string().min(1).max(100)).max(500).optional(),
    scheduledAt: z.number().int().optional(),
    publish: z.boolean().optional()
  }).strict();
  app.get("/api/admin/notifications", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    await sweepScheduledNotifications();
    return { messages: listMessages() };
  });
  app.post("/api/admin/notifications", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const parsed = notificationInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Nội dung thông báo không hợp lệ." } });
    if ((parsed.data.audience ?? "ALL") === "USERS" && !(parsed.data.targetUserIds ?? []).length) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Chọn ít nhất một người nhận." } });
    if (parsed.data.scheduledAt && parsed.data.scheduledAt <= Date.now()) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Thời gian hẹn giờ phải ở tương lai." } });
    if (parsed.data.audience === "USERS") for (const uid of parsed.data.targetUserIds ?? []) if (!(await authStore.getUser(uid))) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: `Người nhận không tồn tại: ${uid}` } });
    const msg = createMessage({ title: parsed.data.title, body: parsed.data.body, category: (parsed.data.category ?? "announcement") as NotificationCategory, link: parsed.data.link || undefined, audience: parsed.data.audience ?? "ALL", targetUserIds: parsed.data.targetUserIds, scheduledAt: parsed.data.scheduledAt, createdBy: admin.id });
    await audit(req, admin, "ADMIN_CREATE_NOTIFICATION", msg.id, "SUCCESS", { title: msg.title, audience: msg.audience, scheduledAt: msg.scheduledAt });
    if (parsed.data.publish && msg.status !== "SCHEDULED") await publishNotification(msg.id);
    if (parsed.data.publish && msg.status !== "SCHEDULED") await audit(req, admin, "ADMIN_PUBLISH_NOTIFICATION", msg.id, "SUCCESS", { sentCount: getMessage(msg.id)?.sentCount ?? 0 });
    return { ok: true, message: getMessage(msg.id) };
  });
  app.patch("/api/admin/notifications/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const id = String((req.params as any).id);
    const current = getMessage(id);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy thông báo." } });
    if (current.status === "SENT") return reply.code(409).send({ error: { code: "NOTIFICATION_SENT", message: "Thông báo đã gửi không thể sửa." } });
    const parsed = notificationInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Nội dung thông báo không hợp lệ." } });
    if ((parsed.data.audience ?? current.audience) === "USERS") {
      const targets = parsed.data.targetUserIds ?? current.targetUserIds ?? [];
      if (!targets.length) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Chọn ít nhất một người nhận." } });
      for (const uid of targets) if (!(await authStore.getUser(uid))) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: `Người nhận không tồn tại: ${uid}` } });
    }
    const scheduledAt = "scheduledAt" in parsed.data ? parsed.data.scheduledAt : current.scheduledAt;
    if (scheduledAt && scheduledAt <= Date.now() && !parsed.data.publish) return reply.code(400).send({ error: { code: "INVALID_NOTIFICATION", message: "Thời gian hẹn giờ phải ở tương lai." } });
    const patchForStore: Partial<typeof parsed.data> = { ...parsed.data, scheduledAt };
    delete (patchForStore as any).publish;
    if ("link" in parsed.data) (patchForStore as any).link = parsed.data.link || undefined;
    updateMessage(id, patchForStore);
    await audit(req, admin, "ADMIN_UPDATE_NOTIFICATION", id, "SUCCESS", { fields: Object.keys(parsed.data) });
    if (parsed.data.publish) { await publishNotification(id); await audit(req, admin, "ADMIN_PUBLISH_NOTIFICATION", id, "SUCCESS", { sentCount: getMessage(id)?.sentCount ?? 0 }); }
    return { ok: true, message: getMessage(id) };
  });
  app.post("/api/admin/notifications/:id/publish", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const id = String((req.params as any).id);
    const current = getMessage(id);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy thông báo." } });
    if (current.status === "SENT") return reply.code(409).send({ error: { code: "NOTIFICATION_SENT", message: "Thông báo đã được gửi." } });
    await publishNotification(id);
    await audit(req, admin, "ADMIN_PUBLISH_NOTIFICATION", id, "SUCCESS", { sentCount: getMessage(id)?.sentCount ?? 0 });
    return { ok: true, message: getMessage(id) };
  });
  app.delete("/api/admin/notifications/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const id = String((req.params as any).id);
    if (!getMessage(id)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy thông báo." } });
    deleteMessage(id);
    await audit(req, admin, "ADMIN_DELETE_NOTIFICATION", id);
    return { ok: true };
  });

  // ---- System settings (admin-editable limits) ----
  app.get("/api/admin/settings", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    return { settings: getSettings() };
  });
  app.patch("/api/admin/settings", async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const shape = z.record(z.string(), z.unknown()).safeParse(req.body);
    if (!shape.success) return reply.code(400).send({ error: { code: "INVALID_SETTINGS", message: "Dữ liệu cài đặt không hợp lệ." } });
    const allowed = new Set(Object.keys(SETTING_RANGES));
    const patch: Record<string, number> = {};
    for (const [key, value] of Object.entries(shape.data)) {
      if (!allowed.has(key)) return reply.code(400).send({ error: { code: "INVALID_SETTINGS", message: `Cài đặt không tồn tại: ${key}` } });
      const n = Number(value);
      const range = SETTING_RANGES[key as keyof typeof SETTING_RANGES];
      if (!Number.isInteger(n) || n < range.min || n > range.max) return reply.code(400).send({ error: { code: "INVALID_SETTINGS", message: `Giá trị ${key} phải từ ${range.min} đến ${range.max}.` } });
      patch[key] = n;
    }
    if (!Object.keys(patch).length) return reply.code(400).send({ error: { code: "INVALID_SETTINGS", message: "Không có cài đặt nào để cập nhật." } });
    const settings = setSettings(patch, admin.id);
    await audit(req, admin, "ADMIN_UPDATE_SETTINGS", "system", "SUCCESS", patch);
    return { ok: true, settings };
  });

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
  async function requireAdmin(req:any,reply:any){ const user=await requireUser(req,reply); if(!user)return; if(user.role!=='ADMIN'){reply.code(403).send({error:{code:'FORBIDDEN',message:'Bạn không có quyền truy cập.'}});return;} if(!bucket(adminRate,user.id,envNumber('ADMIN_RATE_LIMIT_PER_MINUTE',120,1,2000))){await event(req,{userId:user.id,username:user.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'});reply.code(429).send({error:{code:'RATE_LIMITED',message:'Admin API rate limit exceeded'}});return;} return user; }
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
  function bucketMany(limiter:RateLimiter,key:string,limit:number,count:number){
    if(count<=0)return true;
    for(let i=0;i<count;i++) if(!bucket(limiter,key,limit)) return false;
    return true;
  }
  async function seedAdmin(){const login=String(process.env.ADMIN_INITIAL_USERNAME??'admin').trim();const password=process.env.ADMIN_INITIAL_PASSWORD;if(!password)return;const existing=await authStore.getUserByLogin(login);if(!existing){await authStore.createUser({id:crypto.randomUUID(),username:login,displayName:login,passwordHash:hashPassword(password),role:'ADMIN'});}}
  function vietnamDayStart(date = new Date()){ const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); const y=parts.find(p=>p.type==='year')!.value; const m=parts.find(p=>p.type==='month')!.value; const d=parts.find(p=>p.type==='day')!.value; return new Date(`${y}-${m}-${d}T00:00:00+07:00`).getTime(); }
  async function seedFeatureFlags(){for(const key of ['REGISTRATION','TOURNAMENT','ENGLISH_PRACTICE','SHARE_CODE','OFFICIAL_EXAM','SYNC']){const flags=await authStore.getFeatureFlags();if(!flags.some(f=>f.key===key))await authStore.setFeatureFlag(key,true);}}
  void seedAdmin();
  void seedFeatureFlags();

  // Disk-budget GC (Railway volumes are ~500MB): daily purge of expired shares
  // (+ files), old sync mutation markers, long-deleted entities and their
  // change-log rows, plus the previously-never-scheduled authStore.cleanup().
  // Memory-driver/test builds (injected repositories) skip the timer entirely.
  let gcTimer: ReturnType<typeof setInterval> | undefined;
  let notificationTimer: ReturnType<typeof setInterval> | undefined;
  if (productionRepositories) {
    const gcIntervalMs = envNumber("STORAGE_GC_INTERVAL_MS", 24 * 3600_000, 60_000, 7 * 24 * 3600_000);
    gcTimer = setInterval(() => {
      runStorageGc(productionRepositories.db, { serverRepository, syncRepository, shareRepository, authStore })
        .then(report => { if (report.sharesPurged + report.mutationsPurged + report.entitiesPurged + report.changesPurged > 0) app.log.info(report, "storage gc ran"); })
        .catch(error => app.log.warn({ err: error }, "storage gc failed"));
    }, gcIntervalMs);
    gcTimer.unref?.();
    notificationTimer = setInterval(() => { void sweepScheduledNotifications(); }, 60_000);
    notificationTimer.unref?.();
  }

  app.get('/api/auth/me', async (req) => { const user=await currentUser(req); return { authenticated:Boolean(user), user:user?publicUser(user):null }; });
  app.post('/api/auth/register', async (req,reply)=>{
    if(!(await featureEnabled('REGISTRATION'))) return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Đăng ký tài khoản hiện đang tắt.'}});
    if(!bucket(registerRate,req.ip,envNumber('REGISTER_RATE_LIMIT_PER_MINUTE',5,1,100))) { await event(req,{action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); await raiseAlert(req,{type:'MASS_REGISTER_DETECTED',severity:'HIGH',reason:'Registration rate limit exceeded'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần đăng ký, vui lòng thử lại sau.'}}); }
    const parsed=z.object({name:z.string().trim().min(2).max(80),username:z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9._-]+$/),password:z.string().min(10).max(200),confirmPassword:z.string().max(200)}).strict().safeParse(req.body);
    if(!parsed.success||parsed.data.password!==parsed.data.confirmPassword)return reply.code(400).send({error:{code:'INVALID_REGISTER',message:'Tên, username hoặc mật khẩu không hợp lệ.'}});
    if(await authStore.getUserByLogin(parsed.data.username))return reply.code(409).send({error:{code:'ACCOUNT_EXISTS',message:'Tên đăng nhập đã được sử dụng.'}});
    let user; try { user=await authStore.createUser({id:crypto.randomUUID(),username:parsed.data.username,displayName:parsed.data.name,passwordHash:hashPassword(parsed.data.password)}); }
    catch(err){ // The username UNIQUE constraint is the only race the pre-check above can miss;
      // any other failure is a genuine server error and must surface as 500.
      if(err instanceof Error&&/UNIQUE constraint failed/i.test(err.message)) return reply.code(409).send({error:{code:'ACCOUNT_EXISTS',message:'Tên đăng nhập đã được sử dụng.'}});
      throw err; }
    await event(req,{userId:user.id,username:user.username,action:'REGISTER',severity:'INFO',result:'SUCCESS'}); return reply.code(201).send({user:publicUser(user)});
  });
  app.post('/api/auth/login', async (req,reply)=>{
    if(!bucket(loginRate,req.ip,envNumber('LOGIN_RATE_LIMIT_PER_MINUTE',10,1,100))) { await event(req,{action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); await raiseAlert(req,{type:'BRUTE_FORCE_DETECTED',severity:'HIGH',reason:'Login rate limit exceeded'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Thông tin đăng nhập không chính xác.'}}); }
    // `name` is accepted-but-ignored here: callers (including this test suite) commonly
    // reuse the register payload shape `{name, username, password}` for login. Lookup and
    // authentication are keyed strictly off `username`/`password`; `name` never influences
    // which account is matched or whether the password is accepted.
    const parsed=z.object({name:z.string().max(200).optional(),username:z.string().trim().min(1).max(200),password:z.string().min(1).max(200)}).strict().safeParse(req.body); if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_LOGIN',message:'Thông tin đăng nhập không chính xác.'}});
    const user=await authStore.getUserByLogin(parsed.data.username); const valid=user?verifyPassword(parsed.data.password,await authStore.getPasswordHash(user.id)??''):verifyPassword(parsed.data.password,LOGIN_TIMING_DUMMY_HASH); const loginNow=Date.now(); const expiredRestriction=Boolean(user&&(user.status==='LOCKED'&&user.lockedUntil&&user.lockedUntil<=loginNow || user.status==='SUSPENDED'&&user.suspendedUntil&&user.suspendedUntil<=loginNow));
    if(!user||user.status==='BANNED'||user.status==='DELETED'||(user.status==='LOCKED'&&!expiredRestriction)||(user.status==='SUSPENDED'&&!expiredRestriction)||!valid){ if(user){const fails=user.failedAttempts+1; const multiIp=await authStore.distinctFailedIpsSince(user.id,loginNow-30*60_000)>=2; const lock=fails>=5&&multiIp?Date.now()+15*60_000:undefined; const failedPatch:Partial<Account>={failedAttempts:fails}; if(lock){failedPatch.status='LOCKED';failedPatch.lockedUntil=lock;} await authStore.updateUser(user.id,failedPatch); if(lock){await event(req,{userId:user.id,username:user.username,action:'ACCOUNT_LOCKED',severity:'WARNING',result:'LOCKED'});await raiseAlert(req,{type:'BRUTE_FORCE_DETECTED',severity:'HIGH',userId:user.id,reason:'Repeated failed login attempts',requestCount:fails});}} await event(req,{userId:user?.id,username:user?.username,action:'LOGIN_FAILED',severity:'WARNING',result:'FAILED'}); return reply.code(401).send({error:{code:'INVALID_CREDENTIALS',message:'Thông tin đăng nhập không chính xác.'}}); }
    const at=Date.now(); // Only auto-recover LOCKED/SUSPENDED (expired restriction). Preserve LIMITED and
    // any other admin-set marker status instead of silently resetting it to ACTIVE on every login.
    const statusAfterLogin=(user.status==='LOCKED'||user.status==='SUSPENDED')?'ACTIVE':user.status;
    await authStore.updateUser(user.id,{failedAttempts:0,lockedUntil:undefined,suspendedUntil:undefined,lastLoginAt:at,status:statusAfterLogin}); const created=newSession(user.id,30,{userAgent:String(req.headers['user-agent']??''),ip:req.ip}); await authStore.createSession(created.session); reply.header('Set-Cookie',`${cookieName}=${created.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`); await event(req,{userId:user.id,username:user.username,action:user.role==='ADMIN'?'ADMIN_LOGIN':'LOGIN_SUCCESS',severity:'INFO',result:'SUCCESS'}); return {user:publicUser({...user,lastLoginAt:at,status:statusAfterLogin})};
  });
  app.post('/api/auth/logout', async(req,reply)=>{const token=cookieValue(req);if(token){const s=await authStore.getSession(hashSessionToken(token));if(s){await authStore.deleteSession(s.tokenHash);const logoutUser=await authStore.getUser(s.userId);await event(req,{userId:s.userId,username:logoutUser?.username,action:logoutUser?.role==='ADMIN'?'ADMIN_LOGOUT':'LOGOUT',severity:'INFO',result:'SUCCESS'});}}reply.header('Set-Cookie',`${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);return {ok:true};});
  app.post('/api/auth/change-password', async(req,reply)=>{const user=await requireUser(req,reply,true);if(!user)return;const parsed=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(10).max(200),confirmPassword:z.string().max(200)}).strict().safeParse(req.body);if(!parsed.success||parsed.data.newPassword!==parsed.data.confirmPassword)return reply.code(400).send({error:{code:'INVALID_PASSWORD_CHANGE',message:'Mật khẩu mới không hợp lệ.'}});if(!verifyPassword(parsed.data.currentPassword,await authStore.getPasswordHash(user.id)??''))return reply.code(400).send({error:{code:'INVALID_CURRENT_PASSWORD',message:'Mật khẩu hiện tại không chính xác.'}});await authStore.setPassword(user.id,hashPassword(parsed.data.newPassword),false);const session=await currentSession(req);await authStore.revokeSessions(user.id,session?.id);await event(req,{userId:user.id,username:user.username,action:'PASSWORD_CHANGED',severity:'INFO',result:'SUCCESS'});return {ok:true};});
  app.get('/api/account', async(req,reply)=>{const user=await requireUser(req,reply,true);if(!user)return;return {user:publicUser(user),stats:await authStore.userActivityStats(user.id)}});
  app.get('/api/account/activity', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid pagination'}});return {events:await authStore.listSecurityEvents((q.data.page-1)*q.data.limit,q.data.limit,{userId:user.id}),total:await authStore.countSecurityEvents({userId:user.id})};});
  app.get('/api/account/sessions', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const session=await currentSession(req);const rows=await authStore.listSessions(user.id);return {sessions:rows.map(s=>({id:s.id,createdAt:s.createdAt,lastSeenAt:s.lastSeenAt,expiresAt:s.expiresAt,userAgent:s.userAgent,ip:s.id===session?.id?s.ip:undefined,current:s.id===session?.id}))};});
  app.post('/api/account/sessions/revoke-others', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const session=await currentSession(req);await authStore.revokeSessions(user.id,session?.id);await event(req,{userId:user.id,action:'FORCE_LOGOUT',severity:'INFO',result:'SUCCESS'});return {ok:true};});
  app.post('/api/account/delete', async(req,reply)=>{const user=await requireUser(req,reply);if(!user)return;const parsed=z.object({password:z.string().min(1),confirmation:z.literal('DELETE')}).strict().safeParse(req.body);if(!parsed.success||!verifyPassword(parsed.data.password,await authStore.getPasswordHash(user.id)??''))return reply.code(400).send({error:{code:'INVALID_DELETE_CONFIRMATION',message:'Xác nhận xóa tài khoản không hợp lệ.'}});await serverRepository.purgeUser(user.id);await shareRepository.purgeUser(user.id);purgeUserNotifications(user.id);await authStore.updateUser(user.id,{status:'DELETED',deletedAt:Date.now()});await authStore.revokeSessions(user.id);await event(req,{userId:user.id,username:user.username,action:'ACCOUNT_DELETED',severity:'HIGH',result:'SUCCESS'});reply.header('Set-Cookie',`${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);return {ok:true};});
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
  app.patch('/api/admin/users/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const target=await authStore.getUser(id);if(!target||target.status==='DELETED')return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});const parsed=z.object({displayName:z.string().trim().min(2).max(80).optional(),email:z.union([z.string().trim().email().max(200),z.literal('')]).optional(),role:z.enum(['USER','ADMIN']).optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_USER_UPDATE',message:'Dữ liệu tài khoản không hợp lệ.'}});if(parsed.data.role==='USER'&&target.role==='ADMIN'&&(await authStore.countActiveAdmins())<=1)return reply.code(400).send({error:{code:'LAST_ADMIN_PROTECTION',message:'Không thể hạ quyền admin cuối cùng.'}}); if(id===admin.id&&parsed.data.role&&parsed.data.role!=='ADMIN')return reply.code(400).send({error:{code:'LAST_ADMIN_PROTECTION',message:'Không thể tự hạ quyền admin hiện tại.'}});const userPatch:Partial<Account>={};if(parsed.data.displayName!==undefined)userPatch.displayName=parsed.data.displayName;if(parsed.data.email!==undefined)userPatch.email=parsed.data.email||undefined;if(parsed.data.role!==undefined)userPatch.role=parsed.data.role;await authStore.updateUser(id,userPatch);await audit(req,admin,'ADMIN_UPDATE_USER',id,'SUCCESS',{fields:Object.keys(parsed.data)});return {ok:true,user:publicUser((await authStore.getUser(id))!)};});
  app.post('/api/admin/users/:id/restriction', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const parsed=z.object({status:z.enum(['ACTIVE','SUSPENDED','BANNED','LOCKED','LIMITED']),reason:z.string().max(300).optional(),suspendedUntil:z.number().int().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_RESTRICTION',message:'Invalid restriction'}});const target=await authStore.getUser(id);if(!target||target.status==='DELETED')return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});if(target.role==='ADMIN'&&parsed.data.status!=='ACTIVE'&&(await authStore.countActiveAdmins())<=1)return reply.code(400).send({error:{code:'LAST_ADMIN_PROTECTION',message:'Không thể vô hiệu hóa admin cuối cùng.'}});await authStore.updateUser(id,{status:parsed.data.status,suspendedUntil:parsed.data.status==='SUSPENDED'?(parsed.data.suspendedUntil??Date.now()+24*86400000):undefined});if(parsed.data.status!=='ACTIVE')await authStore.revokeSessions(id);if(parsed.data.status==='SUSPENDED')await event(req,{userId:id,action:'ACCOUNT_SUSPENDED',severity:'HIGH',result:'SUCCESS'});if(parsed.data.status==='BANNED')await event(req,{userId:id,action:'ACCOUNT_BANNED',severity:'CRITICAL',result:'SUCCESS'});if(parsed.data.status==='LOCKED')await event(req,{userId:id,action:'ACCOUNT_LOCKED',severity:'HIGH',result:'SUCCESS'});await audit(req,admin,parsed.data.status==='ACTIVE'?'ADMIN_UNLOCK_USER':'ADMIN_LOCK_USER',id,'SUCCESS',{status:parsed.data.status,reason:parsed.data.reason});return {ok:true};});
  app.post('/api/admin/users/:id/reset-password', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const parsed=z.object({temporaryPassword:z.string().min(10).max(200)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_PASSWORD',message:'Temporary password không hợp lệ.'}});const target=await authStore.getUser(id);if(!target||target.status==='DELETED')return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});await authStore.setPassword(id,hashPassword(parsed.data.temporaryPassword),true);await authStore.revokeSessions(id);await event(req,{userId:id,action:'PASSWORD_RESET',severity:'HIGH',result:'SUCCESS'});await audit(req,admin,'ADMIN_RESET_PASSWORD',id);return {ok:true};});
  app.post('/api/admin/users/:id/force-logout', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);if(!(await authStore.getUser(id)))return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});await authStore.revokeSessions(id);await audit(req,admin,'ADMIN_FORCE_LOGOUT',id);return {ok:true};});
  app.get('/api/admin/users/:id/exams', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);if(!(await authStore.getUser(id)))return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20),search:z.string().max(200).optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});const {rows,total}=await serverRepository.listExams({owner:id,search:q.data.search,offset:(q.data.page-1)*q.data.limit,limit:q.data.limit});return {exams:rows,total};});
  app.get('/api/admin/users/:id/shares', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);if(!(await authStore.getUser(id)))return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});const rows=await shareRepository.listByOwner(id);return {shares:rows.map(({packageBase64,...row})=>({...row,sizeBytes:Buffer.byteLength(packageBase64,'base64')}))};});
  app.get('/api/admin/exams', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20),search:z.string().max(200).optional(),owner:z.string().max(100).optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});const {rows,total}=await serverRepository.listExams({owner:q.data.owner||undefined,search:q.data.search,offset:(q.data.page-1)*q.data.limit,limit:q.data.limit});return {exams:rows,total,page:q.data.page,limit:q.data.limit};});
  app.delete('/api/admin/exams/:ownerId/:entityId', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const ownerId=String((req.params as any).ownerId);const entityId=String((req.params as any).entityId);const removed=await serverRepository.softDeleteExamsByOwner(ownerId,entityId);if(!removed.length)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Exam not found'}});for(const entity of removed)await syncRepository.append({...entity,operation:'DELETE'});await audit(req,admin,'ADMIN_DELETE_USER_EXAM',entityId,'SUCCESS',{ownerId,removed:removed.length});await event(req,{userId:ownerId,action:'ADMIN_DELETED_EXAM',severity:'WARNING',result:'SUCCESS',metadata:{examId:entityId}});return {ok:true,removed:removed.length};});
  app.delete('/api/admin/users/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const target=await authStore.getUser(id);if(!target)return reply.code(404).send({error:{code:'NOT_FOUND',message:'User not found'}});if(target.role==='ADMIN')return reply.code(400).send({error:{code:'ADMIN_PROTECTED',message:'Không thể xóa tài khoản ADMIN.'}});await serverRepository.purgeUser(id);await shareRepository.purgeUser(id);purgeUserNotifications(id);await authStore.updateUser(id,{status:'DELETED',deletedAt:Date.now()});await authStore.revokeSessions(id);await audit(req,admin,'ADMIN_DELETE_USER',id,'SUCCESS');return {ok:true};});
  app.get('/api/admin/security', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),search:z.string().max(200).optional(),severity:z.enum(['INFO','WARNING','HIGH','CRITICAL']).optional(),action:z.string().max(100).optional(),since:z.coerce.number().int().optional(),until:z.coerce.number().int().optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});const filters={search:q.data.search,severity:q.data.severity,action:q.data.action,since:q.data.since,until:q.data.until};return {events:await authStore.listSecurityEvents((q.data.page-1)*q.data.limit,q.data.limit,filters),total:await authStore.countSecurityEvents(filters)};});
  app.get('/api/admin/alerts', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),status:z.enum(['NEW','REVIEWED','RESOLVED']).optional()}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});return {alerts:await authStore.listSecurityAlerts((q.data.page-1)*q.data.limit,q.data.limit,q.data.status)};});
  app.post('/api/admin/alerts/:id/status', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const parsed=z.object({status:z.enum(['NEW','REVIEWED','RESOLVED'])}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_STATUS',message:'Invalid status'}});if(!(await authStore.getSecurityAlert(String((req.params as any).id))))return reply.code(404).send({error:{code:'NOT_FOUND',message:'Không tìm thấy alert'}});await authStore.updateSecurityAlert(String((req.params as any).id),parsed.data.status);await audit(req,user,'ADMIN_UPDATE_SECURITY_ALERT',String((req.params as any).id));return {ok:true};});
  app.get('/api/admin/audit', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});return {logs:await authStore.listAuditLogs((q.data.page-1)*q.data.limit,q.data.limit)};});
  app.get('/api/admin/features', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;return {flags:await authStore.getFeatureFlags()};});
  app.patch('/api/admin/features/:key', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const key=String((req.params as any).key);if(!/^[A-Za-z0-9:_-]{1,64}$/.test(key))return reply.code(400).send({error:{code:'INVALID_FLAG_KEY',message:'Feature flag key không hợp lệ.'}});const parsed=z.object({enabled:z.boolean()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_FLAG',message:'Invalid feature flag'}});await authStore.setFeatureFlag(key,parsed.data.enabled,user.id);await audit(req,user,'ADMIN_UPDATE_FEATURE_FLAG',key,'SUCCESS',{enabled:parsed.data.enabled});return {ok:true};});
  app.get('/api/admin/storage', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;return storageStats(sqliteHandle, sqliteHandle?defaultSharedExamsDir():undefined);});
  app.post('/api/admin/storage/gc', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({vacuum:z.enum(['auto','always','never']).optional()}).strict().safeParse(req.body??{});if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_GC_OPTIONS',message:'Tùy chọn dọn dẹp không hợp lệ.'}});const report=await runStorageGc(sqliteHandle,{serverRepository,syncRepository,shareRepository,authStore},{vacuum:parsed.data.vacuum});await audit(req,admin,'ADMIN_STORAGE_GC','storage','SUCCESS',{sharesPurged:report.sharesPurged,mutationsPurged:report.mutationsPurged,entitiesPurged:report.entitiesPurged,changesPurged:report.changesPurged,vacuumed:report.vacuumed,dbBytesBefore:report.dbBytesBefore,dbBytesAfter:report.dbBytesAfter});return {ok:true,report};});
  app.get('/api/admin/shares', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const q=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid query'}});const {page,limit}=q.data;const rows=await shareRepository.listAll((page-1)*limit,limit+1);const hasMore=rows.length>limit;return{page,limit,hasMore,shares:rows.slice(0,limit)};});
  app.delete('/api/admin/shares/:code', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const code=String((req.params as any)?.code??'');if(!shareCodePattern.test(code))return reply.code(400).send({error:{code:'INVALID_CODE',message:'Invalid share code'}});const row=await shareRepository.get(code);if(!row||row.deleted)return reply.code(404).send({error:{code:'SHARE_NOT_FOUND',message:'Share không tồn tại hoặc đã bị xóa.'}});await shareRepository.hardDelete(code);await audit(req,admin,'ADMIN_DELETE_SHARE','share','SUCCESS',{code,ownerUserId:row.ownerUserId??null,sizeBytes:Buffer.byteLength(row.packageBase64,'base64')});return{ok:true};});
  app.get('/api/admin/system', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const started=Date.now();let database:'OK'|'ERROR'='OK';try{if(productionRepositories?.db)productionRepositories.db.prepare('SELECT 1').get()}catch{database='ERROR'}let storage:'OK'|'ERROR'='OK';try{await shareRepository.get('HEALTH2');await syncRepository.pull(0,'__health__',1)}catch{storage='ERROR'}return {api:{status:'ONLINE',uptimeSeconds:Math.round(process.uptime())},database:{status:database},storage:{status:storage},sync:{status:storage},latencyMs:Date.now()-started};});
  app.get('/api/admin/search', async(req,reply)=>{const user=await requireAdmin(req,reply);if(!user)return;const q=z.object({q:z.string().trim().min(1).max(200)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:{code:'INVALID_QUERY',message:'Invalid search'}});const users=await authStore.listUsers(0,20,q.data.q);const official=(await authStore.listOfficialExams(true)).filter(e=>`${e.id} ${e.title}`.toLowerCase().includes(q.data.q.toLowerCase())).slice(0,20);const localExams=await serverRepository.searchExamIds(q.data.q,20);const exams=[...official.map(e=>({id:e.id,title:e.title,version:e.version,source:'official'})),...localExams.map(e=>({id:e.entityId,title:typeof (e.payload as any)?.title==='string'?(e.payload as any).title:'Local exam',version:Number((e.payload as any)?.version??0),source:'user'}))].slice(0,20);const events=await authStore.listSecurityEvents(0,20,{search:q.data.q});const shareCode=/^[A-HJ-NP-Z2-9]{6,10}$/i.test(q.data.q)?q.data.q.toUpperCase():'';const share=shareCode?await shareRepository.get(shareCode):undefined;return {users:users.map(publicUser),exams,shares:share?[{shareId:share.shareId,code:share.code,packageType:share.packageType,createdAt:share.createdAt,expiresAt:share.expiresAt}]:[],events};});
  app.post('/api/admin/official-exams', { bodyLimit: 36 * 1024 * 1024 }, async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const parsed=z.object({id:z.string().min(1).max(300).optional(),title:z.string().min(1).max(300).optional(),subject:z.string().min(1).max(100).optional(),grade:z.number().int().optional(),version:z.number().int().min(1).optional(),contentHash:z.string().regex(/^sha256:[a-f0-9]{64}$/i).optional(),packageBase64:z.string().min(1).optional(),questionCount:z.number().int().nonnegative().optional(),metadata:z.record(z.string(),z.unknown()).optional(),content:z.unknown().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_OFFICIAL_EXAM',message:'Invalid official exam'}});try{let bytes:Uint8Array;if(parsed.data.content){const content=ExamContentSchema.parse(parsed.data.content);bytes=await exportExam({content});}else if(parsed.data.packageBase64){bytes=Buffer.from(parsed.data.packageBase64,'base64');}else return reply.code(400).send({error:{code:'INVALID_OFFICIAL_EXAM',message:'Cần packageBase64 hoặc content JSON'}});const imported=await importExam(new Uint8Array(bytes));if(parsed.data.contentHash&&imported.contentHash.toLowerCase()!==parsed.data.contentHash.toLowerCase())return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Package hash không khớp'}});if(imported.content.questions.length>getSettings().maxQuestionsPerExam)return reply.code(400).send({error:{code:'TOO_MANY_QUESTIONS',message:`Đề vượt giới hạn ${getSettings().maxQuestionsPerExam} câu hỏi.`}});if(parsed.data.version!==undefined&&imported.content.version!==parsed.data.version)return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Package version không khớp'}});const existing=await authStore.getOfficialExam(imported.content.id);if(existing&&imported.content.version<=existing.version)return reply.code(409).send({error:{code:'VERSION_CONFLICT',message:'Version mới phải lớn hơn version hiện tại.'}});const row={id:imported.content.id,title:imported.content.title,subject:imported.content.subject,grade:imported.content.grade,version:imported.content.version,contentHash:imported.contentHash,packageBase64:Buffer.from(bytes).toString('base64'),questionCount:imported.content.questions.length,metadata:parsed.data.metadata,createdAt:existing?.createdAt??Date.now(),updatedAt:Date.now(),publishedAt:Date.now(),deletedAt:undefined};const stored=await authStore.upsertOfficialExam(row);if(!stored)return reply.code(409).send({error:{code:'VERSION_CONFLICT',message:'Version mới phải lớn hơn version hiện tại.'}});await audit(req,admin,existing?'ADMIN_UPDATE_OFFICIAL_EXAM':'ADMIN_CREATE_OFFICIAL_EXAM',row.id);return {ok:true,exam:{...row,packageBase64:undefined}};}catch{return reply.code(400).send({error:{code:'INVALID_PACKAGE',message:'Official Exam package không hợp lệ'}})}});
  app.patch('/api/admin/official-exams/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const current=await authStore.getOfficialExam(id);if(!current)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});const parsed=z.object({title:z.string().min(1).max(300).optional(),subject:z.string().min(1).max(100).optional(),grade:z.number().int().optional(),metadata:z.record(z.string(),z.unknown()).optional(),published:z.boolean().optional()}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:{code:'INVALID_UPDATE',message:'Invalid update'}});await authStore.updateOfficialExam({...current,...parsed.data,title:parsed.data.title??current.title,subject:parsed.data.subject??current.subject,updatedAt:Date.now(),publishedAt:parsed.data.published===false?undefined:current.publishedAt??Date.now(),deletedAt:parsed.data.published===false?Date.now():undefined});await audit(req,admin,parsed.data.published===false?'ADMIN_UNPUBLISH_OFFICIAL_EXAM':'ADMIN_UPDATE_OFFICIAL_EXAM',id);return {ok:true};});
  app.delete('/api/admin/official-exams/:id', async(req,reply)=>{const admin=await requireAdmin(req,reply);if(!admin)return;const id=String((req.params as any).id);const current=await authStore.getOfficialExam(id);if(!current)return reply.code(404).send({error:{code:'NOT_FOUND',message:'Official exam not found'}});await authStore.unpublishOfficialExam(id);await audit(req,admin,'ADMIN_DELETE_OFFICIAL_EXAM',id);return {ok:true};});

  app.post("/api/sync/push", { bodyLimit: 36 * 1024 * 1024 }, async (req, reply) => {
    // Request-shape validation runs before authentication so that malformed/unknown-field
    // requests are rejected uniformly (400) regardless of auth state, matching standard
    // API hardening practice (fail fast on a malformed request before doing any work).
    // This does not weaken security: authenticated endpoints still require a valid
    // session for every well-formed request below, and no data is exposed either way.
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid sync request" } });
    const syncUser = await requireUser(req, reply);
    if (!syncUser) return;
    const syncKey = syncUser.id;
    if (!bucket(activityRate, `sync:${syncKey}`, envNumber('SYNC_RATE_LIMIT_PER_MINUTE',30,1,500))) { await event(req,{userId:syncUser?.id,username:syncUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều sync request.'}}); }
    if (!(await featureEnabled('SYNC'))) return reply.code(403).send({error:{code:'FEATURE_DISABLED',message:'Sync hiện đang tắt.'}});
    const createExamCount=parsed.data.mutations.filter(m=>m.entityType==='exam'&&m.operation==='CREATE').length;
    const deleteExamCount=parsed.data.mutations.filter(m=>m.entityType==='exam'&&m.operation==='DELETE').length;
    const examMutationLimit=envNumber('CREATE_EXAM_RATE_LIMIT_PER_MINUTE',10,1,200);
    const examCreateKeys=[`exam-create:user:${syncUser.id}`,`exam-create:ip:${req.ip}`];
    if(createExamCount>0 && !examCreateKeys.every(k=>bucketMany(activityRate,k,examMutationLimit,createExamCount))){
      await event(req,{userId:syncUser.id,username:syncUser.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED',metadata:{createExamCount,kind:'CREATE_EXAM'}});
      await raiseAlert(req,{type:'MASS_EXAM_CREATION',severity:'HIGH',userId:syncUser.id,reason:'Exam creation rate limit exceeded',requestCount:createExamCount});
      return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần tạo đề.'}});
    }
    const examDeleteLimit=envNumber('DELETE_EXAM_RATE_LIMIT_PER_MINUTE',20,1,200);
    const examDeleteKeys=[`exam-delete:user:${syncUser.id}`,`exam-delete:ip:${req.ip}`];
    if(deleteExamCount>0 && !examDeleteKeys.every(k=>bucketMany(activityRate,k,examDeleteLimit,deleteExamCount))){
      await event(req,{userId:syncUser.id,username:syncUser.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED',metadata:{deleteExamCount,kind:'DELETE_EXAM'}});
      await raiseAlert(req,{type:'MASS_EXAM_DELETION',severity:'HIGH',userId:syncUser.id,reason:'Exam deletion rate limit exceeded',requestCount:deleteExamCount});
      return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần xóa đề.'}});
    }
    if (!bucket(activityRate, `sync:${parsed.data.deviceId}`, envNumber('SYNC_RATE_LIMIT_PER_MINUTE', 30, 1, 500))) { await event(req,{userId:syncUser?.id,username:syncUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Sync đang được giới hạn tốc độ.' } }); }
    // Resource caps (admin-editable system settings) — totals, not just rate:
    // these cannot be bypassed by slowing down or splitting requests.
    const systemSettings = getSettings();
    if (createExamCount > 0) {
      const examCount = await serverRepository.countExamsByUser(syncUser.id);
      if (examCount + createExamCount > systemSettings.maxExamsPerUser) {
        await event(req,{userId:syncUser.id,username:syncUser.username,action:'EXAM_LIMIT_REACHED',severity:'WARNING',result:'BLOCKED',metadata:{examCount,limit:systemSettings.maxExamsPerUser}});
        return reply.code(403).send({error:{code:'LIMIT_REACHED',message:`Bạn đã đạt giới hạn ${systemSettings.maxExamsPerUser} đề. Hãy xóa bớt đề cũ trước khi tạo mới.`}});
      }
    }
    for (const m of parsed.data.mutations) {
      if (m.entityType === 'exam' && m.operation !== 'DELETE' && Array.isArray((m.payload as any)?.questions) && (m.payload as any).questions.length > systemSettings.maxQuestionsPerExam)
        return reply.code(400).send({error:{code:'TOO_MANY_QUESTIONS',message:`Đề vượt giới hạn ${systemSettings.maxQuestionsPerExam} câu hỏi.`}});
    }
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
        await serverRepository.put(key(effectiveProfileId, m.entityType, m.entityId), entity);
        serverCursor = await syncRepository.append({ ...entity, operation: m.operation });
        if(m.entityType==='exam' && syncUser && (m.operation==='CREATE'||m.operation==='DELETE')) await event(req,{userId:syncUser.id,username:syncUser.username,action:m.operation==='CREATE'?'CREATE_EXAM':'DELETE_EXAM',severity:'INFO',result:'SUCCESS',metadata:{examId:m.entityId}});
        if(m.entityType==='exam' && m.operation==='CREATE' && syncUser) { const recent=await authStore.countSecurityEventsSince(Date.now()-60000,'CREATE_EXAM'); if(recent>=10) await raiseAlert(req,{type:'MASS_EXAM_CREATION',severity:'HIGH',userId:syncUser.id,reason:'High exam creation volume',requestCount:recent}); }
        acknowledgements.push(m.mutationId);
      });
    }
    return { acknowledgements, conflicts, serverCursor };
  });

  app.get("/api/sync/pull", async (req, reply) => {
    const syncUser = await requireUser(req, reply);
    if (!syncUser) return;
    const parsed = z.object({
      cursor: z.coerce.number().int().nonnegative().default(0),
      profileId: z.string().min(1).max(200)
    }).strict().safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "Invalid cursor" } });
    const effectiveProfileId = `${syncUser.id}:${parsed.data.profileId}`;
    const result = await syncRepository.pull(parsed.data.cursor, effectiveProfileId, 500);
    result.changes = result.changes.map(c => ({ ...c, profileId: parsed.data.profileId }));
    return result;
  });

  app.post("/api/share", { bodyLimit: 36 * 1024 * 1024 }, async (req, reply) => {
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
    if (shareUser && await shareRepository.countByOwner(shareUser.id) >= getSettings().maxSharesPerUser) {
      await event(req,{userId:shareUser.id,username:shareUser.username,action:'SHARE_LIMIT_REACHED',severity:'WARNING',result:'BLOCKED',metadata:{limit:getSettings().maxSharesPerUser}});
      return reply.code(403).send({ error: { code: "LIMIT_REACHED", message: `Bạn đã đạt giới hạn ${getSettings().maxSharesPerUser} mã chia sẻ đang hoạt động. Hãy xóa bớt mã cũ trước khi tạo mới.` } });
    }
    if (parsed.data.packageType === "exam") {
      let imported;
      try { imported = await importExam(new Uint8Array(bytes)); }
      catch { return reply.code(400).send({ error: { code: "INVALID_PACKAGE", message: "Invalid .exam package" } }); }
      if (imported.contentHash.toLowerCase() !== parsed.data.contentHash.toLowerCase() || imported.formatVersion !== parsed.data.formatVersion) {
        return reply.code(400).send({ error: { code: "HASH_MISMATCH", message: "Package hash/version mismatch" } });
      }
      if (imported.content.questions.length > getSettings().maxQuestionsPerExam) return reply.code(403).send({ error: { code: "TOO_MANY_QUESTIONS", message: `Đề vượt giới hạn ${getSettings().maxQuestionsPerExam} câu hỏi.` } });
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
      createdAt: Date.now(), updatedAt: Date.now(), expiresAt: expiry(parsed.data.expiresIn), ownerDeviceId: shareUser ? undefined : parsed.data.ownerDeviceId, ownerUserId: shareUser?.id, ownerName: shareUser?.displayName || shareUser?.username || "Người dùng", ownerAvatar: parsed.data.ownerAvatar, sourceEntityId: parsed.data.sourceEntityId, accessCount: 0
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
    return { shareId: row.shareId, shareCode: row.code, contentHash: row.contentHash, formatVersion: row.formatVersion, packageType: row.packageType ?? parsed.data.packageType, storageKey: row.storageKey, createdAt: row.createdAt, expiresAt: row.expiresAt, shareUrl: `/share/${row.code}`, ownerName: row.ownerName, ownerAvatar: row.ownerAvatar };
  });

  app.get("/api/share/:code", async (req, reply) => {
    const ip = req.ip;
    if (!bucket(shareRate, `share-lookup:ip:${ip}`, shareLimit) || !bucket(shareRate, `share-lookup:user:${(await currentUser(req))?.id ?? "anonymous"}`, Math.max(shareLimit, 30))) { const u=await currentUser(req); await event(req,{userId:u?.id,username:u?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED'}); return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many share lookups" } }); }
    const code = String((req.params as { code: string }).code).trim().toUpperCase();
    if (!shareCodePattern.test(code)) return reply.code(400).send({ error: { code: "INVALID_CODE", message: "Invalid share code" } });
    const row = await shareRepository.get(code);
    if (!row || row.deleted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Share not found" } });
    if (row.expiresAt && row.expiresAt < Date.now()) return reply.code(410).send({ error: { code: "EXPIRED", message: "Share expired" } });
    await shareRepository.incrementAccess(code);
    // Re-read after the atomic increment so concurrent requests do not return
    // a stale access counter/last-access timestamp to the client.
    const updatedAccess = await shareRepository.get(code);
    if (updatedAccess) { row.accessCount = updatedAccess.accessCount; row.lastAccessAt = updatedAccess.lastAccessAt; }
    let packageType = row.packageType ?? "exam";
    if (packageType === "exam") {
      try { await importExam(new Uint8Array(Buffer.from(row.packageBase64, "base64"))); }
      catch {
        try { const payload = JSON.parse(Buffer.from(row.packageBase64, "base64").toString("utf8")); if (payload?.type === "vocabularySet") packageType = "vocabularySet"; } catch {}
      }
    }
    return { shareId: row.shareId, shareCode: row.code, packageBase64: row.packageBase64, contentHash: row.contentHash, formatVersion: row.formatVersion, packageType, storageKey: row.storageKey, createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, shareUrl: `/share/${row.code}`, ownerName: row.ownerName, ownerAvatar: row.ownerAvatar, sourceEntityId: row.sourceEntityId, accessCount: row.accessCount ?? 0, lastAccessAt: row.lastAccessAt };
  });

  app.get("/api/share", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const rows = await shareRepository.listByOwner(user.id);
    return { shares: rows.map(row => ({ shareId: row.shareId, shareCode: row.code, packageType: row.packageType ?? "exam", contentHash: row.contentHash, formatVersion: row.formatVersion, createdAt: row.createdAt, updatedAt: row.updatedAt ?? row.createdAt, expiresAt: row.expiresAt, ownerName: row.ownerName, ownerAvatar: row.ownerAvatar, sourceEntityId: row.sourceEntityId, accessCount: row.accessCount ?? 0, lastAccessAt: row.lastAccessAt })) };
  });

  app.put("/api/share/:code", async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const shareMutationLimit=envNumber('SHARE_UPDATE_RATE_LIMIT_PER_MINUTE',20,1,200);
    if(!bucket(shareCreateRate,`share-update:user:${user.id}`,shareMutationLimit) || !bucket(shareCreateRate,`share-update:ip:${req.ip}`,shareMutationLimit)){
      await event(req,{userId:user.id,username:user.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED',metadata:{kind:'UPDATE_SHARE'}});
      await raiseAlert(req,{type:'MASS_SHARE_UPDATE_DETECTED',severity:'HIGH',userId:user.id,reason:'Share update rate limit exceeded'});
      return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần cập nhật mã chia sẻ.'}});
    }
    const code = String((req.params as { code: string }).code).trim().toUpperCase();
    if (!shareCodePattern.test(code)) return reply.code(400).send({ error: { code: "INVALID_CODE", message: "Invalid share code" } });
    const existing = await shareRepository.get(code);
    if (!existing || existing.deleted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Share not found" } });
    if (!existing.ownerUserId || existing.ownerUserId !== user.id) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Share owner required" } });
    const parsed = shareSchema.safeParse(req.body);
    if (!parsed.success || !isValidBase64(parsed.data?.packageBase64 ?? "")) return reply.code(400).send({ error: { code: "INVALID_SHARE", message: "Invalid share payload" } });
    if (parsed.data.packageType !== (existing.packageType ?? "exam")) return reply.code(400).send({ error: { code: "TYPE_MISMATCH", message: "Không thể đổi loại nội dung của mã chia sẻ." } });
    const bytes = Buffer.from(parsed.data.packageBase64, "base64");
    if (bytes.length > 25 * 1024 * 1024) return reply.code(413).send({ error: { code: "TOO_LARGE", message: "Package exceeds 25 MB" } });
    if (parsed.data.packageType === "exam") {
      try { const imported = await importExam(new Uint8Array(bytes)); if (imported.contentHash.toLowerCase() !== parsed.data.contentHash.toLowerCase() || imported.formatVersion !== parsed.data.formatVersion) throw new Error("HASH"); } catch { return reply.code(400).send({ error: { code: "INVALID_PACKAGE", message: "Invalid or mismatched .exam package" } }); }
    } else {
      const actualHash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      if (actualHash.toLowerCase() !== parsed.data.contentHash.toLowerCase()) return reply.code(400).send({ error: { code: "HASH_MISMATCH", message: "Package hash/version mismatch" } });
    }
    const updated = { ...existing, packageBase64: parsed.data.packageBase64, contentHash: parsed.data.contentHash, formatVersion: parsed.data.formatVersion, updatedAt: Date.now(), expiresAt: expiry(parsed.data.expiresIn), ownerAvatar: parsed.data.ownerAvatar ?? existing.ownerAvatar, sourceEntityId: parsed.data.sourceEntityId ?? existing.sourceEntityId };
    await shareRepository.update(updated);
    await event(req,{userId:user.id,username:user.username,action:'UPDATE_SHARE',severity:'INFO',result:'SUCCESS',metadata:{shareId:existing.shareId,packageType:existing.packageType}});
    return { shareId: updated.shareId, shareCode: updated.code, packageType: updated.packageType, contentHash: updated.contentHash, formatVersion: updated.formatVersion, createdAt: updated.createdAt, updatedAt: updated.updatedAt, expiresAt: updated.expiresAt, sourceEntityId: updated.sourceEntityId, accessCount: updated.accessCount ?? 0, shareUrl: `/share/${updated.code}` };
  });

  app.delete("/api/share/:code", async (req, reply) => {
    const deleteUser=await currentUser(req);
    const shareDeleteLimit=envNumber('SHARE_DELETE_RATE_LIMIT_PER_MINUTE',20,1,200);
    const deleteIdentity=deleteUser?.id ?? String(req.headers["x-device-id"] ?? "anonymous");
    if(!bucket(shareCreateRate,`share-delete:user:${deleteIdentity}`,shareDeleteLimit) || !bucket(shareCreateRate,`share-delete:ip:${req.ip}`,shareDeleteLimit)){
      await event(req,{userId:deleteUser?.id,username:deleteUser?.username,action:'RATE_LIMITED',severity:'WARNING',result:'BLOCKED',metadata:{kind:'DELETE_SHARE'}});
      await raiseAlert(req,{type:'MASS_SHARE_DELETION_DETECTED',severity:'HIGH',userId:deleteUser?.id,reason:'Share deletion rate limit exceeded'});
      return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Quá nhiều lần xóa mã chia sẻ.'}});
    }
    const code = String((req.params as { code: string }).code).trim().toUpperCase();
    if (!shareCodePattern.test(code)) return reply.code(400).send({ error: { code: "INVALID_CODE", message: "Invalid share code" } });
    const row = await shareRepository.get(code);
    if (!row || row.deleted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Share not found" } });
    // Authenticated shares are always owned by the server-side account.
    // Do not fall back to x-device-id for these rows: the device header is
    // client-controlled and must never grant ownership.
    if (row.ownerUserId) {
      if (!deleteUser || deleteUser.id !== row.ownerUserId) {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Share owner required" } });
      }
    } else {
      // Ownerless shares (created anonymously with no recorded device) can be
      // read by anyone holding the code, but never deleted by them — the share
      // code is a read capability, not a delete capability. Only the recorded
      // owner device or an admin may remove them.
      const deviceId = String(req.headers["x-device-id"] ?? "");
      if (!row.ownerDeviceId || deviceId !== row.ownerDeviceId) {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Share owner required" } });
      }
    }
    try {
      await shareRepository.delete(code);
    } catch (error) {
      req.log.error({ err: error, shareCode: code }, "share deletion failed");
      if (String((error as any)?.code ?? "").includes("SQLITE_BUSY") || String((error as any)?.code ?? "").includes("SQLITE_LOCKED") || /database (is )?locked/i.test(String((error as any)?.message ?? ""))) {
        return reply.code(503).send({ error: { code: "STORAGE_BUSY", message: "Kho dữ liệu đang bận, vui lòng thử lại sau." } });
      }
      return reply.code(503).send({ error: { code: "SHARE_STORAGE_UNAVAILABLE", message: "Không thể xóa mã chia sẻ lúc này. Vui lòng thử lại." } });
    }
    await event(req,{userId:deleteUser?.id,username:deleteUser?.username,action:'DELETE_SHARE',severity:'INFO',result:'SUCCESS',metadata:{shareId:row.shareId,packageType:row.packageType ?? 'exam'}});
    return { ok: true };
  });

  return app;
}

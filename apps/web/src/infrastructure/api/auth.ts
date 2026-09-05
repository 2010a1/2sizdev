import { request } from './base';

export type AuthUser = { id:string; name:string; username:string; email?:string; role:'USER'|'ADMIN'; status:'ACTIVE'|'SUSPENDED'|'BANNED'|'DELETED'|'LOCKED'|'LIMITED'; createdAt:number; lastLoginAt?:number; mustChangePassword?:boolean };
export type AuthState = { authenticated:boolean; user:AuthUser|null };
export type UserActivityStats = { total:number; practice:number; tournament:number; english:number; exams:number; shares:number; loginFails:number; rateLimited:number; warnings:number; suspicious:number };
export type SessionInfo = { id:string; createdAt:number; lastSeenAt:number; expiresAt:number; userAgent:string; ip?:string; current?:boolean };
export type SecurityEventRow = { id:string; userId?:string; username?:string; action:string; severity:string; ip?:string; userAgent?:string; endpoint?:string; result?:string; metadata?:Record<string,unknown>; createdAt:number };
export type SecurityAlertRow = { id:string; type:string; severity:'INFO'|'WARNING'|'HIGH'|'CRITICAL'; status:'NEW'|'REVIEWED'|'RESOLVED'; userId?:string; ip?:string; reason:string; requestCount:number; metadata?:Record<string,unknown>; createdAt:number; updatedAt:number };
export type AuditLogRow = { id:string; adminId:string; action:string; targetId?:string; ip?:string; userAgent?:string; result?:string; metadata?:Record<string,unknown>; createdAt:number };
export type OfficialExamRow = { id:string; title:string; subject:string; grade?:number; version:number; contentHash:string; questionCount:number; metadata?:Record<string,unknown>; createdAt:number; updatedAt:number; publishedAt?:number; deletedAt?:number };
export type FeatureFlagRow = { key:string; enabled:boolean; updatedAt:number; updatedBy?:string };
export type AdminStatsRow = { users:number; activeUsers:number; suspendedUsers:number; bannedUsers:number; lockedUsers:number; limitedUsers:number; deletedUsers:number; rateLimitedUsers:number; registrations:number; activities:{total:number;practice:number;tournament:number;english:number}; shares:number; exams:number };
export type AdminStatsResponse = { range:string; stats:AdminStatsRow; periods:{today:AdminStatsRow;yesterday:AdminStatsRow;last7Days:AdminStatsRow;last30Days:AdminStatsRow}; timezone:string };
export type AiLimits = { chatPerMinute:number; explainPerMinute:number; jsonPerMinute:number };
export type AiPoolKey = { id:string; name:string; maskedKey:string; model:string; provider:string; enabled:boolean; failures:number; cooldownUntil:number; createdAt:number; lastUsedAt?:number; rpmLimit:number };

export type StorageStatsRow = { driver:'sqlite'|'memory'; dbBytes:number; walBytes:number; sharedExamsBytes:number; sharedExamsFiles:number; tables?:Record<string,number>; topShareOwners?:Array<{ownerUserId:string|null;shares:number;bytes:number}> };
export type GcReportRow = { sharesPurged:number; mutationsPurged:number; entitiesPurged:number; changesPurged:number; vacuumed:boolean; dbBytesBefore:number; dbBytesAfter:number };
export type AdminShareRow = { shareId:string; code:string; contentHash:string; formatVersion:number; packageType?:string; storageKey?:string; createdAt:number; updatedAt?:number; expiresAt?:number; ownerDeviceId?:string; ownerUserId?:string; ownerName?:string; sourceEntityId?:string; accessCount?:number; lastAccessAt?:number; deleted?:boolean; sizeBytes:number };
export type NotificationCategory='announcement'|'info'|'warning'|'success';
export type UserNotificationRow={ id:string; notificationId:string; title:string; body:string; category:NotificationCategory; link?:string; readAt?:number; createdAt:number };
export type AdminNotificationRow={ id:string; title:string; body:string; category:NotificationCategory; link?:string; status:'DRAFT'|'SCHEDULED'|'SENT'; audience:'ALL'|'USERS'; targetUserIds?:string[]; scheduledAt?:number; sentAt?:number; sentCount:number; createdBy:string; createdAt:number; updatedAt:number };
export type SystemSettingsRow={ generalRateLimitPerMinute:number; maxExamsPerUser:number; maxQuestionsPerExam:number; maxSharesPerUser:number };
export type AdminExamRow={ profileId:string; ownerUserId:string; entityId:string; title:string; questionCount:number; revision:number; updatedAt:number; deletedAt?:number };
export const authApi={
  me:()=>request<AuthState>('/api/auth/me'),
  register:(name:string,username:string,password:string,confirmPassword:string)=>request<{user:AuthUser}>('/api/auth/register',{method:'POST',body:JSON.stringify({name,username,password,confirmPassword})}),
  login:(username:string,password:string)=>request<{user:AuthUser}>('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})}),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
  activity:(kind:'practice'|'tournament'|'english',profileId?:string,examId?:string)=>request<{ok:boolean}>('/api/activity',{method:'POST',body:JSON.stringify({kind,profileId,examId})}),
  officialList:()=>request<{exams:OfficialExamRow[]}>('/api/official-exams'),
  officialPackage:(id:string)=>request<{id:string; title:string; version:number; contentHash:string; packageBase64:string}>(`/api/official-exams/${encodeURIComponent(id)}/package`),
  changePassword:(currentPassword:string,newPassword:string,confirmPassword:string)=>request<{ok:boolean}>('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword,confirmPassword})}),
  account:()=>request<{user:AuthUser; stats:UserActivityStats}>('/api/account'),
  activityList:(page=1,limit=50)=>request<{events:SecurityEventRow[]; total:number}>(`/api/account/activity?page=${page}&limit=${limit}`),
  sessions:()=>request<{sessions:SessionInfo[]}>('/api/account/sessions'),
  revokeOtherSessions:()=>request<{ok:boolean}>('/api/account/sessions/revoke-others',{method:'POST'}),
  deleteAccount:(password:string)=>request<{ok:boolean}>('/api/account/delete',{method:'POST',body:JSON.stringify({password,confirmation:'DELETE'})}),
  features:()=>request<{flags:FeatureFlagRow[]}>('/api/features')
};
export const notificationApi={
  list:(page=1,limit=20)=>request<{notifications:UserNotificationRow[]; total:number; unread:number}>(`/api/notifications?page=${page}&limit=${limit}`),
  markRead:(ids?:string[])=>request<{ok:boolean; updated:number}>('/api/notifications/read',{method:'POST',body:JSON.stringify(ids?{ids}:{all:true})}),
  remove:(id:string)=>request<{ok:boolean}>(`/api/notifications/${encodeURIComponent(id)}`,{method:'DELETE'})
};
export const adminApi={
  stats:(range='7d')=>request<AdminStatsResponse>(`/api/admin/stats?range=${range}`),
  users:(page=1,limit=50,search='',status='')=>request<{users:AuthUser[]; total:number}>(`/api/admin/users?page=${page}&limit=${limit}${search?`&search=${encodeURIComponent(search)}`:''}${status?`&status=${encodeURIComponent(status)}`:''}`),
  restrictUser:(id:string,status:'ACTIVE'|'SUSPENDED'|'BANNED'|'LOCKED'|'LIMITED',reason?:string)=>request<{ok:boolean}>(`/api/admin/users/${encodeURIComponent(id)}/restriction`,{method:'POST',body:JSON.stringify({status,reason})}),
  updateUser:(id:string,payload:{displayName?:string;email?:string;role?:'USER'|'ADMIN'})=>request<{ok:boolean; user:AuthUser}>(`/api/admin/users/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  user:(id:string)=>request<{user:AuthUser; stats:UserActivityStats; sessions:SessionInfo[]}>(`/api/admin/users/${encodeURIComponent(id)}`),
  resetPassword:(id:string,temporaryPassword:string)=>request<{ok:boolean}>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`,{method:'POST',body:JSON.stringify({temporaryPassword})}),
  forceLogout:(id:string)=>request<{ok:boolean}>(`/api/admin/users/${encodeURIComponent(id)}/force-logout`,{method:'POST'}),
  deleteUser:(id:string)=>request<{ok:boolean}>(`/api/admin/users/${encodeURIComponent(id)}`,{method:'DELETE'}),
  security:(page=1,limit=50,params:string='')=>request<{events:SecurityEventRow[]; total:number}>(`/api/admin/security?page=${page}&limit=${limit}${params}`),
  alerts:(page=1,limit=50,status?:string)=>request<{alerts:SecurityAlertRow[]}>(`/api/admin/alerts?page=${page}&limit=${limit}${status?`&status=${encodeURIComponent(status)}`:''}`),
  updateAlert:(id:string,status:string)=>request<{ok:boolean}>(`/api/admin/alerts/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status})}),
  features:()=>request<{flags:FeatureFlagRow[]}>('/api/admin/features'),
  setFeature:(key:string,enabled:boolean)=>request<{ok:boolean}>(`/api/admin/features/${encodeURIComponent(key)}`,{method:'PATCH',body:JSON.stringify({enabled})}),
  system:()=>request<{api:{status:string;uptimeSeconds:number}; database:{status:string}; storage:{status:string}; sync:{status:string}; latencyMs:number}>('/api/admin/system'),
  search:(q:string)=>request<{users:AuthUser[]; exams:Array<{id:string;title:string;version:number;source:string}>; shares:Array<{shareId:string;code:string;packageType:string;createdAt:number;expiresAt?:number}>; events:SecurityEventRow[]}>(`/api/admin/search?q=${encodeURIComponent(q)}`),
  audit:(page=1,limit=50)=>request<{logs:AuditLogRow[]}>(`/api/admin/audit?page=${page}&limit=${limit}`),
  officialList:()=>request<{exams:OfficialExamRow[]}>('/api/official-exams?includeUnpublished=true'),
  createOfficial:(payload:Record<string,unknown>)=>request<{ok:boolean; exam:OfficialExamRow}>('/api/admin/official-exams',{method:'POST',body:JSON.stringify(payload)}),
  updateOfficial:(id:string,payload:Record<string,unknown>)=>request<{ok:boolean}>(`/api/admin/official-exams/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  deleteOfficial:(id:string)=>request<{ok:boolean}>(`/api/admin/official-exams/${encodeURIComponent(id)}`,{method:'DELETE'}),
  aiKeys:()=>request<{keys:AiPoolKey[]}>("/api/admin/ai/keys"),
  aiSettings:()=>request<{limits:AiLimits}>("/api/admin/ai/settings"),
  setAiSettings:(payload:AiLimits)=>request<{ok:boolean; limits:AiLimits}>("/api/admin/ai/settings",{method:"PATCH",body:JSON.stringify(payload)}),
  addAiKey:(name:string,key:string,model?:string,rpmLimit=15)=>request<{ok:boolean; id:string}>("/api/admin/ai/keys",{method:"POST",body:JSON.stringify({name,key,model,rpmLimit})}),
  setAiKey:(id:string,enabled:boolean)=>request<{ok:boolean}>(`/api/admin/ai/keys/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({enabled})}),
  deleteAiKey:(id:string)=>request<{ok:boolean}>(`/api/admin/ai/keys/${encodeURIComponent(id)}`,{method:"DELETE"}),
  storage:()=>request<StorageStatsRow>('/api/admin/storage'),
  storageGc:(vacuum:'auto'|'always'|'never'='auto')=>request<{ok:boolean; report:GcReportRow}>('/api/admin/storage/gc',{method:'POST',body:JSON.stringify({vacuum})}),
  shares:(page=1,limit=20)=>request<{page:number;limit:number;hasMore:boolean;shares:AdminShareRow[]}>(`/api/admin/shares?page=${page}&limit=${limit}`),
  deleteShare:(code:string)=>request<{ok:boolean}>(`/api/admin/shares/${encodeURIComponent(code)}`,{method:'DELETE'}),
  notifications:()=>request<{messages:AdminNotificationRow[]}>('/api/admin/notifications'),
  createNotification:(payload:Partial<{title:string;body:string;category:NotificationCategory;link:string;audience:'ALL'|'USERS';targetUserIds:string[];scheduledAt:number;publish:boolean}>)=>request<{ok:boolean; message:AdminNotificationRow}>('/api/admin/notifications',{method:'POST',body:JSON.stringify(payload)}),
  updateNotification:(id:string,payload:Record<string,unknown>)=>request<{ok:boolean; message:AdminNotificationRow}>(`/api/admin/notifications/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  publishNotification:(id:string)=>request<{ok:boolean; message:AdminNotificationRow}>(`/api/admin/notifications/${encodeURIComponent(id)}/publish`,{method:'POST'}),
  deleteNotification:(id:string)=>request<{ok:boolean}>(`/api/admin/notifications/${encodeURIComponent(id)}`,{method:'DELETE'}),
  settings:()=>request<{settings:SystemSettingsRow}>('/api/admin/settings'),
  setSettings:(payload:Partial<SystemSettingsRow>)=>request<{ok:boolean; settings:SystemSettingsRow}>('/api/admin/settings',{method:'PATCH',body:JSON.stringify(payload)}),
  userExams:(id:string,page=1,limit=20,search='')=>request<{exams:AdminExamRow[]; total:number}>(`/api/admin/users/${encodeURIComponent(id)}/exams?page=${page}&limit=${limit}${search?`&search=${encodeURIComponent(search)}`:''}`),
  userShares:(id:string)=>request<{shares:AdminShareRow[]}>(`/api/admin/users/${encodeURIComponent(id)}/shares`),
  exams:(page=1,limit=20,search='',owner='')=>request<{exams:AdminExamRow[]; total:number; page:number; limit:number}>(`/api/admin/exams?page=${page}&limit=${limit}${search?`&search=${encodeURIComponent(search)}`:''}${owner?`&owner=${encodeURIComponent(owner)}`:''}`),
  deleteUserExam:(ownerId:string,entityId:string)=>request<{ok:boolean; removed:number}>(`/api/admin/exams/${encodeURIComponent(ownerId)}/${encodeURIComponent(entityId)}`,{method:'DELETE'})
};

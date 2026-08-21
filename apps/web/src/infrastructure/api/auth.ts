import { apiUrl } from './base';

export type AuthUser = { id:string; name:string; username:string; role:'USER'|'ADMIN'; status:'ACTIVE'|'SUSPENDED'|'BANNED'|'DELETED'|'LOCKED'|'LIMITED'; createdAt:number; lastLoginAt?:number; mustChangePassword?:boolean };
export type AuthState = { authenticated:boolean; user:AuthUser|null };

async function request<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(apiUrl(path),{...init,credentials:'include',headers:{'content-type':'application/json',...(init?.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body?.error?.message??`HTTP_${response.status}`);
  return body as T;
}
export const authApi={
  me:()=>request<AuthState>('/api/auth/me'),
  register:(name:string,username:string,password:string,confirmPassword:string)=>request<{user:AuthUser}>('/api/auth/register',{method:'POST',body:JSON.stringify({name,username,password,confirmPassword})}),
  login:(username:string,password:string)=>request<{user:AuthUser}>('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})}),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
  activity:(kind:'practice'|'tournament'|'english',profileId?:string,examId?:string)=>request<{ok:boolean}>('/api/activity',{method:'POST',body:JSON.stringify({kind,profileId,examId})}),
  officialList:()=>request<{exams:any[]}>('/api/official-exams'),
  officialPackage:(id:string)=>request<any>(`/api/official-exams/${encodeURIComponent(id)}/package`),
  changePassword:(currentPassword:string,newPassword:string,confirmPassword:string)=>request<any>('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword,confirmPassword})}),
  account:()=>request<any>('/api/account'),
  activityList:(page=1,limit=50)=>request<any>(`/api/account/activity?page=${page}&limit=${limit}`),
  sessions:()=>request<any>('/api/account/sessions'),
  revokeOtherSessions:()=>request<any>('/api/account/sessions/revoke-others',{method:'POST'}),
  deleteAccount:(password:string)=>request<any>('/api/account/delete',{method:'POST',body:JSON.stringify({password,confirmation:'DELETE'})}),
  features:()=>request<any>('/api/features')
};
export const adminApi={
  stats:(range='7d')=>request<any>(`/api/admin/stats?range=${range}`),
  users:(page=1,limit=50,search='',status='')=>request<any>(`/api/admin/users?page=${page}&limit=${limit}${search?`&search=${encodeURIComponent(search)}`:''}${status?`&status=${encodeURIComponent(status)}`:''}`),
  restrictUser:(id:string,status:'ACTIVE'|'SUSPENDED'|'BANNED'|'LOCKED'|'LIMITED',reason?:string)=>request<any>(`/api/admin/users/${encodeURIComponent(id)}/restriction`,{method:'POST',body:JSON.stringify({status,reason})}),
  updateUser:(id:string,payload:{displayName?:string;email?:string;role?:'USER'|'ADMIN'})=>request<any>(`/api/admin/users/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  user:(id:string)=>request<any>(`/api/admin/users/${encodeURIComponent(id)}`),
  resetPassword:(id:string,temporaryPassword:string)=>request<any>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`,{method:'POST',body:JSON.stringify({temporaryPassword})}),
  forceLogout:(id:string)=>request<any>(`/api/admin/users/${encodeURIComponent(id)}/force-logout`,{method:'POST'}),
  deleteUser:(id:string)=>request<any>(`/api/admin/users/${encodeURIComponent(id)}`,{method:'DELETE'}),
  security:(page=1,limit=50,params:string='')=>request<any>(`/api/admin/security?page=${page}&limit=${limit}${params}`),
  alerts:(page=1,limit=50,status?:string)=>request<any>(`/api/admin/alerts?page=${page}&limit=${limit}${status?`&status=${encodeURIComponent(status)}`:''}`),
  updateAlert:(id:string,status:string)=>request<any>(`/api/admin/alerts/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status})}),
  features:()=>request<any>('/api/admin/features'),
  setFeature:(key:string,enabled:boolean)=>request<any>(`/api/admin/features/${encodeURIComponent(key)}`,{method:'PATCH',body:JSON.stringify({enabled})}),
  system:()=>request<any>('/api/admin/system'),
  search:(q:string)=>request<any>(`/api/admin/search?q=${encodeURIComponent(q)}`),
  audit:(page=1,limit=50)=>request<any>(`/api/admin/audit?page=${page}&limit=${limit}`),
  officialList:()=>request<any>('/api/official-exams?includeUnpublished=true'),
  createOfficial:(payload:any)=>request<any>('/api/admin/official-exams',{method:'POST',body:JSON.stringify(payload)}),
  updateOfficial:(id:string,payload:any)=>request<any>(`/api/admin/official-exams/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  deleteOfficial:(id:string)=>request<any>(`/api/admin/official-exams/${encodeURIComponent(id)}`,{method:'DELETE'}),
  aiKeys:()=>request<any>("/api/admin/ai/keys"),
  aiSettings:()=>request<any>("/api/admin/ai/settings"),
  setAiSettings:(payload:{chatPerMinute:number;explainPerMinute:number;jsonPerMinute:number})=>request<any>("/api/admin/ai/settings",{method:"PATCH",body:JSON.stringify(payload)}),
  addAiKey:(name:string,key:string,model?:string)=>request<any>("/api/admin/ai/keys",{method:"POST",body:JSON.stringify({name,key,model})}),
  setAiKey:(id:string,enabled:boolean)=>request<any>(`/api/admin/ai/keys/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({enabled})}),
  deleteAiKey:(id:string)=>request<any>(`/api/admin/ai/keys/${encodeURIComponent(id)}`,{method:"DELETE"})
};

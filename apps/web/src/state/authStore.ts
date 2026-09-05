import { create } from 'zustand';
import type { AuthUser } from '../infrastructure/api/auth';
import { authApi } from '../infrastructure/api/auth';

const AUTH_CACHE_KEY='thi-thu:auth-user';

interface State{
  user:AuthUser|null;
  loading:boolean;
  /** True only after the server has successfully authenticated this session. */
  serverVerified:boolean;
  init:()=>Promise<void>;
  setUser:(u:AuthUser|null)=>void;
  logout:()=>Promise<void>;
}

function readCached():AuthUser|null{
  try{const raw=localStorage.getItem(AUTH_CACHE_KEY);return raw?JSON.parse(raw) as AuthUser:null}catch{return null}
}

export const useAuthStore=create<State>((set)=>({
  user:null,
  loading:true,
  serverVerified:false,
  async init(){
    const cached=readCached();
    if(cached)set({user:cached,serverVerified:false});
    try{
      const r=await authApi.me();
      set({user:r.user,loading:false,serverVerified:Boolean(r.user)});
      if(r.user)localStorage.setItem(AUTH_CACHE_KEY,JSON.stringify(r.user));
      else localStorage.removeItem(AUTH_CACHE_KEY);
    }catch{
      // The normal learning workspace remains offline-first. Administrative
      // routes must check serverVerified and therefore cannot use this cache.
      set({user:cached,loading:false,serverVerified:false});
    }
  },
  setUser(user){
    set({user,serverVerified:Boolean(user)});
    if(user)localStorage.setItem(AUTH_CACHE_KEY,JSON.stringify(user));
    else localStorage.removeItem(AUTH_CACHE_KEY);
  },
  async logout(){
    try{await authApi.logout()}finally{
      localStorage.removeItem(AUTH_CACHE_KEY);
      set({user:null,serverVerified:false,loading:false});
    }
  }
}));

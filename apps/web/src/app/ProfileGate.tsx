import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useProfileStore } from "../state/profileStore";
import { profileService } from "../domain/profile/profile.service";
import { useAuthStore } from "../state/authStore";

export function ProfileGate({ children }: { children: React.ReactNode }) {
  const authUser=useAuthStore(s=>s.user), authLoading=useAuthStore(s=>s.loading), initAuth=useAuthStore(s=>s.init);
  const {activeProfile,profiles,loading,init,refresh,selectProfile}=useProfileStore();
  const [bootstrapping,setBootstrapping]=useState(false);
  useEffect(()=>{void initAuth();void init()},[initAuth,init]);
  useEffect(()=>{
    if(authLoading||loading||!authUser||activeProfile||bootstrapping)return;
    setBootstrapping(true);
    void (async()=>{try{
      const matching=profiles.find(p=>p.name.trim().toLowerCase()===authUser.name.trim().toLowerCase());
      if(matching) await selectProfile(matching.id);
      else {const profile=await profileService.createProfile({name:authUser.name,avatar:"🙂"});await refresh();await selectProfile(profile.id);}
    }finally{setBootstrapping(false)}})();
  },[authLoading,loading,authUser,activeProfile,profiles,bootstrapping,selectProfile,refresh]);
  if(authLoading||loading||bootstrapping)return <div className="min-h-screen grid place-items-center text-gray-400 text-sm">Đang khởi tạo tài khoản...</div>;
  if(!authUser)return <Navigate to="/login" replace />;
  if(!activeProfile)return <div className="min-h-screen grid place-items-center text-gray-400 text-sm">Đang tạo hồ sơ học tập...</div>;
  return <>{children}</>;
}

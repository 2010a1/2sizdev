import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../state/authStore';

/**
 * Admin is deliberately stricter than the normal offline-first workspace.
 * A cached local identity may keep the learning app usable offline, but it
 * must never be sufficient to enter an administrative surface.
 */
export function AdminGuard({children}:{children:ReactNode}){
  const {user,loading,serverVerified}=useAuthStore();
  if(loading)return <div className="min-h-screen grid place-items-center muted text-sm">Đang xác thực quyền quản trị…</div>;
  if(!serverVerified)return <Navigate to="/login?redirect=/admin" replace/>;
  if(!user)return <Navigate to="/login?redirect=/admin" replace/>;
  if(user.role!=='ADMIN')return <Navigate to="/library" replace/>;
  return <>{children}</>;
}

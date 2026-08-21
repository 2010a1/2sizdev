import { useEffect, useState } from 'react';
import type { SyncStatus } from '@exam/shared-types';
import { syncEngine } from '../infrastructure/sync/sync.engine';
import { syncRepository } from '../infrastructure/sync/sync.repository';

export function useSyncStatus(profileId?: string): SyncStatus {
  const [status,setStatus]=useState<SyncStatus>(()=>navigator.onLine?'IDLE':'OFFLINE');
  useEffect(()=>{if(!profileId)return; let disposed=false; const run=async()=>{if(!navigator.onLine){await syncEngine.markOffline(profileId);if(!disposed)setStatus('OFFLINE');return;} const result=await syncEngine.sync(profileId);if(!disposed)setStatus(result);}; void run(); const online=()=>void run(); const offline=()=>{void syncEngine.markOffline(profileId);if(!disposed)setStatus('OFFLINE')}; const focus=()=>void run(); window.addEventListener('online',online);window.addEventListener('offline',offline);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=window.setInterval(async()=>{if(navigator.onLine) await run(); else { const s=await syncRepository.state(profileId); if(!disposed)setStatus(s.status??'OFFLINE'); }},15000);return()=>{disposed=true;window.removeEventListener('online',online);window.removeEventListener('offline',offline);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.clearInterval(timer)}},[profileId]);
  return status;
}

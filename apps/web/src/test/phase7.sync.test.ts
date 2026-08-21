import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../db/database';
import { retryDelay, syncEngine } from '../infrastructure/sync/sync.engine';
import type { SyncPullResponse, SyncPushResponse } from '@exam/shared-types';

beforeEach(async()=>{await db.syncQueue.clear();await db.syncState.clear();await db.exams.clear();await db.questions.clear();});

describe('Phase 7 sync',()=>{
  it('keeps queue on transport failure and uses exponential backoff',async()=>{
    await syncEngine.enqueue({profileId:'p1',entityType:'exam',entityId:'e1',operation:'CREATE',payload:{id:'e1',updatedAt:1},updatedAt:1});
    const transport={push:async()=>{throw new Error('NETWORK')},pull:async(_cursor:number,_profile:string):Promise<SyncPullResponse>=>({cursor:0,changes:[],hasMore:false})};
    expect(await syncEngine.sync('p1',transport)).toBe('ERROR');
    expect(await db.syncQueue.count()).toBe(1);
    const row=await db.syncQueue.toCollection().first(); expect(row?.nextRetryAt).toBeGreaterThan(Date.now()); expect(retryDelay(1)).toBe(1000); expect(retryDelay(8)).toBe(300000);
  });
  it('recovers queue items stranded by transient HTTP errors after deployment/network recovery',async()=>{
    await syncEngine.enqueue({profileId:'p1',entityType:'exam',entityId:'e405',operation:'CREATE',payload:{id:'e405',updatedAt:1},updatedAt:1});
    const row=await db.syncQueue.toCollection().first();
    await db.syncQueue.update(row!.id,{status:'failed',lastError:'HTTP_405',attempts:8,retryCount:8});
    let pushed=false;
    const transport={push:async(_device:string,m:any[]):Promise<SyncPushResponse>=>{pushed=true;return {acknowledgements:[m[0].mutationId],conflicts:[],serverCursor:1}},pull:async():Promise<SyncPullResponse>=>({cursor:1,changes:[],hasMore:false})};
    expect(await syncEngine.sync('p1',transport)).toBe('IDLE');
    expect(pushed).toBe(true);
    expect(await db.syncQueue.count()).toBe(0);
  });
  it('pushes, acknowledges and applies remote changes',async()=>{
    await syncEngine.enqueue({profileId:'p1',entityType:'exam',entityId:'e1',operation:'CREATE',payload:{id:'e1',title:'Remote',subject:'English',updatedAt:10},updatedAt:10});
    let pushed=false;
    const transport={push:async(_device:string,m:any[]):Promise<SyncPushResponse>=>{pushed=true;return {acknowledgements:[m[0].mutationId],conflicts:[],serverCursor:1}},pull:async(_cursor:number,_profile:string):Promise<SyncPullResponse>=>({cursor:2,hasMore:false,changes:[{cursor:2,entityType:'exam',entityId:'e2',profileId:'p1',revision:1,operation:'CREATE',payload:{id:'e2',title:'B',subject:'English'},updatedAt:2,deviceId:'remote'}]})};
    expect(await syncEngine.sync('p1',transport)).toBe('IDLE'); expect(pushed).toBe(true); expect(await db.syncQueue.count()).toBe(0); expect((await db.exams.get('e2'))?.title).toBe('B'); expect((await db.syncState.get('profile:p1'))?.cursor).toBe(2);
  });
  it('rolls back all remote changes when a later record is invalid',async()=>{
    const transport={push:async():Promise<SyncPushResponse>=>({acknowledgements:[],conflicts:[],serverCursor:0}),pull:async(_cursor:number,_profile:string):Promise<SyncPullResponse>=>({cursor:2,hasMore:false,changes:[{cursor:1,entityType:'exam',entityId:'e3',profileId:'p1',revision:1,operation:'CREATE',payload:{id:'e3',title:'ok',subject:'English'},updatedAt:1,deviceId:'r'},{cursor:2,entityType:'question',entityId:'q1',profileId:'p1',revision:1,operation:'CREATE',payload:{id:'q1',examId:'e3',order:0,type:'invalid'},updatedAt:1,deviceId:'r'}]})};
    expect(await syncEngine.sync('p1',transport)).toBe('ERROR'); expect(await db.exams.get('e3')).toBeUndefined(); expect((await db.syncState.get('profile:p1'))?.cursor ?? 0).toBe(0);
  });
});

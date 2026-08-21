import { db } from '../../db/database';
import type { VocabularySet, VocabularySetItem } from '@exam/shared-types';

export const vocabularySetRepository = {
  async create(set: VocabularySet) { await db.vocabularySets.add(set); },
  async get(profileId: string, id: string) { const row=await db.vocabularySets.get(id); return row?.profileId===profileId && !row.deletedAt ? row : undefined; },
  async list(profileId: string) { return db.vocabularySets.where('profileId').equals(profileId).toArray().then(r=>r.filter(x=>!x.deletedAt).sort((a,b)=>b.updatedAt-a.updatedAt)); },
  async update(profileId: string,id:string,patch:Partial<VocabularySet>) { const row=await this.get(profileId,id); if(!row)return false; await db.vocabularySets.update(id,patch); return true; },
  async softDelete(profileId:string,id:string,now=Date.now()) { const row=await this.get(profileId,id); if(!row)return false; await db.transaction('rw',[db.vocabularySets,db.vocabSessions],async()=>{await db.vocabularySets.update(id,{deletedAt:now,updatedAt:now});await db.vocabSessions.where('profileId').equals(profileId).and(s=>s.setId===id&&s.status==='in_progress').modify({status:'abandoned',finishedAt:now});}); return true; },
  async restore(profileId:string,id:string,now=Date.now()) { const row=await db.vocabularySets.get(id); if(!row||row.profileId!==profileId)return false; await db.vocabularySets.update(id,{deletedAt:undefined,updatedAt:now}); return true; },
  async items(profileId:string,setId:string) { const set=await db.vocabularySets.get(setId); if(!set||set.profileId!==profileId)return []; return db.vocabularySetItems.where('[profileId+setId]').equals([profileId,setId]).toArray().then(r=>r.sort((a,b)=>a.position-b.position)); },
  async addItem(item:VocabularySetItem) { await db.vocabularySetItems.put(item); },
  async removeItem(profileId:string,setId:string,vocabularyId:string) { const items=await this.items(profileId,setId); const target=items.find(i=>i.vocabularyId===vocabularyId); if(!target)return false; await db.vocabularySetItems.delete(target.id); return true; },
  async replaceItems(profileId:string,setId:string,items:VocabularySetItem[],now=Date.now()) { const set=await this.get(profileId,setId); if(!set) return false; await db.transaction('rw',[db.vocabularySets,db.vocabularySetItems],async()=>{ await db.vocabularySetItems.where('[profileId+setId]').equals([profileId,setId]).delete(); if(items.length)await db.vocabularySetItems.bulkAdd(items); await db.vocabularySets.update(setId,{wordCount:items.length,updatedAt:now,version:set.version+1}); }); return true; },
  async updateWordCount(profileId:string,setId:string,wordCount:number,now=Date.now()) { const set=await this.get(profileId,setId); if(!set)return false; await db.vocabularySets.update(setId,{wordCount,updatedAt:now,version:set.version+1}); return true; },
  async findItem(profileId:string,setId:string,vocabularyId:string) { const rows=await db.vocabularySetItems.where('[profileId+setId]').equals([profileId,setId]).toArray(); return rows.find(r=>r.vocabularyId===vocabularyId); },
  async sessions(profileId:string,setId:string) { return db.vocabSessions.where('profileId').equals(profileId).toArray().then(rows=>rows.filter(s=>s.setId===setId).sort((a,b)=>b.startedAt-a.startedAt)); },
  async sessionAnswersForSet(profileId:string,setId:string) { const sessions=await this.sessions(profileId,setId); if(!sessions.length)return []; return db.vocabSessionAnswers.where('sessionId').anyOf(sessions.map(s=>s.id)).toArray(); }
};

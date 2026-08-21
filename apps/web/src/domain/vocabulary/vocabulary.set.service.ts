import { generateId } from '@exam/utils';
import { VocabularySetInputSchema } from '@exam/schemas';
import type { Vocabulary, VocabularySet, VocabularySetItem } from '@exam/shared-types';
import { vocabularyRepository } from './vocabulary.repository';
import { vocabularySetRepository } from './vocabulary.set.repository';
import { vocabularyService } from './vocabulary.service';
import { DuplicateVocabularyError, VocabularyNotFoundError, VocabularyValidationError } from './vocabulary.errors';
import { selectSmartQuestions, calculateSetStats } from './vocabulary.smart-selection';
import type { SmartSelectionInput, VocabularySetDetail, VocabularySetInput } from './vocabulary.set.types';
import { localMutationService } from '../../infrastructure/sync/local-mutation.service';
import { normalizeEnglish, normalizeVietnamese } from './vocabulary.normalizer';

function id(v:string,label:string){if(!v||v.trim()!==v||v.length>200)throw new VocabularyValidationError(`${label} không hợp lệ.`);}
function clean(input:VocabularySetInput):VocabularySetInput { const parsed=VocabularySetInputSchema.safeParse(input); if(!parsed.success)throw new VocabularyValidationError(parsed.error.issues[0]?.message??'Dữ liệu bộ từ không hợp lệ.'); const name=parsed.data.name.trim().replace(/\s+/g,' '),description=parsed.data.description?.trim().replace(/\s+/g,' '); return {name,description}; }


export const vocabularySetService={
  async create(profileId:string,input:VocabularySetInput,now=Date.now()){id(profileId,'Profile');const c=clean(input);const set:VocabularySet={id:generateId('vset'),profileId,name:c.name,description:c.description,createdAt:now,updatedAt:now,wordCount:0,version:1};await vocabularySetRepository.create(set); void localMutationService.vocabularySet(set.id, 'CREATE', profileId); return set;},
  async get(profileId:string,setId:string){id(profileId,'Profile');id(setId,'Set ID');const set=await vocabularySetRepository.get(profileId,setId);if(!set)throw new VocabularyNotFoundError();return set;},
  async list(profileId:string){id(profileId,'Profile');return vocabularySetRepository.list(profileId);},
  async update(profileId:string,setId:string,input:VocabularySetInput,now=Date.now()){const set=await this.get(profileId,setId);const c=clean(input);await vocabularySetRepository.update(profileId,setId,{name:c.name,description:c.description,updatedAt:now}); void localMutationService.vocabularySet(setId, 'UPDATE', profileId); return {...set,...c,updatedAt:now};},
  async delete(profileId:string,setId:string,now=Date.now()){const ok=await vocabularySetRepository.softDelete(profileId,setId,now);if(!ok)throw new VocabularyNotFoundError(); void localMutationService.vocabularySet(setId, 'DELETE', profileId);},
  async restore(profileId:string,setId:string,now=Date.now()){const ok=await vocabularySetRepository.restore(profileId,setId,now);if(!ok)throw new VocabularyNotFoundError(); void localMutationService.vocabularySet(setId, 'UPDATE', profileId);},
  async detail(profileId:string,setId:string):Promise<VocabularySetDetail>{const set=await this.get(profileId,setId);const items=await vocabularySetRepository.items(profileId,setId);const vocabularies=(await Promise.all(items.map(i=>vocabularyRepository.get(profileId,i.vocabularyId)))).filter((v):v is Vocabulary=>!!v&&!v.deletedAt);return {set,items:items.filter(i=>vocabularies.some(v=>v.id===i.vocabularyId)),vocabularies};},
  async addVocabulary(profileId:string,setId:string,vocabularyId:string,now=Date.now()){await this.get(profileId,setId);id(vocabularyId,'Vocabulary ID');const vocabulary=await vocabularyService.get(profileId,vocabularyId);if(!vocabulary)throw new VocabularyNotFoundError();if(await vocabularySetRepository.findItem(profileId,setId,vocabularyId))throw new DuplicateVocabularyError();const items=await vocabularySetRepository.items(profileId,setId);const item:VocabularySetItem={id:generateId('vsetitem'),setId,profileId,vocabularyId,position:items.length,createdAt:now,updatedAt:now};await vocabularySetRepository.addItem(item);await vocabularySetRepository.updateWordCount(profileId,setId,items.length+1,now); void localMutationService.vocabularySetItem(item.id, 'CREATE', profileId); void localMutationService.vocabularySet(setId, 'UPDATE', profileId); return item;},
  async removeVocabulary(profileId:string,setId:string,vocabularyId:string,now=Date.now()){await this.get(profileId,setId);const removed=await vocabularySetRepository.findItem(profileId,setId,vocabularyId);await vocabularySetRepository.removeItem(profileId,setId,vocabularyId);if(removed) void localMutationService.vocabularySetItem(removed.id, 'DELETE', profileId);const items=await vocabularySetRepository.items(profileId,setId);const normalized=items.map((x,i)=>({...x,position:i,updatedAt:now}));await vocabularySetRepository.replaceItems(profileId,setId,normalized,now); for (const item of normalized) void localMutationService.vocabularySetItem(item.id, 'UPDATE', profileId); void localMutationService.vocabularySet(setId, 'UPDATE', profileId);},
  async reorderVocabulary(profileId:string,setId:string,orderedVocabularyIds:string[],now=Date.now()){const detail=await this.detail(profileId,setId);const current=new Set(detail.items.map(i=>i.vocabularyId));if(orderedVocabularyIds.length!==current.size||orderedVocabularyIds.some(x=>!current.has(x)))throw new VocabularyValidationError('Thứ tự từ không hợp lệ.');const map=new Map(detail.items.map(i=>[i.vocabularyId,i]));const items=orderedVocabularyIds.map((vocabularyId,position)=>({...map.get(vocabularyId)!,position,updatedAt:now}));await vocabularySetRepository.replaceItems(profileId,setId,items,now); for (const item of items) void localMutationService.vocabularySetItem(item.id, 'UPDATE', profileId); void localMutationService.vocabularySet(setId, 'UPDATE', profileId);},
  async addBulkVocabulary(profileId:string,setId:string,entries:Array<{english:string;vietnamese:string}>,now=Date.now()){
    await this.get(profileId,setId);
    const unique=new Map<string,{english:string;vietnamese:string}>();
    for(const raw of entries){
      const english=raw.english.trim(), vietnamese=raw.vietnamese.trim();
      if(!english||!vietnamese) continue;
      const key=`${english.toLocaleLowerCase('en-US')}::${vietnamese.toLocaleLowerCase('vi-VN')}`;
      if(!unique.has(key)) unique.set(key,{english,vietnamese});
    }
    const created:string[]=[]; const alreadyInSet:string[]=[]; const failed:Array<{english:string;reason:string}>=[];
    // Deliberately sequential: set positions and wordCount are stateful and must not race.
    for(const entry of unique.values()){
      try{
        const rows=await vocabularyRepository.list(profileId);
        const normalizedEnglish=normalizeEnglish(entry.english);
        const normalizedVietnamese=normalizeVietnamese(entry.vietnamese);
        let vocab=rows.find(v=>v.normalizedEnglish===normalizedEnglish&&v.normalizedVietnamese===normalizedVietnamese);
        if(!vocab) vocab=await vocabularyService.create(profileId,entry,now);
        const existing=await vocabularySetRepository.findItem(profileId,setId,vocab.id);
        if(existing){alreadyInSet.push(entry.english); continue;}
        await this.addVocabulary(profileId,setId,vocab.id,now);
        created.push(entry.english);
      }catch(error){ failed.push({english:entry.english,reason:error instanceof Error?error.message:'Lỗi không xác định'}); }
    }
    return {requested:unique.size,added:created.length,created,alreadyInSet,failed};
  },
  async questions(profileId:string,setId:string){const detail=await this.detail(profileId,setId);const rows=await Promise.all(detail.vocabularies.map(v=>vocabularyRepository.questions(profileId,v.id)));const generations=new Map(detail.vocabularies.map(v=>[v.id,v.generation]));return rows.flat().filter(q=>!q.deletedAt&&q.vocabularyGeneration===generations.get(q.vocabularyId));},
  async progress(profileId:string,setId:string){const detail=await this.detail(profileId,setId);const rows=await Promise.all(detail.vocabularies.map(v=>vocabularyRepository.getProgress(profileId,v.id,v.generation)));return rows.flat();},
  async stats(profileId:string,setId:string){const detail=await this.detail(profileId,setId);return calculateSetStats(await this.progress(profileId,setId),detail.vocabularies.map(v=>v.id));},
  async history(profileId:string,setId:string){await this.get(profileId,setId);return vocabularySetRepository.sessions(profileId,setId);},
  select(input:SmartSelectionInput){return selectSmartQuestions(input);}
};

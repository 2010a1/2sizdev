import JSZip from 'jszip';
import { db } from '../db/database';

const BACKUP_VERSION = 1;
const RESTORE_TABLES = ['profiles','exams','questions','attempts','answers','vocabularies','vocabQuestions','vocabProgress','vocabSessions','vocabSessionAnswers','examAssets','vocabularySets','vocabularySetItems','sharedExams','settings'] as const;
type BackupPayload = { format:'exam-platform-backup'; version:number; exportedAt:number; tables:Record<string,unknown[]> };
export type BackupPreview = BackupPayload & { conflicts:Record<string,number>; totalRows:number };

function bytesToBase64(bytes:Uint8Array):string{let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));return btoa(binary);}
function base64ToBytes(value:string):Uint8Array{const binary=atob(value);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;}
/** Restore binary asset data: base64 strings decode cleanly; legacy plain-object
 *  forms (produed by older builds whose JSON.stringify mangled Uint8Array) are
 *  rebuilt from their integer keys, which ES spec orders ascending. */
function reviveAssetData(data:unknown):unknown{
  if(data instanceof Uint8Array)return data;
  if(typeof data==='string'){try{return base64ToBytes(data)}catch{return data}}
  if(data&&typeof data==='object'&&!Array.isArray(data)){const entries=Object.entries(data as Record<string,unknown>).filter(([k])=>/^\d+$/.test(k));if(entries.length)return Uint8Array.from(entries.map(([,v])=>Number(v)));}
  return data;
}

async function snapshot():Promise<BackupPayload>{const tables:Record<string,unknown[]>={};for(const name of RESTORE_TABLES){const rows=await (db as any).table(name).toArray();tables[name]=name==='examAssets'?rows.map((row:any)=>({...row,data:row.data instanceof Uint8Array?bytesToBase64(row.data):row.data})):rows;}return {format:'exam-platform-backup',version:BACKUP_VERSION,exportedAt:Date.now(),tables};}
export async function exportLocalBackup(format:'json'|'zip'='json'):Promise<Blob>{const payload=await snapshot();const json=JSON.stringify(payload);if(format==='json')return new Blob([json],{type:'application/json'});const zip=new JSZip();zip.file('backup.json',json,{date:new Date(payload.exportedAt)});return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});}

function assertString(row:any,key:string,table:string,required=true){if(row[key]===undefined&&!required)return;if(typeof row[key]!=='string'||row[key].length===0||row[key].length>1000)throw new Error(`Dữ liệu bảng ${table} chứa ${key} không hợp lệ.`)}
function assertRow(table:string,row:any){
  assertString(row,'id',table);
  // Only tables whose rows actually carry profileId (see db schema). Exams/questions/answers/examAssets are per-device rows with no profileId column — requiring it here rejected the app's own exports on restore.
  if(['attempts','vocabularies','vocabQuestions','vocabProgress','vocabSessions','vocabularySets','vocabularySetItems'].includes(table)) assertString(row,'profileId',table);
  if(table==='questions'||table==='examAssets') assertString(row,'examId',table);
  if(table==='attempts') assertString(row,'examId',table);
  if(table==='answers') assertString(row,'attemptId',table);
  if(table==='vocabQuestions'||table==='vocabProgress') assertString(row,'vocabularyId',table);
  if(table==='vocabSessions') assertString(row,'vocabularyId',table);
  if(table==='vocabSessionAnswers') assertString(row,'sessionId',table);
  if(table==='vocabularySets' && (typeof row.name!=='string'||row.name.length>500)) throw new Error(`Dữ liệu bảng ${table} chứa name không hợp lệ.`);
  if(table==='vocabularySetItems'){assertString(row,'setId',table);assertString(row,'vocabularyId',table);}
  if(table==='settings' && (typeof row.key!=='string'||row.key.length>500)) throw new Error('Dữ liệu settings không hợp lệ.');
  const timestamps=['createdAt','updatedAt','startedAt','finishedAt','answeredAt','lastAttemptAt','lastCorrectAt','lastWrongAt','downloadedAt','importedAt','lastActiveAt'];
  for(const key of timestamps) if(row[key]!==undefined && (!Number.isFinite(row[key]) || row[key]<0)) throw new Error(`Dữ liệu bảng ${table} chứa ${key} không hợp lệ.`);
}

async function readBackupText(file:File){
  if(file.size>100*1024*1024)throw new Error('File backup quá lớn.');
  const isZip=file.name.toLowerCase().endsWith('.zip');
  if(!isZip)return file.text();
  let zip:JSZip;try{zip=await JSZip.loadAsync(file,{checkCRC32:true});}catch{throw new Error('File ZIP backup không hợp lệ.');}
  const entry=zip.file('backup.json');if(!entry)throw new Error('ZIP backup thiếu backup.json.');
  const text=await entry.async('string');if(text.length>100*1024*1024)throw new Error('Nội dung backup sau giải nén quá lớn.');return text;
}

export async function parseBackup(file:File):Promise<BackupPreview>{
  const text=await readBackupText(file);let value:any;try{value=JSON.parse(text)}catch{throw new Error('Backup không phải JSON hợp lệ.')}
  if(value?.format!=='exam-platform-backup'||value?.version!==BACKUP_VERSION||!Number.isFinite(value?.exportedAt)||!value?.tables||typeof value.tables!=='object'||Array.isArray(value.tables))throw new Error('Backup không đúng format hoặc version không được hỗ trợ.');const unknownTables=Object.keys(value.tables).filter(name=>!(RESTORE_TABLES as readonly string[]).includes(name));if(unknownTables.length)throw new Error(`Backup chứa bảng không được hỗ trợ: ${unknownTables.join(', ')}`);
  let totalRows=0;const conflicts:Record<string,number>={};
  for(const name of RESTORE_TABLES){const rows=value.tables[name]??[];if(!Array.isArray(rows))throw new Error(`Dữ liệu bảng ${name} không hợp lệ.`);if(rows.length>100000||totalRows+rows.length>100000)throw new Error('Backup chứa quá nhiều bản ghi.');const seen=new Set<string>();for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`Dữ liệu bảng ${name} chứa row không hợp lệ.`);assertRow(name,row);if(seen.has(row.id))throw new Error(`Backup chứa ID trùng trong bảng ${name}.`);seen.add(row.id);}totalRows+=rows.length;if(rows.length){const ids=rows.map((r:any)=>r.id);let count=0;for(let i=0;i<ids.length;i+=1000){const existing=await (db as any).table(name).bulkGet(ids.slice(i,i+1000));count+=existing.filter(Boolean).length;}if(count)conflicts[name]=count;}}
  return {...value,conflicts,totalRows};
}

export async function restoreLocalBackup(file:File,mode:'merge'|'replace'='merge'){const backup=await parseBackup(file);const restoreTables = RESTORE_TABLES.map(name => (db as any).table(name)) as [any, ...any[]]; await (db as any).transaction('rw', ...restoreTables, async () => {if(mode==='replace')for(const name of RESTORE_TABLES)await (db as any).table(name).clear();for(const name of RESTORE_TABLES){const rows=backup.tables[name]??[];if(!rows.length)continue;const revived=name==='examAssets'?rows.map((row:any)=>({...row,data:reviveAssetData(row.data)})):rows;if(mode==='replace'){await (db as any).table(name).bulkPut(revived);continue;}const ids=revived.map((r:any)=>r.id);const existing=new Set<string>();for(let i=0;i<ids.length;i+=1000){const current=await (db as any).table(name).bulkGet(ids.slice(i,i+1000));current.forEach((row:any)=>{if(row?.id)existing.add(row.id)});}const fresh=revived.filter((r:any)=>!existing.has(r.id));if(fresh.length)await (db as any).table(name).bulkPut(fresh);}});return {conflicts:backup.conflicts,totalRows:backup.totalRows};}

import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProfileStore } from '../../state/profileStore';
import { vocabularySetController } from '../../domain/vocabulary/vocabulary.set.controller';
import type { VocabularySetDetail } from '../../domain/vocabulary/vocabulary.set.types';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { expandBulkInput } from '../../domain/vocabulary/vocabulary.dictionary';
import { vocabularyApi } from '../../infrastructure/api/vocabulary';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function VocabularySetFormPage(){
 const {setId}=useParams(); const profile=useProfileStore(s=>s.activeProfile)!; const nav=useNavigate();
 const [name,setName]=useState(''); const [description,setDescription]=useState(''); const [detail,setDetail]=useState<VocabularySetDetail>(); const [bulk,setBulk]=useState(''); const [busy,setBusy]=useState(false); const [translating,setTranslating]=useState(false); const [error,setError]=useState('');
 const online=useOnlineStatus();
 const load=async()=>{if(!setId)return;try{const d=await vocabularySetController.detail(profile.id,setId);setDetail(d);setName(d.set.name);setDescription(d.set.description??'')}catch(e){setError(e instanceof Error?e.message:'Không thể tải bộ từ')}};
 useEffect(()=>{if(setId)void load()},[profile.id,setId]);
 async function save(e:FormEvent){e.preventDefault();try{const s=setId?await vocabularySetController.update(profile.id,setId,{name,description}):await vocabularySetController.create(profile.id,{name,description});nav(`/vocabulary/sets/${s.id}${setId?'/edit':''}`)}catch(e){setError(e instanceof Error?e.message:'Không thể lưu')}}
 async function addBulk(){if(!setId)return;const{entries:parsed,unknown}=expandBulkInput(bulk);if(!parsed.length){setError('Dùng dạng từ:nghĩa, mỗi dòng một từ hoặc ngăn cách bằng dấu phẩy');return}try{setBusy(true);setError('');const r=await vocabularySetController.addBulkVocabulary(profile.id,setId,parsed);setBulk(unknown.join('\n'));await load();const missing=unknown.length?` Chưa có nghĩa (bạn tự điền): ${unknown.join(', ')}.`:'';if(r.failed.length)setError(`Đã thêm ${r.added}/${r.requested}. Không thêm được: ${r.failed.map(x=>x.english).join(', ')}.${missing}`);else if(missing)setError(`Đã thêm ${r.added} từ.${missing}`)}catch(e){setError(e instanceof Error?e.message:'Không thể thêm từ')}finally{setBusy(false)}}
 async function autoTranslate(){
   if(!online)return;
   const{entries:parsed,unknown}=expandBulkInput(bulk);
   const bare=[...new Set(unknown)];
   if(!bare.length){setError('Mọi từ đã có nghĩa.');return}
   setTranslating(true);setError('');
   try{
     const r=await vocabularyApi.translate(bare);
     const map=r.translations ?? {};
     // rebuild the textarea from the SAME word set: translated words become
     // word:nghĩa pairs, failures stay as bare lines — nothing is dropped.
     const text=[...parsed.map(x=>`${x.english}:${x.vietnamese}`),...bare.map(w=>map[w]?`${w}:${map[w]}`:w)].join('\n');
     setBulk(text);
     const missed=bare.filter(w=>!map[w]);
     if(missed.length)setError(`Không tra được nghĩa (tự điền giúp): ${missed.join(', ')}`);
   }catch(e){setError(e instanceof Error?e.message:'Không dịch được — kiểm tra kết nối mạng.')}finally{setTranslating(false)}
 }
 async function removeWord(vocabularyId:string){if(!setId||!confirm('Xóa từ này khỏi bộ?'))return;try{await vocabularySetController.removeVocabulary(profile.id,setId,vocabularyId);await load()}catch(e){setError(e instanceof Error?e.message:'Không thể xóa từ')}}
 async function move(index:number,delta:number){if(!setId||!detail)return;const next=[...detail.items].sort((a,b)=>a.position-b.position);const j=index+delta;if(j<0||j>=next.length)return;[next[index],next[j]]=[next[j],next[index]];try{await vocabularySetController.reorderVocabulary(profile.id,setId,next.map(x=>x.vocabularyId));await load()}catch(e){setError(e instanceof Error?e.message:'Không thể sắp xếp')}}
 return <div className="page-stack max-w-5xl mx-auto">
   {setId
     ? <Breadcrumbs items={[{ label: 'Trang chủ', to: '/' }, { label: 'Từ vựng', to: '/vocabulary' }, { label: 'Bộ từ', to: '/vocabulary/sets' }, { label: detail?.set.name ?? 'Bộ từ', to: `/vocabulary/sets/${setId}` }, { label: 'Chỉnh sửa bộ từ' }]} />
     : <Breadcrumbs items={[{ label: 'Trang chủ', to: '/' }, { label: 'Từ vựng', to: '/vocabulary' }, { label: 'Bộ từ', to: '/vocabulary/sets' }, { label: 'Tạo bộ từ' }]} />}
   <section className="card"><span className="eyebrow">CHỈNH SỬA</span><h1 className="text-2xl font-bold mt-2">{setId?'Chỉnh sửa bộ từ':'Tạo bộ từ'}</h1><form className="grid gap-3 mt-5" onSubmit={save}><label className="block text-sm font-semibold">Tên<input className="input mt-1" value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></label><label className="block text-sm font-semibold">Mô tả<textarea className="input mt-1 min-h-24" value={description} onChange={e=>setDescription(e.target.value)} maxLength={500}/></label><div><button className="btn-primary" type="submit">Lưu bộ từ</button></div></form></section>
   {setId&&detail&&<section className="card"><div className="section-heading"><div><h2>Các từ trong bộ ({detail.vocabularies.length})</h2><p>Đây là nơi duy nhất hiển thị từng từ để chỉnh sửa.</p></div></div><div className="bulk-vocab-editor"><textarea className="input min-h-28" placeholder={'happy:hạnh phúc\napple:quả táo\nhello:xin chào'} value={bulk} onChange={e=>setBulk(e.target.value)}/><div className="flex items-center justify-between gap-3 mt-2"><span className="text-xs muted">Dùng <b>:</b> giữa từ và nghĩa; mỗi dòng một từ hoặc ngăn cách bằng dấu phẩy. Chỉ gõ từ tiếng Anh (mỗi dòng hoặc cách nhau bằng dấu phẩy) rồi bấm <b>Tự dịch</b>{online?<> — từ điển online tự điền nghĩa.</>:<> — <b>cần kết nối Internet</b>, hiện đang offline nên nút bị ẩn.</>}</span><div className="flex gap-2">{online&&<button type="button" className="btn-secondary" disabled={!bulk.trim()||translating} onClick={()=>void autoTranslate()}>{translating?'Đang dịch…':'Tự dịch'}</button>}<button type="button" className="btn-primary" disabled={busy||!bulk.trim()} onClick={()=>void addBulk()}>{busy?'Đang thêm…':'Thêm nhanh'}</button></div></div></div><div className="vocab-edit-list">{detail.vocabularies.map((v,i)=><div className="vocab-edit-row" key={v.id}><span className="vocab-edit-number">{i+1}</span><div className="min-w-0 flex-1"><strong>{v.english}</strong><span>{v.vietnamese}</span></div><Link className="btn-secondary text-xs" to={`/vocabulary/${v.id}/edit`}>Sửa</Link><button type="button" className="btn-secondary text-xs" onClick={()=>void move(i,-1)} disabled={i===0}>↑</button><button type="button" className="btn-secondary text-xs" onClick={()=>void move(i,1)} disabled={i===detail.vocabularies.length-1}>↓</button><button type="button" className="btn-secondary text-xs text-grade" onClick={()=>void removeWord(v.id)}>Xóa</button></div>)}</div></section>}
   {error&&<p className="text-sm text-grade">{error}</p>}
 </div>;
}

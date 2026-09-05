import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProfileStore } from '../../state/profileStore';
import { vocabularySetController } from '../../domain/vocabulary/vocabulary.set.controller';
import { vocabularySetSessionController } from '../../domain/vocabulary/vocabulary.set.session.controller';
import type { VocabularySetDetail } from '../../domain/vocabulary/vocabulary.set.types';
import { createVocabularyShare } from '../../domain/share/vocabulary-share.service';
import { Skeleton } from '../components/Skeleton';
import { AppIcon } from '../components/AppIcon';
import { Breadcrumbs } from '../components/Breadcrumbs';

export function VocabularySetDetailPage(){
 const {setId}=useParams(); const profile=useProfileStore(s=>s.activeProfile)!; const nav=useNavigate();
 const [detail,setDetail]=useState<VocabularySetDetail>(); const [stats,setStats]=useState<Awaited<ReturnType<typeof vocabularySetController.stats>>>(); const [error,setError]=useState(''); const [active,setActive]=useState(false); const [shareBusy,setShareBusy]=useState(false); const [shareCode,setShareCode]=useState('');
 const load=async()=>{if(!setId)return;try{const [d,s,session]=await Promise.all([vocabularySetController.detail(profile.id,setId),vocabularySetController.stats(profile.id,setId),vocabularySetSessionController.resume(profile.id,setId)]);setDetail(d);setStats(s);setActive(!!session);}catch(e){setError(e instanceof Error?e.message:'Không thể tải bộ từ')}};
 useEffect(()=>{void load()},[profile.id,setId]);
 if(error)return <div className="card text-grade">{error}</div>; if(!detail)return <div className="page-stack max-w-5xl mx-auto"><div className="card space-y-5"><Skeleton className="h-4 w-28"/><Skeleton className="h-10 w-2/3"/><Skeleton className="h-4 w-1/2"/><div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">{[0,1,2,3].map(i=><Skeleton key={i} className="h-16 rounded-xl"/>)}</div></div><div className="card space-y-4"><Skeleton className="h-4 w-24"/><div className="vocab-mode-grid">{[0,1,2,3].map(i=><Skeleton key={i} className="h-24 rounded-xl"/>)}</div></div></div>;
 async function shareVocabulary(){if(!detail)return;try{setShareBusy(true);setError('');const result=await createVocabularyShare(profile.id,detail.set.id);setShareCode(result.shareCode);try{await navigator.clipboard.writeText(`${window.location.origin}/share/${result.shareCode}`)}catch{}}catch(e){setError(e instanceof Error?e.message:'Không thể chia sẻ bộ từ')}finally{setShareBusy(false)}}
 async function start(mode:'ALL'|'WEAK'|'WRONG'|'NEW'){if(!detail)return;try{const current=await vocabularySetSessionController.resume(profile.id,detail.set.id);if(current){nav(`/vocabulary/sets/${detail.set.id}/practice`);return;}await vocabularySetSessionController.create(profile.id,detail.set.id,{mode,requestedCount:'all',questionTypes:['MC_EN_TO_VI','TEXT_EN_TO_VI','TEXT_VI_TO_EN','LETTER_ORDER']});nav(`/vocabulary/sets/${detail.set.id}/practice`)}catch(e){setError(e instanceof Error?e.message:'Không thể bắt đầu')}}
 return <div className="page-stack max-w-5xl mx-auto">
   <Breadcrumbs items={[{ label: 'Trang chủ', to: '/' }, { label: 'Từ vựng', to: '/vocabulary' }, { label: 'Bộ từ', to: '/vocabulary/sets' }, { label: detail.set.name }]} />
   <section className="card">
     <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"><div><span className="eyebrow">BỘ TỪ VỰNG</span><h1 className="text-3xl font-extrabold tracking-tight mt-2">{detail.set.name}</h1><p className="text-sm muted mt-2">{detail.set.description||'Bộ từ học tập offline-first.'}</p></div><Link className="btn-secondary" to={`/vocabulary/sets/${detail.set.id}/edit`}><AppIcon name="edit" size={16}/>Chỉnh sửa</Link></div>
     <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6"><div className="vocab-stat"><strong>{detail.vocabularies.length}</strong><span>Từ trong bộ</span></div><div className="vocab-stat"><strong>{stats?.mastery??0}%</strong><span>Độ thành thạo</span></div><div className="vocab-stat"><strong>{stats?.learned??0}</strong><span>Đã học</span></div><div className="vocab-stat"><strong>{stats?.newCount??0}</strong><span>Từ mới</span></div></div>
   </section>
   <section className="card vocab-practice-launch">
     <div><span className="eyebrow">HỌC NGAY</span><h2>Chọn cách luyện bộ từ</h2><p>Làm bộ từ trực tiếp. Danh sách từng từ chỉ xuất hiện trong màn hình chỉnh sửa.</p></div>
     <div className="vocab-mode-grid"><button className="vocab-mode-card primary" onClick={()=>start('ALL')} disabled={!detail.vocabularies.length}><span><AppIcon name="play" size={18}/></span><strong>{active?'Tiếp tục luyện':'Luyện toàn bộ'}</strong><small>{detail.vocabularies.length} từ · 4 dạng câu hỏi</small></button><button className="vocab-mode-card" onClick={()=>start('NEW')} disabled={!stats?.newCount}><span><AppIcon name="spark" size={18}/></span><strong>Từ mới</strong><small>Ưu tiên những từ chưa học</small></button><button className="vocab-mode-card" onClick={()=>start('WEAK')} disabled={!stats?.weak}><span><AppIcon name="arrow" size={18}/></span><strong>Từ yếu</strong><small>Ôn lại từ có mastery thấp</small></button><button className="vocab-mode-card" onClick={()=>start('WRONG')} disabled={!stats?.wrong}><span><AppIcon name="refresh" size={18}/></span><strong>Câu sai</strong><small>Tập trung vào lỗi trước đó</small></button></div>
   </section>
   <section className="card"><div className="section-heading"><div><h2>Quản lý bộ từ</h2><p>Chỉnh tên, thêm từ, sắp xếp và sửa từng từ ở màn hình chỉnh sửa.</p></div><Link className="btn-primary" to={`/vocabulary/sets/${detail.set.id}/edit`}>Mở trình chỉnh sửa</Link></div></section>
   <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={!detail.vocabularies.length||shareBusy} onClick={()=>void shareVocabulary()}>{shareBusy?'Đang chia sẻ...':'Chia sẻ bộ từ'}</button>{shareCode&&<span className="share-code-chip">Mã: <b>{shareCode}</b></span>}</div>
   {error&&<p className="text-sm text-grade">{error}</p>}
 </div>;
}

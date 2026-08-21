import { useState } from 'react';
import { examFileService, type ExamImportPreview } from '../../../domain/exam/exam.file.service';
import { useNavigate } from 'react-router-dom';

export function ExamFileImportDialog({ onClose, onImported }: { onClose:()=>void; onImported:()=>void }) {
  const [preview, setPreview] = useState<ExamImportPreview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const select = async (file?: File) => {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith('.exam')) throw new Error('Chỉ hỗ trợ file .exam');
      setPreview(await examFileService.previewImport(file));
    } catch (e) { setError(e instanceof Error ? e.message : 'File .exam không hợp lệ'); }
    finally { setBusy(false); }
  };
  const confirm = async (copy = false) => {
    if (!preview) return;
    setBusy(true); setError('');
    try { const exam = await examFileService.importConfirmed(preview, copy); onImported(); onClose(); nav(`/library/${exam.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể nhập đề'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center">
    <div className="card w-full max-w-lg space-y-4 bg-white">
      <div className="flex justify-between"><h2 className="text-xl font-bold">Nhập đề .exam</h2><button onClick={onClose}>✕</button></div>
      {!preview ? <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer"><input type="file" accept=".exam,application/zip" className="hidden" onChange={e=>select(e.target.files?.[0])}/><div className="text-lg">Chọn hoặc kéo file .exam vào đây</div><div className="text-sm text-gray-500 mt-2">File sẽ được kiểm tra trước khi lưu vào thiết bị.</div></label> : <div className="space-y-3 text-sm">
        <div className="card"><div className="text-lg font-semibold">{preview.imported.content.title}</div><div>{preview.imported.content.subject}{preview.imported.content.grade ? ` · Lớp ${preview.imported.content.grade}` : ''}</div><div>{preview.imported.content.questionCount} câu · {preview.imported.content.duration !== undefined ? `${preview.imported.content.duration/60} phút` : 'Không giới hạn'}</div><div>Nguồn gốc: {preview.imported.content.source} → nhập sẽ thành <b>local</b></div><div>Format: v{preview.imported.formatVersion} · {preview.imported.assets.length} assets · {(preview.fileSize/1024/1024).toFixed(2)} MB</div><div className="text-xs break-all mt-1">Hash: {preview.imported.contentHash}</div></div>
        {preview.duplicate && <div className="rounded bg-yellow-50 p-3">Đề này đã tồn tại. Bạn có thể nhập thành bản sao.</div>}
        <div className="flex gap-2 justify-end"><button className="btn-secondary" onClick={()=>setPreview(undefined)} disabled={busy}>Chọn file khác</button>{preview.duplicate && <button className="btn-primary" onClick={()=>confirm(true)} disabled={busy}>Nhập thành bản sao</button>}{!preview.duplicate && <button className="btn-primary" onClick={()=>confirm(false)} disabled={busy}>Nhập đề</button>}</div>
      </div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {busy && <div className="text-xs text-gray-500">Đang xử lý...</div>}
    </div>
  </div>;
}

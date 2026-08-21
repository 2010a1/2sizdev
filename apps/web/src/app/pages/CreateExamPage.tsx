import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExamDraftSchema } from '@exam/schemas';
import { examService } from '../../domain/exam/exam.service';
import { GeminiPromptPanel } from '../components/exam/GeminiPromptPanel';
import { RichContent } from '../components/exam/RichContent';
import { AppIcon } from '../components/AppIcon';

// Keep the template as a literal JSON string. Do NOT build it from an object and
// never pass an object into the textarea state; this prevents "[object Object]".
const SAMPLE = `{
  "title": "Đề mẫu — Lịch sử Việt Nam",
  "description": "Template JSON để nhập trực tiếp hoặc dùng làm định dạng đầu ra cho AI.",
  "subject": "Lịch sử",
  "grade": 12,
  "duration": 1800,
  "questions": [
    {
      "id": "q1",
      "type": "ABCD",
      "content": "Thủ đô của Việt Nam là gì?",
      "points": 1,
      "options": [
        {
          "id": "q1_o1",
          "text": "Hà Nội"
        },
        {
          "id": "q1_o2",
          "text": "Huế"
        },
        {
          "id": "q1_o3",
          "text": "Đà Nẵng"
        },
        {
          "id": "q1_o4",
          "text": "TP. Hồ Chí Minh"
        }
      ],
      "correctOptionId": "q1_o1",
      "explanation": "Hà Nội là thủ đô của Việt Nam."
    },
    {
      "id": "q2",
      "type": "TRUE_FALSE",
      "content": "Hà Nội là thủ đô của Việt Nam.",
      "points": 1,
      "correctAnswer": true,
      "explanation": "Mệnh đề đúng."
    },
    {
      "id": "q3",
      "type": "SHORT_ANSWER",
      "content": "Thủ đô của Việt Nam là gì?",
      "points": 1,
      "correctAnswers": [
        "Hà Nội",
        "Ha Noi"
      ],
      "caseSensitive": false,
      "explanation": "Đáp án chấp nhận: Hà Nội hoặc Ha Noi."
    }
  ]
}`;

function normalizeJsonSource(source: unknown): string {
  if (typeof source === 'string') return source;
  // Defensive fallback for old callers/state: never feed an object to JSON.parse.
  if (source && typeof source === 'object') return JSON.stringify(source);
  return String(source ?? '');
}

export function CreateExamPage() {
  const nav = useNavigate();
  const [json, setJson] = useState<string>(SAMPLE);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);
  const [preview, setPreview] = useState<any>();
  const [saving, setSaving] = useState(false);

  const questionCount = useMemo(() => {
    try {
      const value = JSON.parse(normalizeJsonSource(json));
      return Array.isArray(value?.questions) ? value.questions.length : 0;
    } catch {
      return 0;
    }
  }, [json]);

  const validateJson = (source: unknown = json) => {
    const text = normalizeJsonSource(source);
    setError('');
    setPreview(undefined);
    setValid(false);

    try {
      const raw = JSON.parse(text);
      const parsed = ExamDraftSchema.safeParse(raw);
      if (!parsed.success) {
        setError(parsed.error.issues.map(i => `${i.path.join('.')} — ${i.message}`).join('\n'));
        return false;
      }

      const ids = new Set<string>();
      for (const q of parsed.data.questions) {
        if (ids.has(q.id)) {
          setError(`Trùng question id: ${q.id}`);
          return false;
        }
        ids.add(q.id);
        if (q.type === 'ABCD' && !q.options.some(o => o.id === q.correctOptionId)) {
          setError(`Question ${q.id}: correctOptionId không tồn tại`);
          return false;
        }
        if (q.type === 'SHORT_ANSWER' && (q.correctAnswers.length === 0 || q.needsReview)) {
          setError(`Question ${q.id}: cần review SHORT_ANSWER trước khi lưu`);
          return false;
        }
      }

      setJson(text);
      setPreview(parsed.data);
      setValid(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? `JSON không hợp lệ: ${e.message}` : 'JSON không hợp lệ');
      return false;
    }
  };

  const repairWithAi = async () => {
    if (!json.trim()) return;
    setError("AI đang sửa JSON…");
    try {
      const r = await aiApi.repairJson(normalizeJsonSource(json), error);
      setJson(r.json);
      setError("");
      validateJson(r.json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI không thể sửa JSON");
    }
  };

  const save = async () => {
    if (!valid || !preview) return;
    setSaving(true);
    setError('');
    try {
      const exam = await examService.createExamFromJson(preview);
      nav(`/library/${exam.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tạo đề');
    } finally {
      setSaving(false);
    }
  };

  const formatJson = () => {
    try {
      const text = normalizeJsonSource(json);
      setJson(JSON.stringify(JSON.parse(text), null, 2));
      setError('');
      setValid(false);
      setPreview(undefined);
    } catch (e) {
      setError(e instanceof Error ? `JSON không hợp lệ: ${e.message}` : 'JSON không hợp lệ');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exam-template.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-stack max-w-7xl mx-auto">
      <section className="page-hero">
        <div>
          <span className="eyebrow">TRÌNH TẠO ĐỀ</span>
          <h1>Tạo đề mới</h1>
          <p>Ưu tiên JSON + AI cho đề dài. Dán JSON do AI tạo, kiểm tra, xem trước rồi lưu.</p>
        </div>
        <button className="btn-secondary" onClick={() => nav('/library')}>
          <AppIcon name="arrow" size={17} />Quay lại Kho đề
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-5 items-start">
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="eyebrow">ƯU TIÊN CHO ĐỀ DÀI</span>
              <h2 className="font-semibold">{} JSON / AI</h2>
              <p className="text-xs text-slate-400 mt-1">Dùng AI + ảnh để tạo JSON, dán vào đây rồi kiểm tra. Ctrl + Enter để validate.</p>
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">{fileName && `${fileName} · `}{questionCount} câu</span>
          </div>

          <textarea
            className="input min-h-[560px] font-mono text-sm"
            spellCheck={false}
            value={json}
            onChange={e => {
              setJson(e.target.value);
              setValid(false);
              setPreview(undefined);
              setError('');
            }}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                validateJson();
              }
            }}
          />

          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary cursor-pointer">
              <AppIcon name="upload" size={17} />Import JSON
              <input
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  setFileName(f.name);
                  setJson(text);
                  setValid(false);
                  setPreview(undefined);
                  setError('');
                }}
              />
            </label>
            <button type="button" className="btn-secondary" onClick={() => validateJson()}>
              <AppIcon name="check" size={17} />Kiểm tra
            </button>
            <button type="button" className="btn-secondary" onClick={formatJson}>Format JSON</button>
            <button type="button" className="btn-secondary" onClick={() => { setJson(SAMPLE); setError(''); setValid(false); setPreview(undefined); setFileName(''); }}>
              Khôi phục mẫu
            </button>
            <button type="button" className="btn-secondary" onClick={downloadTemplate}>Tải template</button>
            <button type="button" className="btn-primary" disabled={!valid || saving} onClick={save}>
              <AppIcon name="plus" size={17} />{saving ? 'Đang lưu...' : 'Lưu đề'}
            </button>
          </div>

          {error && <pre className="whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</pre>}
        </section>

        <div className="space-y-4">
          {preview ? (
            <section className="card space-y-3">
              <div><span className="eyebrow">PREVIEW</span><h2 className="font-semibold mt-1">Xem trước đề</h2></div>
              <div><strong>{preview.title}</strong><p className="text-sm text-gray-500">{preview.subject}{preview.grade ? ` · Lớp ${preview.grade}` : ''} · {preview.questions.length} câu</p></div>
              <div className="space-y-2">
                {preview.questions.map((q: any, i: number) => (
                  <div className="border border-slate-200 rounded-xl p-3" key={q.id}>
                    <p className="text-xs text-gray-500">Câu {i + 1} · {q.type}</p>
                    <div className="mt-1"><RichContent html={q.content} /></div>
                    {q.type === 'ABCD' && <p className="text-xs mt-2 text-slate-500">4 lựa chọn · đáp án đúng: {q.correctOptionId}</p>}
                    {q.type === 'TRUE_FALSE' && <p className="text-xs mt-2 text-slate-500">Đáp án: {q.correctAnswer ? 'ĐÚNG' : 'SAI'}</p>}
                    {q.type === 'SHORT_ANSWER' && <p className="text-xs mt-2 text-slate-500">Đáp án chuẩn: {q.correctAnswers.join(', ')}</p>}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="empty-state !py-10">
              <div className="empty-icon"><AppIcon name="check" size={25} /></div>
              <h2>Chưa có preview</h2>
              <p>Nhấn “Kiểm tra” để xác thực JSON và xem trước nội dung đề.</p>
            </div>
          )}

          <div className="card border-indigo-100 bg-indigo-50/40 text-xs leading-5 text-slate-600">
            <strong className="text-slate-800">Quy trình đề dài:</strong> Gửi toàn bộ ảnh đề cho AI → dùng prompt bên dưới → yêu cầu AI chỉ trả JSON thuần → dán JSON vào ô → Kiểm tra → xem trước → Lưu đề.
          </div>
          <GeminiPromptPanel />
        </div>
      </div>
    </div>
  );
}

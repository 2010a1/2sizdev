import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExamDraftSchema, type ExamDraftInput } from '@exam/schemas';
import { examService } from '../../domain/exam/exam.service';
import { durationFromMinutes } from '@exam/utils';
import { GeminiPromptPanel } from '../components/exam/GeminiPromptPanel';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { RichContent } from '../components/exam/RichContent';
import { AppIcon } from '../components/AppIcon';

// Sample for the advanced JSON import — a real importable ExamDraft covering
// every question type (ABCD, TRUE_FALSE with 4 statements, SHORT_ANSWER), each
// with an explanation. Built as an object then stringified so the LaTeX
// backslashes are always valid JSON.
const SAMPLE_EXAM = {
  title: 'Đề mẫu — Đủ các dạng câu hỏi',
  description: 'Đề mẫu minh họa cả 3 dạng câu hỏi: trắc nghiệm ABCD, đúng/sai 4 mệnh đề và điền đáp án ngắn.',
  subject: 'Khoa học tự nhiên',
  grade: 10,
  duration: 1800,
  questions: [
    {
      id: 'q1',
      type: 'ABCD',
      content: 'Rút gọn biểu thức $\\frac{1}{2}+\\frac{1}{3}$.',
      points: 1,
      options: [
        { id: 'q1_a', text: '$\\frac{5}{6}$' },
        { id: 'q1_b', text: '$\\frac{2}{5}$' },
        { id: 'q1_c', text: '$\\frac{1}{6}$' },
        { id: 'q1_d', text: '$\\frac{4}{5}$' }
      ],
      correctOptionId: 'q1_a',
      explanation: 'Quy đồng mẫu số 6: $\\frac{1}{2}=\\frac{3}{6}$, $\\frac{1}{3}=\\frac{2}{6}$, tổng là $\\frac{5}{6}$.'
    },
    {
      id: 'q2',
      type: 'TRUE_FALSE',
      content: 'Cho các phát biểu về hóa học. Đúng hay sai?',
      points: 1,
      statements: [
        { id: 'q2_s1', text: 'Nước có công thức hóa học H₂O.', correct: true },
        { id: 'q2_s2', text: 'Axit sulfuric có công thức hóa học H₂SO₄.', correct: true },
        { id: 'q2_s3', text: 'Ký hiệu hóa học của oxi là Oz.', correct: false },
        { id: 'q2_s4', text: 'Dung dịch axit luôn có pH lớn hơn 7.', correct: false }
      ],
      explanation: 'Nước là H₂O và axit sulfuric là H₂SO₄. Ký hiệu của oxi là O (không phải Oz); dung dịch axit có pH nhỏ hơn 7.'
    },
    {
      id: 'q3',
      type: 'TRUE_FALSE',
      content: 'Cho các phát biểu về lịch sử Việt Nam. Đúng hay sai?',
      points: 1,
      statements: [
        { id: 'q3_s1', text: 'Trận Điện Biên Phủ toàn thắng năm 1954.', correct: true },
        { id: 'q3_s2', text: 'Nguyễn Ái Quốc đọc Tuyên ngôn Độc lập năm 1945.', correct: true },
        { id: 'q3_s3', text: 'Chiến dịch Hồ Chí Minh diễn ra năm 1975.', correct: true },
        { id: 'q3_s4', text: 'Hiệp định Genève được ký năm 1956.', correct: false }
      ],
      explanation: 'Điện Biên Phủ toàn thắng 7/5/1954; Tuyên ngôn Độc lập 2/9/1945; chiến dịch Hồ Chí Minh 1975. Hiệp định Genève ký ngày 21/7/1954 (không phải 1956).'
    },
    {
      id: 'q4',
      type: 'SHORT_ANSWER',
      content: 'Viết phân số tối giản của số thập phân 0,75.',
      points: 1,
      correctAnswers: ['3/4'],
      explanation: '0,75 = 75/100 = 3/4 sau khi rút gọn cho ước chung lớn nhất 25.'
    }
  ]
};
const SAMPLE = JSON.stringify(SAMPLE_EXAM, null, 2);

function normalizeJsonSource(source: unknown): string {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') return JSON.stringify(source);
  return String(source ?? '');
}
/** Shared paste -> validate -> save flow for AI output and advanced JSON import. */
function JsonImportPanel({ advanced }: { advanced?: boolean }) {
  const nav = useNavigate();
  const [json, setJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);
  const [preview, setPreview] = useState<ExamDraftInput>();
  const [saving, setSaving] = useState(false);

  const questionCount = useMemo(() => {
    try {
      const value = JSON.parse(normalizeJsonSource(json));
      return Array.isArray(value?.questions) ? value.questions.length : 0;
    } catch {
      return 0;
    }
  }, [json]);

  const validateJson = () => {
    setError('');
    setPreview(undefined);
    setValid(false);
    try {
      const raw = JSON.parse(normalizeJsonSource(json));
      const parsed = ExamDraftSchema.safeParse(raw);
      if (!parsed.success) {
        setError(parsed.error.issues.map(i => i.path.join('.') + ' - ' + i.message).join('\n'));
        return;
      }
      const ids = new Set<string>();
      for (const q of parsed.data.questions) {
        if (ids.has(q.id)) { setError('Trùng question id: ' + q.id); return; }
        ids.add(q.id);
        if (q.type === 'ABCD' && !q.options.some(o => o.id === q.correctOptionId)) {
          setError('Question ' + q.id + ': correctOptionId không tồn tại'); return;
        }
        if (q.type === 'SHORT_ANSWER' && (q.correctAnswers.length === 0 || q.needsReview)) {
          setError('Question ' + q.id + ': cần review SHORT_ANSWER trước khi lưu'); return;
        }
      }
      setPreview(parsed.data);
      setValid(true);
    } catch (e) {
      setError(e instanceof Error ? 'JSON không hợp lệ: ' + e.message : 'JSON không hợp lệ');
    }
  };

  const save = async () => {
    if (!valid || !preview) return;
    setSaving(true);
    setError('');
    try {
      const exam = await examService.createExamFromJson(preview);
      nav('/library/' + exam.id + '/edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tạo đề');
    } finally {
      setSaving(false);
    }
  };

  const formatJson = () => {
    try {
      setJson(JSON.stringify(JSON.parse(normalizeJsonSource(json)), null, 2));
      setError(''); setValid(false); setPreview(undefined);
    } catch (e) {
      setError(e instanceof Error ? 'JSON không hợp lệ: ' + e.message : 'JSON không hợp lệ');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'exam-template.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className='card space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='font-semibold'>{advanced ? 'JSON đề thi' : 'Dán JSON do AI tạo'}</h3>
        <span className='text-xs muted whitespace-nowrap'>{fileName && fileName + ' · '}{questionCount} câu</span>
      </div>

      <textarea
        className='input min-h-[220px] font-mono text-sm'
        spellCheck={false}
        placeholder={advanced ? 'Dán JSON đề thi vào đây…' : 'Dán JSON AI trả về vào đây…'}
        value={json}
        onChange={e => { setJson(e.target.value); setValid(false); setPreview(undefined); setError(''); }}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); validateJson(); } }}
      />

      <div className='flex flex-wrap gap-2 items-center'>
        {advanced && (
          <label className='btn-secondary cursor-pointer'>
            <AppIcon name='upload' size={17} />Import file
            <input
              className='hidden'
              type='file'
              accept='application/json,.json'
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setJson(await f.text());
                setValid(false); setPreview(undefined); setError('');
              }}
            />
          </label>
        )}
        <button type='button' className='btn-secondary' onClick={validateJson}>Kiểm tra</button>
        <button type='button' className='btn-primary' disabled={!valid || saving} onClick={save}>
          <AppIcon name='plus' size={17} />{saving ? 'Đang lưu...' : 'Lưu đề'}
        </button>
        {advanced && (
          <>
            <button type='button' className='btn-secondary' onClick={formatJson}>Format</button>
            <button type='button' className='btn-secondary' onClick={() => { setJson(SAMPLE); setFileName(''); setValid(false); setPreview(undefined); setError(''); }}>Xem mẫu</button>
            <button type='button' className='btn-secondary' onClick={downloadTemplate}>Tải template</button>
          </>
        )}
      </div>

      {error && <pre className='whitespace-pre-wrap rounded-xl bg-grade-soft p-3 text-xs leading-5 text-grade'>{error}</pre>}

      {preview && (
        <div className='space-y-2'>
          <p className='text-sm font-semibold'>{preview.title} <span className='font-normal muted'>· {preview.questions.length} câu</span></p>
          {preview.questions.map((q, i) => (
            <article className='create-preview-question' key={q.id}>
              <p className='text-xs font-semibold muted'>Câu {i + 1} · {q.type}</p>
              <div className='mt-1'><RichContent html={q.content} /></div>
              {q.type === 'ABCD' && <p className='text-xs mt-2 muted'>4 lựa chọn · đáp án đúng: {q.correctOptionId}</p>}
              {q.type === 'TRUE_FALSE' && <div className='mt-2 text-xs muted space-y-1'>{q.statements.map((st, j) => <div key={st.id}>{j + 1}. {st.text} — <b>{st.correct ? 'ĐÚNG' : 'SAI'}</b></div>)}</div>}
              {q.type === 'SHORT_ANSWER' && <p className='text-xs mt-2 muted'>Đáp án chuẩn: {q.correctAnswers.join(', ')}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Primary path: start blank, write questions in the structured editor. */
function ManualCreateForm() {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [minutes, setMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const canCreate = title.trim().length > 0 && subject.trim().length > 0 && !creating;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError('');
    try {
      const exam = await examService.createExam({
        title: title.trim(),
        subject: subject.trim(),
        grade: grade ? Number(grade) : undefined,
        duration: minutes ? durationFromMinutes(Number(minutes)) : undefined,
        description: description.trim() || undefined
      });
      nav('/library/' + exam.id + '/edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tạo đề');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className='card space-y-3'>
      <div>
        <h2 className='text-lg font-semibold'>Soạn đề trực tiếp</h2>
        <p className='text-sm muted mt-1'>Đặt tên đề, sau đó thêm từng câu hỏi bằng trình soạn thảo. Lưu tự động trên thiết bị.</p>
      </div>
      <div className='space-y-2'>
        <input className='input' placeholder='Tên đề (bắt buộc)' value={title} onChange={e => setTitle(e.target.value)} />
        <div className='grid grid-cols-3 gap-2'>
          <input className='input' placeholder='Môn (bắt buộc)' value={subject} onChange={e => setSubject(e.target.value)} />
          <input className='input' type='number' min='1' max='12' placeholder='Lớp' value={grade} onChange={e => setGrade(e.target.value)} />
          <input className='input' type='number' min='1' placeholder='Phút' value={minutes} onChange={e => setMinutes(e.target.value)} />
        </div>
        <textarea className='input min-h-[72px]' placeholder='Mô tả ngắn (không bắt buộc)' value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      {error && <p className='text-sm text-grade'>{error}</p>}
      <button type='button' className='btn-primary w-full' disabled={!canCreate} onClick={create}>
        <AppIcon name='plus' size={17} />{creating ? 'Đang tạo...' : 'Tạo đề và soạn câu hỏi'}
      </button>
    </section>
  );
}

type CreateTab = 'manual' | 'ai' | 'json';
const TABS: Array<{ key: CreateTab; icon: string; title: string; hint: string }> = [
  { key: 'manual', icon: '✍️', title: 'Soạn trực tiếp', hint: 'Gõ từng câu trong app — có thanh công thức toán/lý/hoá' },
  { key: 'ai', icon: '📷', title: 'Từ ảnh + AI', hint: 'Chụp đề giấy, AI đọc thành JSON' },
  { key: 'json', icon: '🗂️', title: 'JSON nâng cao', hint: 'Import file, format, tải template' },
];

export function CreateExamPage() {
  const [tab, setTab] = useState<CreateTab>('manual');
  return (
    <div className='page-stack max-w-5xl mx-auto'>
      <Breadcrumbs items={[{ label: 'Trang chủ', to: '/' }, { label: 'Kho đề', to: '/library' }, { label: 'Tạo đề mới' }]} />
      <section className='page-hero'>
        <div>
          <span className='eyebrow'>TRÌNH TẠO ĐỀ</span>
          <h1>Tạo đề mới</h1>
          <p>Chọn một cách bắt đầu bên dưới. Ba cách đều ra cùng một loại đề và chỉnh sửa được sau đó.</p>
        </div>
      </section>

      <div className='create-tabs' role='tablist'>
        {TABS.map(t => (
          <button key={t.key} type='button' role='tab' aria-selected={tab === t.key}
            className={`create-tab ${tab === t.key ? 'create-tab-active' : ''}`}
            onClick={() => setTab(t.key)}>
            <span className='create-tab-icon'>{t.icon}</span>
            <span className='create-tab-text'>
              <strong>{t.title}</strong>
              <small>{t.hint}</small>
            </span>
          </button>
        ))}
      </div>

      {/* All three panels stay mounted; hidden ones keep their state so
          switching tabs never loses pasted JSON or typed drafts. */}
      <div hidden={tab !== 'manual'} className='space-y-4 tab-panel'>
        <ManualCreateForm />
        <div className='card p-4 text-sm muted'>
          <b className='text-ink'>Mẹo:</b> mỗi câu nên có lời giải (<code>explanation</code>) để hiển thị giải thích offline khi người học làm sai. Có thể bổ sung sau trong trình chỉnh sửa. Trong ô nhập câu hỏi, bấm các nút <b>Công thức</b> ở đầu ô để chèn phân số, căn, mũ, chỉ số, ký hiệu hoá học… — xem trước hiển thị ngay bên dưới ô nhập.
        </div>
      </div>
      <div hidden={tab !== 'ai'} className='space-y-4 tab-panel'>
        <GeminiPromptPanel />
        <JsonImportPanel />
      </div>
      <div hidden={tab !== 'json'} className='tab-panel'>
        <JsonImportPanel advanced />
      </div>
    </div>
  );
}

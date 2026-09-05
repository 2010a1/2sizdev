import { useEffect, useState } from 'react';
import { adminApi, type SystemSettingsRow } from '../../infrastructure/api/auth';
import { Skeleton } from '../components/Skeleton';

const FIELDS: Array<{ key: keyof SystemSettingsRow; label: string; hint: string; min: number; max: number }> = [
  { key: 'generalRateLimitPerMinute', label: 'Giới hạn request/phút (mỗi IP)', hint: 'Trần tổng cho mọi API. Tối thiểu bảo vệ 10.', min: 10, max: 10000 },
  { key: 'maxExamsPerUser', label: 'Số đề tối đa / người dùng', hint: 'Tổng số đề đang tồn tại (không phải tốc độ). Chặn spam tạo đề.', min: 1, max: 10000 },
  { key: 'maxQuestionsPerExam', label: 'Số câu hỏi tối đa / đề', hint: 'Áp dụng khi tạo, chỉnh sửa, import và chia sẻ đề.', min: 1, max: 1000 },
  { key: 'maxSharesPerUser', label: 'Số mã chia sẻ đang hoạt động / người dùng', hint: 'Chỉ tính share chưa xóa. Xóa share cũ sẽ giải phóng chỗ.', min: 1, max: 10000 }
];

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettingsRow>();
  const [form, setForm] = useState<SystemSettingsRow>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { adminApi.settings().then(r => { setSettings(r.settings); setForm(r.settings); }).catch(e => setError(e instanceof Error ? e.message : 'Không tải được cài đặt')); }, []);

  async function save() {
    if (!form) return;
    setBusy(true); setNotice('');
    try { const r = await adminApi.setSettings(form); setSettings(r.settings); setForm(r.settings); setNotice('Đã lưu cài đặt hệ thống.'); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Không lưu được'); } finally { setBusy(false); }
  }

  const dirty = Boolean(form && settings && JSON.stringify(form) !== JSON.stringify(settings));
  return <div className="page-stack max-w-3xl mx-auto">
    <section className="page-hero"><div><span className="eyebrow">ADMIN · SETTINGS</span><h1>Cài đặt hệ thống</h1><p>Các giới hạn tài nguyên áp dụng ở server — không thể bypass bằng cách gọi API trực tiếp.</p></div></section>
    {error && <p className="form-error">{error}</p>}
    {!form ? <div className="card"><Skeleton className="h-40 w-full" /></div> : <section className="card space-y-5">
      {FIELDS.map(f => <div key={f.key}>
        <label className="text-sm font-semibold" htmlFor={`set-${f.key}`}>{f.label}</label>
        <p className="text-xs muted mt-0.5">{f.hint}</p>
        <input id={`set-${f.key}`} className="input mt-1" type="number" min={f.min} max={f.max} value={form[f.key]} onChange={e => { const v = Number(e.target.value); setForm({ ...form, [f.key]: Number.isFinite(v) ? v : f.min }); }} />
        <p className="text-xs muted mt-1">Cho phép {f.min} – {f.max}.</p>
      </div>)}
      <div className="flex items-center gap-3 flex-wrap">
        <button className="admin-primary-btn" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu cài đặt'}</button>
        {dirty && <button className="btn-secondary" disabled={busy} onClick={() => setForm(settings)}>Hoàn tác</button>}
        {notice && <span className={notice.startsWith('Đã lưu') ? 'text-sm text-pass' : 'form-error'}>{notice}</span>}
      </div>
      <p className="text-xs muted">Đăng ký / bảo trì tính năng: bật tắt ở khu vực An ninh hệ thống (feature flags). Giới hạn AI riêng ở trang AI &amp; Gemini API.</p>
    </section>}
  </div>;
}

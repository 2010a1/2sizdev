import { useEffect, useState } from 'react';
import { adminApi, type AdminNotificationRow, type AuthUser, type NotificationCategory } from '../../infrastructure/api/auth';
import { RichTextEditor } from '../components/exam/RichTextEditor';
import { RichContent } from '../components/exam/RichContent';
import { AppIcon } from '../components/AppIcon';
import { Skeleton } from '../components/Skeleton';

const CATEGORIES: Array<{ value: NotificationCategory; label: string }> = [
  { value: 'announcement', label: 'Thông báo chung' },
  { value: 'info', label: 'Thông tin' },
  { value: 'warning', label: 'Cảnh báo' },
  { value: 'success', label: 'Thành công' }
];
const when = (t?: number) => t ? new Date(t).toLocaleString('vi-VN') : '—';

type Draft = { id?: string; title: string; body: string; category: NotificationCategory; link: string; audience: 'ALL' | 'USERS'; targetUserIds: string[]; scheduledAt: string };
const emptyDraft: Draft = { title: '', body: '', category: 'announcement', link: '', audience: 'ALL', targetUserIds: [], scheduledAt: '' };

export function AdminNotificationsPage() {
  const [messages, setMessages] = useState<AdminNotificationRow[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [preview, setPreview] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<AuthUser[]>();

  const load = () => adminApi.notifications().then(r => { setMessages(r.messages); setError(''); }).catch(e => setError(e instanceof Error ? e.message : 'Không tải được danh sách'));
  useEffect(() => { void load(); }, []);

  function edit(m: AdminNotificationRow) {
    setDraft({
      id: m.id, title: m.title, body: m.body, category: m.category,
      link: m.link ?? '', audience: m.audience, targetUserIds: m.targetUserIds ?? [],
      scheduledAt: m.scheduledAt ? new Date(m.scheduledAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
    });
    setPreview(false); setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function reset() { setDraft(emptyDraft); setPreview(false); setUserResults(undefined); setUserQuery(''); }

  async function searchUsers() {
    if (!userQuery.trim()) { setUserResults(undefined); return; }
    try { const r = await adminApi.users(1, 10, userQuery.trim()); setUserResults(r.users); } catch { setUserResults([]); }
  }
  function toggleTarget(u: AuthUser) {
    setDraft(d => d.targetUserIds.includes(u.id) ? { ...d, targetUserIds: d.targetUserIds.filter(x => x !== u.id) } : { ...d, targetUserIds: [...d.targetUserIds, u.id] });
  }

  async function save(publish: boolean) {
    if (!draft.title.trim() || !draft.body.trim()) { setNotice('Cần tiêu đề và nội dung.'); return; }
    if (draft.audience === 'USERS' && !draft.targetUserIds.length) { setNotice('Chọn ít nhất một người nhận.'); return; }
    const scheduledAt = draft.scheduledAt ? new Date(draft.scheduledAt).getTime() : undefined;
    if (scheduledAt && scheduledAt <= Date.now()) { setNotice('Thời gian hẹn giờ phải ở tương lai.'); return; }
    setBusy(true); setNotice('');
    const payload: Record<string, unknown> = { title: draft.title.trim(), body: draft.body, category: draft.category, link: draft.link.trim() || undefined, audience: draft.audience, targetUserIds: draft.audience === 'USERS' ? draft.targetUserIds : undefined, scheduledAt, publish: publish && !scheduledAt };
    try {
      if (draft.id) await adminApi.updateNotification(draft.id, payload);
      else await adminApi.createNotification(payload);
      reset(); await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Không lưu được'); } finally { setBusy(false); }
  }

  async function publishNow(id: string) { setBusy(true); setNotice(''); try { await adminApi.publishNotification(id); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Không gửi được'); } finally { setBusy(false); } }
  async function remove(id: string) { if (!window.confirm('Xóa thông báo này? Người nhận sẽ không còn thấy nó.')) return; setBusy(true); setNotice(''); try { await adminApi.deleteNotification(id); if (draft.id === id) reset(); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Không xóa được'); } finally { setBusy(false); } }

  return <div className="page-stack max-w-7xl mx-auto">
    <section className="page-hero"><div><span className="eyebrow">ADMIN · NOTIFICATIONS</span><h1>Quản lý thông báo</h1><p>Soạn thông báo rich-text, gửi cho tất cả hoặc người cụ thể, hẹn giờ và theo dõi trạng thái gửi.</p></div></section>
    {error && <p className="form-error">{error}</p>}

    <section className="card space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h2 className="font-bold">{draft.id ? 'Chỉnh sửa thông báo' : 'Soạn thông báo mới'}</h2><p className="text-sm muted">Nội dung được sanitize ở server; người dùng chỉ thấy HTML an toàn.</p></div>
        {draft.id && <button className="btn-secondary" onClick={reset}>Bỏ chỉnh sửa</button>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">Tiêu đề<input className="input mt-1" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="VD: Bảo trì hệ thống tối nay" maxLength={300} /></label>
        <label className="text-sm">Loại<select className="select mt-1 w-full" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as NotificationCategory })}>{CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className="text-sm">Link nội bộ khi bấm (tuỳ chọn)<input className="input mt-1" value={draft.link} onChange={e => setDraft({ ...draft, link: e.target.value })} placeholder="/library" maxLength={500} /></label>
        <label className="text-sm">Hẹn giờ gửi (tuỳ chọn)<input type="datetime-local" className="input mt-1" value={draft.scheduledAt} onChange={e => setDraft({ ...draft, scheduledAt: e.target.value })} disabled={Boolean(draft.id)} /></label>
      </div>
      <div className="text-sm">
        <p className="font-semibold mb-1">Người nhận</p>
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2"><input type="radio" name="audience" checked={draft.audience === 'ALL'} onChange={() => setDraft({ ...draft, audience: 'ALL' })} />Tất cả người dùng đang hoạt động</label>
          <label className="flex items-center gap-2"><input type="radio" name="audience" checked={draft.audience === 'USERS'} onChange={() => setDraft({ ...draft, audience: 'USERS' })} />Người cụ thể</label>
        </div>
      </div>
      {draft.audience === 'USERS' && <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
        <div className="flex gap-2"><input className="input" placeholder="Tìm username / email / ID" value={userQuery} onChange={e => setUserQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchUsers(); }} /><button className="btn-secondary" onClick={() => void searchUsers()}>Tìm</button></div>
        {userResults && <div className="flex flex-wrap gap-2">{userResults.length ? userResults.map(u => <button key={u.id} className={`chip ${draft.targetUserIds.includes(u.id) ? 'chip-active' : ''}`} onClick={() => toggleTarget(u)}>{u.username}{draft.targetUserIds.includes(u.id) ? ' ✓' : ''}</button>) : <span className="text-sm muted">Không tìm thấy.</span>}</div>}
        {draft.targetUserIds.length > 0 && <p className="text-xs muted">Đã chọn {draft.targetUserIds.length} người nhận.</p>}
      </div>}
      <div>
        <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold">Nội dung (rich text)</p><button className="admin-text-link" onClick={() => setPreview(p => !p)}>{preview ? 'Ẩn xem trước' : 'Xem trước'}</button></div>
        <RichTextEditor value={draft.body} onChange={v => setDraft({ ...draft, body: v })} placeholder="Nội dung thông báo… hỗ trợ đậm, nghiêng, heading, danh sách, link, ảnh, công thức toán." />
        {preview && <div className="mt-3 rounded-xl border border-[var(--line)] p-4"><RichContent html={draft.body} /></div>}
      </div>
      {notice && <p className="form-error">{notice}</p>}
      <div className="flex gap-2 flex-wrap">
        <button className="admin-primary-btn" disabled={busy} onClick={() => void save(true)}>{busy ? 'Đang lưu…' : draft.scheduledAt ? 'Lưu & hẹn giờ' : 'Gửi ngay'}</button>
        <button className="btn-secondary" disabled={busy} onClick={() => void save(false)}>Lưu nháp</button>
      </div>
    </section>

    <div className="card overflow-auto">
      <div className="p-3"><h2 className="font-bold">Danh sách thông báo</h2></div>
      <table className="w-full text-sm">
        <thead><tr className="text-left muted"><th className="p-3">Tiêu đề</th><th className="p-3">Loại</th><th className="p-3">Đối tượng</th><th className="p-3">Trạng thái</th><th className="p-3">Đã gửi</th><th className="p-3">Cập nhật</th><th className="p-3">Action</th></tr></thead>
        <tbody>
          {messages === undefined ? [0, 1, 2].map(i => <tr key={i} className="border-t border-[var(--line)]">{[0, 1, 2, 3, 4, 5, 6].map(c => <td key={c} className="p-3"><Skeleton className="h-5 w-16" /></td>)}</tr>)
            : messages.length === 0 ? <tr><td className="p-3 muted" colSpan={7}>Chưa có thông báo nào.</td></tr>
            : messages.map(m => <tr key={m.id} className="border-t border-[var(--line)]">
              <td className="p-3 font-semibold max-w-64 truncate">{m.title}</td>
              <td className="p-3">{CATEGORIES.find(c => c.value === m.category)?.label ?? m.category}</td>
              <td className="p-3">{m.audience === 'ALL' ? 'Tất cả' : `${m.targetUserIds?.length ?? 0} người`}</td>
              <td className="p-3">{m.status === 'SENT' ? <span className="text-pass">Đã gửi {when(m.sentAt)}</span> : m.status === 'SCHEDULED' ? <span className="text-warn">Hẹn {when(m.scheduledAt)}</span> : 'Nháp'}</td>
              <td className="p-3 tabular-nums">{m.sentCount}</td>
              <td className="p-3">{when(m.updatedAt)}</td>
              <td className="p-3 flex gap-2">{m.status !== 'SENT' && <button className="btn-secondary" disabled={busy} onClick={() => void publishNow(m.id)}>Gửi</button>}{m.status !== 'SENT' && <button className="btn-secondary" disabled={busy} onClick={() => edit(m)}><AppIcon name="edit" size={15} />Sửa</button>}<button className="btn-secondary text-grade" disabled={busy} onClick={() => void remove(m.id)}>Xóa</button></td>
            </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { adminApi, type AdminShareRow, type StorageStatsRow } from '../../infrastructure/api/auth';
import { Skeleton } from '../components/Skeleton';
import { AppIcon } from '../components/AppIcon';

const KB = 1024;
const MB = KB * KB;
const RAILWAY_BUDGET = 500 * MB;
const fmt = (b?: number) => { const n = b ?? 0; if (n >= MB) return `${(n / MB).toFixed(1)} MB`; if (n >= KB) return `${(n / KB).toFixed(1)} KB`; return `${n} B`; };
const when = (t?: number) => t ? new Date(t).toLocaleString('vi-VN') : '—';

export function AdminStoragePage() {
  const [stats, setStats] = useState<StorageStatsRow>();
  const [shares, setShares] = useState<AdminShareRow[]>();
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [vacuum, setVacuum] = useState<'auto' | 'always' | 'never'>('auto');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  // Effect is the single fetch path (page or a refresh nonce); the seq guard
  // drops responses from superseded requests so stale pages never overwrite.
  const seq = useRef(0);
  const load = () => { const my = ++seq.current; Promise.all([adminApi.storage(), adminApi.shares(page, 20)]).then(([s, l]) => { if (seq.current !== my) return; setStats(s); setShares(l.shares); setHasMore(l.hasMore); setError(''); }).catch(e => { if (seq.current !== my) return; setStats(undefined); setShares([]); setError(e instanceof Error ? e.message : 'Không tải được dữ liệu lưu trữ'); }); };
  useEffect(() => { void load(); }, [page, nonce]);
  async function gc() { setBusy('gc'); setMsg(''); try { const r = await adminApi.storageGc(vacuum); const g = r.report; setMsg(`Đã dọn: ${g.sharesPurged} share · ${g.mutationsPurged} mutation · ${g.entitiesPurged} entity · ${g.changesPurged} change${g.vacuumed ? ` · VACUUM trả ${fmt(Math.max(0, g.dbBytesBefore - g.dbBytesAfter))}` : ''}.`); setPage(1); setNonce(n => n + 1); } catch (e) { setMsg(e instanceof Error ? e.message : 'Không chạy được GC'); } finally { setBusy(''); } }
  async function remove(code: string) { if (!window.confirm(`Xóa vĩnh viễn share ${code}? Mọi link dùng mã này sẽ chết ngay.`)) return; setBusy(code); try { await adminApi.deleteShare(code); if (shares && shares.length === 1 && page > 1) setPage(page - 1); else setNonce(n => n + 1); } catch (e) { alert(e instanceof Error ? e.message : 'Không xóa được'); } finally { setBusy(''); } }

  const used = (stats?.dbBytes ?? 0) + (stats?.walBytes ?? 0) + (stats?.sharedExamsBytes ?? 0);
  const pct = Math.min(100, (used / RAILWAY_BUDGET) * 100);
  const cards = [
    { icon: 'database' as const, label: 'Tổng đang dùng', value: fmt(used), note: 'trên budget Railway ~500 MB' },
    { icon: 'monitor' as const, label: 'SQLite (db + WAL)', value: fmt((stats?.dbBytes ?? 0) + (stats?.walBytes ?? 0)), note: stats?.driver === 'sqlite' ? `WAL ${fmt(stats?.walBytes)}` : 'driver memory (test)' },
    { icon: 'share' as const, label: 'File share', value: fmt(stats?.sharedExamsBytes), note: `${stats?.sharedExamsFiles ?? 0} file trong shared-exams/` },
    { icon: 'clock' as const, label: 'Share đã xóa / hết hạn', value: `${(stats?.tables?.sharesDeleted ?? 0) + (stats?.tables?.sharesExpired ?? 0)}`, note: 'GC sẽ hard-purge theo grace 7 ngày' },
  ];
  const tableRows: Array<[string, number]> = Object.entries(stats?.tables ?? {});

  return <div className="page-stack max-w-7xl mx-auto">
    {error && <p className="form-error">{error}</p>}
    <section className="page-hero"><div><span className="eyebrow">ADMIN</span><h1>Lưu trữ &amp; Share</h1><p>Theo dõi dung lượng volume 500MB của Railway, chạy dọn dẹp (GC) và quản lý share.</p></div></section>

    <section className="admin-kpi-grid">{stats ? cards.map(c => <div className="admin-kpi" key={c.label}><div className="admin-kpi-icon"><AppIcon name={c.icon} size={20} /></div><div><span>{c.label}</span><strong>{c.value}</strong><small>{c.note}</small></div></div>) : [0, 1, 2, 3].map(i => <div className="admin-kpi" key={i}><Skeleton className="w-10 h-10 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-6 w-14" /><Skeleton className="h-3 w-28" /></div></div>)}</section>

    <div className="card"><div className="flex justify-between text-sm mb-2"><strong>Dung lượng so với budget ~500 MB</strong><span>{fmt(used)} / 500 MB ({pct.toFixed(1)}%)</span></div><div style={{ height: 10, borderRadius: 6, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: pct > 85 ? 'var(--grade)' : pct > 60 ? 'var(--warn)' : 'var(--pass)' }} /></div></div>

    <div className="admin-two-col">
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Dọn dẹp lưu trữ (GC)</h2><p>Xóa share hết hạn / đã xóa quá grace 7 ngày, mutation marker quá 7 ngày, entity đã xóa quá 30 ngày, session + security event cũ.</p></div></div>
        <div className="flex flex-wrap gap-2 items-center">
          <select className="select" value={vacuum} onChange={e => setVacuum(e.target.value as 'auto' | 'always' | 'never')}><option value="auto">VACUUM: auto</option><option value="always">VACUUM: luôn luôn</option><option value="never">VACUUM: không</option></select>
          <button className="admin-primary-btn" disabled={busy === 'gc'} onClick={() => void gc()}>{busy === 'gc' ? 'Đang chạy…' : 'Chạy GC ngay'}</button>
        </div>
        {msg && <p className="text-sm mt-2 muted">{msg}</p>}
        <p className="text-xs mt-2 muted">GC tự chạy mỗi 24h (STORAGE_GC_INTERVAL_MS). VACUUM chỉ trả bytes về disk khi dọn được nhiều.</p>
      </div>
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Số dòng các bảng</h2><p>Số lượng rows đang lưu trong SQLite.</p></div></div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{stats ? tableRows.map(([k, v]) => <div key={k} className="flex justify-between border-b border-[var(--line)] py-1"><span className="muted">{k}</span><strong className="tabular-nums">{v}</strong></div>) : <Skeleton className="h-40 w-full" />}</div>
      </div>
    </div>

    {stats?.topShareOwners && stats.topShareOwners.length > 0 && <div className="admin-panel"><div className="admin-panel-head"><div><h2>Top chủ share (dung lượng)</h2><p>Những user đang chiếm nhiều bytes nhất — ứng viên để nhắc dọn.</p></div></div>
      <table className="w-full text-sm"><thead><tr className="text-left muted"><th className="p-2">User</th><th className="p-2">Số share</th><th className="p-2">Bytes</th></tr></thead><tbody>{stats.topShareOwners.map(o => <tr key={o.ownerUserId ?? 'anon'} className="border-t border-[var(--line)]"><td className="p-2 font-semibold">{o.ownerUserId ?? 'Ẩn danh (offline)'}</td><td className="p-2 tabular-nums">{o.shares}</td><td className="p-2 tabular-nums">{fmt(o.bytes)}</td></tr>)}</tbody></table>
    </div>}

    <div className="card overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left muted"><th className="p-3">Code</th><th className="p-3">Loại</th><th className="p-3">Chủ</th><th className="p-3">Size</th><th className="p-3">Lượt tải</th><th className="p-3">Tạo</th><th className="p-3">Hết hạn</th><th className="p-3">Action</th></tr></thead><tbody>
      {shares === undefined ? [0, 1, 2, 3, 4].map(i => <tr key={i} className="border-t border-[var(--line)]">{[0, 1, 2, 3, 4, 5, 6, 7].map(c => <td key={c} className="p-3"><Skeleton className="h-5 w-16" /></td>)}</tr>)
        : shares.length === 0 ? <tr><td className="p-3 muted" colSpan={8}>Không có share nào.</td></tr>
        : shares.map(s => <tr key={s.code} className="border-t border-[var(--line)]"><td className="p-3 font-mono font-semibold">{s.code}</td><td className="p-3">{s.packageType === 'vocabularySet' ? 'Từ vựng' : 'Đề'}</td><td className="p-3">{s.ownerUserId ?? s.ownerName ?? 'Ẩn danh'}</td><td className="p-3 tabular-nums">{fmt(s.sizeBytes)}</td><td className="p-3 tabular-nums">{s.accessCount ?? 0}</td><td className="p-3">{when(s.createdAt)}</td><td className="p-3">{s.expiresAt ? (s.expiresAt < Date.now() ? <span className="text-grade">hết hạn</span> : when(s.expiresAt)) : '—'}</td><td className="p-3"><button className="btn-secondary text-grade" disabled={busy === s.code} onClick={() => void remove(s.code)}>Xóa</button></td></tr>)}
    </tbody></table></div>
    <div className="flex justify-between items-center text-sm"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page}</span><button className="btn-secondary" disabled={!hasMore} onClick={() => setPage(page + 1)}>Sau</button></div>
  </div>;
}

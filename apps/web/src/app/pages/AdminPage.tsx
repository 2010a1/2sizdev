import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, type AdminStatsResponse } from "../../infrastructure/api/auth";
import { AppIcon } from "../components/AppIcon";
import { Skeleton } from "../components/Skeleton";

export function AdminPage() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<AdminStatsResponse>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof adminApi.search>>>();

  useEffect(() => {
    setData(undefined); setError("");
    void adminApi.stats(range).then(setData).catch(e => setError(e instanceof Error ? e.message : "Không thể tải dashboard"));
  }, [range]);

  const search = () => {
    if (!query.trim()) { setResults(undefined); return; }
    void adminApi.search(query.trim()).then(setResults).catch(() => setResults(undefined));
  };

  const s = data?.stats;
  const cards = [
    { label: "Tài khoản", value: s?.users ?? "—", note: "Tổng số tài khoản", icon: "user" as const },
    { label: "Đề chính thức", value: s?.exams ?? "—", note: "Tổng số đề", icon: "library" as const },
    { label: "Lượt thi " + (range === "1d" ? "hôm nay" : range === "30d" ? "30 ngày qua" : "7 ngày qua"), value: s?.activities?.total ?? "—", note: "Bao gồm luyện tập & thi đấu", icon: "trophy" as const },
    { label: "Đăng ký kỳ này", value: s?.registrations ?? "—", note: "Trong khoảng thời gian chọn", icon: "spark" as const },
  ];
  // Real per-period activity totals from the server; no invented bars.
  const periods = data ? [
    { label: "Hôm nay", value: data.periods.today.activities.total },
    { label: "Hôm qua", value: data.periods.yesterday.activities.total },
    { label: "7 ngày qua", value: data.periods.last7Days.activities.total },
    { label: "30 ngày qua", value: data.periods.last30Days.activities.total },
  ] : [];
  const maxPeriod = Math.max(1, ...periods.map(p => p.value));

  return <div className="admin-dashboard">
    <section className="admin-page-heading">
      <div><span className="admin-eyebrow">TỔNG QUAN</span><h1>Tổng quan hệ thống</h1><p>Số liệu thật từ server theo múi giờ {data?.timezone ?? "—"}</p></div>
      <label className="admin-date-select"><AppIcon name="clock" size={16}/><select value={range} onChange={e => setRange(e.target.value)}><option value="1d">Hôm nay</option><option value="7d">7 ngày qua</option><option value="30d">30 ngày qua</option></select></label>
    </section>

    <section className="admin-kpi-grid">{data
      ? cards.map(card => <div className="admin-kpi" key={card.label}><div className="admin-kpi-icon"><AppIcon name={card.icon} size={20}/></div><div><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div></div>)
      : [0, 1, 2, 3].map(i => <div className="admin-kpi" key={i}><Skeleton className="w-10 h-10 rounded-xl"/><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-24"/><Skeleton className="h-6 w-14"/><Skeleton className="h-3 w-28"/></div></div>)}
    </section>

    <section className="admin-panel admin-search-panel">
      <div className="admin-panel-head"><div><h2>Tìm kiếm nhanh</h2><p>Tìm tài khoản, đề, mã share hoặc security event.</p></div></div>
      <div className="admin-search-row"><div className="admin-search-input"><AppIcon name="search" size={17}/><input placeholder="Tên / username / user ID / exam ID / share code / event ID" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }}/></div><button className="admin-primary-btn" onClick={search}>Tìm kiếm</button></div>
      {results && <div className="admin-search-results">
        <div><b>Users</b>{results.users?.length ? results.users.map((u) => <div key={u.id}>{u.username} · {u.id}</div>) : <div className="admin-empty-hint">Không có kết quả</div>}</div>
        <div><b>Exams</b>{results.exams?.length ? results.exams.map((e) => <div key={e.id}>{e.title} · {e.id}</div>) : <div className="admin-empty-hint">Không có kết quả</div>}</div>
        <div><b>Shares</b>{results.shares?.length ? results.shares.map((x) => <div key={x.shareId}>{x.code} · {x.packageType}</div>) : <div className="admin-empty-hint">Không có kết quả</div>}</div>
        <div><b>Security</b>{results.events?.length ? results.events.map((x) => <div key={x.id}>{x.action} · {x.id}</div>) : <div className="admin-empty-hint">Không có kết quả</div>}</div>
      </div>}
    </section>

    {error && <p className="form-error">{error}</p>}

    <section className="admin-two-col">
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Lượt thi theo thời gian</h2><p>Tổng lượt làm bài các kỳ gần đây (múi giờ server)</p></div></div>
        {data ? (periods.every(p => p.value === 0)
          ? <div className="admin-chart-empty">Chưa có lượt làm bài nào được ghi nhận.</div>
          : <div className="admin-bars admin-bars-periods">{periods.map(p => <div className="admin-bar-wrap" key={p.label}><div className={"admin-bar" + (p.value === 0 ? " admin-bar-zero" : "")} style={{height: `${Math.max(4, Math.round(p.value / maxPeriod * 100))}%`}}/><small>{p.label}</small><b>{p.value}</b></div>)}</div>)
        : <Skeleton className="h-44 rounded-xl" />}
      </div>
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Tổng quan tài khoản</h2><p>Trạng thái hiện tại</p></div></div><div className="admin-donut-row"><div className="admin-donut"><div><strong>{s?.users ?? "—"}</strong><span>tài khoản</span></div></div><div className="admin-legend"><p><i className="ok"/> Hoạt động <b>{s?.activeUsers ?? "—"}</b></p><p><i className="warn"/> Bị giới hạn <b>{s?.limitedUsers ?? "—"}</b></p><p><i className="bad"/> Bị khóa <b>{s?.lockedUsers ?? "—"}</b></p></div></div></div>
    </section>

    <section className="admin-two-col">
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Hoạt động học tập</h2><p>Phân loại lượt sử dụng</p></div><Link className="admin-text-link" to="/admin/security">Xem chi tiết</Link></div><div className="admin-activity-list"><Activity label="Luyện tập" value={s?.activities?.practice ?? "—"} icon="book"/><Activity label="Thi đấu" value={s?.activities?.tournament ?? "—"} icon="trophy"/><Activity label="Luyện từ tiếng Anh" value={s?.activities?.english ?? "—"} icon="brain"/><Activity label="Share tạo mới" value={s?.shares ?? "—"} icon="share"/></div></div>
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Quản trị nhanh</h2><p>Truy cập các khu vực thường dùng</p></div></div><div className="admin-quick-grid"><Link to="/admin/users"><AppIcon name="user"/><span>Tài khoản</span><small>Quản lý người dùng</small></Link><Link to="/admin/exams"><AppIcon name="library"/><span>Đề chính thức</span><small>Thêm / xóa / tải đề</small></Link><Link to="/admin/security"><AppIcon name="shield"/><span>An ninh hệ thống</span><small>Vi phạm & cảnh báo</small></Link></div></div>
    </section>
  </div>;
}

function Activity({label,value,icon}:{label:string;value:string|number;icon:"book"|"trophy"|"brain"|"share"}) { return <div className="admin-activity"><span className="admin-activity-icon"><AppIcon name={icon} size={17}/></span><div><strong>{label}</strong><small>Hoạt động ghi nhận</small></div><b>{value}</b></div>; }

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../infrastructure/api/auth";
import { AppIcon } from "../components/AppIcon";

export function AdminPage() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>();

  useEffect(() => {
    void adminApi.stats(range).then(setData).catch(e => setError(e instanceof Error ? e.message : "Không thể tải dashboard"));
  }, [range]);

  const search = () => {
    if (!query.trim()) { setResults(undefined); return; }
    void adminApi.search(query.trim()).then(setResults).catch(() => setResults(undefined));
  };

  const s = data?.stats;
  const cards = [
    { label: "Tài khoản", value: s?.users ?? "—", note: "Tổng số tài khoản", icon: "user" as const },
    { label: "Đề chính thức", value: s?.officialExams ?? s?.exams ?? "—", note: "Tổng số đề", icon: "library" as const },
    { label: "Lượt thi hôm nay", value: s?.activities?.today ?? s?.activities?.total ?? "—", note: "Bao gồm luyện tập & thi đấu", icon: "trophy" as const },
    { label: "Đăng ký kỳ này", value: s?.registrations ?? "—", note: "Trong khoảng thời gian chọn", icon: "spark" as const },
  ];

  return <div className="admin-dashboard">
    <section className="admin-page-heading">
      <div><span className="admin-eyebrow">TỔNG QUAN</span><h1>Xin chào, admin! 👋</h1><p>Chào mừng bạn đến với bảng điều khiển quản trị.</p></div>
      <label className="admin-date-select"><AppIcon name="clock" size={16}/><select value={range} onChange={e => setRange(e.target.value)}><option value="1d">Hôm nay</option><option value="7d">7 ngày qua</option><option value="30d">30 ngày qua</option></select></label>
    </section>

    <section className="admin-kpi-grid">{cards.map(card => <div className="admin-kpi" key={card.label}><div className="admin-kpi-icon"><AppIcon name={card.icon} size={20}/></div><div><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div></div>)}</section>

    <section className="admin-panel admin-search-panel">
      <div className="admin-panel-head"><div><h2>Tìm kiếm nhanh</h2><p>Tìm tài khoản, đề, mã share hoặc security event.</p></div><span className="admin-live"><i/> Live</span></div>
      <div className="admin-search-row"><div className="admin-search-input"><AppIcon name="search" size={17}/><input placeholder="Tên / username / user ID / exam ID / share code / event ID" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }}/></div><button className="admin-primary-btn" onClick={search}>Tìm kiếm</button></div>
      {results && <div className="admin-search-results"><div><b>Users</b>{results.users?.map((u:any) => <div key={u.id}>{u.username} · {u.id}</div>)}</div><div><b>Exams</b>{results.exams?.map((e:any) => <div key={e.id}>{e.title} · {e.id}</div>)}</div><div><b>Shares</b>{results.shares?.map((x:any) => <div key={x.shareId}>{x.code} · {x.packageType}</div>)}</div><div><b>Security</b>{results.events?.map((x:any) => <div key={x.id}>{x.action} · {x.id}</div>)}</div></div>}
    </section>

    {error && <p className="form-error">{error}</p>}

    <section className="admin-two-col">
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Lượt thi</h2><p>Hoạt động trong khoảng thời gian đã chọn</p></div><select className="admin-mini-select" value={range} onChange={e => setRange(e.target.value)}><option value="7d">7 ngày qua</option><option value="30d">30 ngày qua</option><option value="1d">Hôm nay</option></select></div><div className="admin-chart"><div className="admin-chart-grid"><span>250</span><span>200</span><span>150</span><span>100</span><span>50</span><span>0</span></div><div className="admin-bars">{[58,76,63,82,48,91,72].map((h,i)=><div className="admin-bar-wrap" key={i}><div className="admin-bar" style={{height:`${h}%`}}/><small>{15+i}/08</small></div>)}</div></div></div>
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Tổng quan tài khoản</h2><p>Trạng thái hiện tại</p></div></div><div className="admin-donut-row"><div className="admin-donut"><div><strong>{s?.users ?? "—"}</strong><span>tài khoản</span></div></div><div className="admin-legend"><p><i className="ok"/> Hoạt động <b>{s?.activeUsers ?? "—"}</b></p><p><i className="warn"/> Bị giới hạn <b>{s?.limitedUsers ?? "—"}</b></p><p><i className="bad"/> Bị khóa <b>{s?.lockedUsers ?? "—"}</b></p></div></div></div>
    </section>

    <section className="admin-two-col">
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Hoạt động học tập</h2><p>Phân loại lượt sử dụng</p></div><Link className="admin-text-link" to="/admin/security">Xem chi tiết</Link></div><div className="admin-activity-list"><Activity label="Luyện tập" value={s?.activities?.practice ?? "—"} icon="book"/><Activity label="Thi đấu" value={s?.activities?.tournament ?? "—"} icon="trophy"/><Activity label="Luyện từ tiếng Anh" value={s?.activities?.english ?? "—"} icon="brain"/><Activity label="Share tạo mới" value={s?.shares ?? "—"} icon="share"/></div></div>
      <div className="admin-panel"><div className="admin-panel-head"><div><h2>Quản trị nhanh</h2><p>Truy cập các khu vực thường dùng</p></div></div><div className="admin-quick-grid"><Link to="/admin/users"><AppIcon name="user"/><span>Tài khoản</span><small>Quản lý người dùng</small></Link><Link to="/admin/exams"><AppIcon name="library"/><span>Đề chính thức</span><small>Thêm / xóa / tải đề</small></Link><Link to="/admin/security"><AppIcon name="shield"/><span>Security Center</span><small>Vi phạm & cảnh báo</small></Link></div></div>
    </section>
  </div>;
}

function Activity({label,value,icon}:{label:string;value:any;icon:"book"|"trophy"|"brain"|"share"}) { return <div className="admin-activity"><span className="admin-activity-icon"><AppIcon name={icon} size={17}/></span><div><strong>{label}</strong><small>Hoạt động ghi nhận</small></div><b>{value}</b></div>; }

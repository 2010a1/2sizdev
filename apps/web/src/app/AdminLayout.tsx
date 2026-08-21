import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppIcon } from "./components/AppIcon";
import { useAuthStore } from "../state/authStore";

const sections = [
  { label: "Tổng quan", items: [{ to: "/admin", label: "Dashboard", icon: "home" as const, end: true }] },
  { label: "Quản lý", items: [
    { to: "/admin/users", label: "Tài khoản", icon: "user" as const },
    { to: "/admin/exams", label: "Đề chính thức", icon: "library" as const },
    { to: "/admin/ai", label: "AI & Groq API", icon: "spark" as const },
  ] },
  { label: "Nội dung", items: [
    { to: "/admin/security", label: "Security Center", icon: "shield" as const },
  ] },
];

export function AdminLayout() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("thi-thu:admin-sidebar") === "1");

  useEffect(() => {
    localStorage.setItem("thi-thu:admin-sidebar", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    document.body.classList.toggle("admin-mobile-open", !collapsed);
    return () => document.body.classList.remove("admin-mobile-open");
  }, [collapsed]);

  const current = sections.flatMap(s => s.items).find(item => location.pathname === item.to || (!item.end && location.pathname.startsWith(`${item.to}/`)));

  return (
    <div className={`admin-shell ${collapsed ? "admin-collapsed" : ""}`}>
      <button className="admin-sidebar-overlay" aria-label="Đóng menu" onClick={() => setCollapsed(true)} />
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-mark"><AppIcon name="spark" size={20} /></span>
          <div className="admin-brand-copy"><strong>Thi Thử</strong><small>ADMIN CONSOLE</small></div>
        </div>

        <div className="admin-sidebar-scroll">
          {sections.map(section => (
            <div className="admin-nav-section" key={section.label}>
              <div className="admin-nav-label">{section.label}</div>
              <nav className="admin-nav">
                {section.items.map(item => (
                  <NavLink key={item.to} to={item.to} end={item.end} title={collapsed ? item.label : undefined}
                    className={({ isActive }) => `admin-nav-item ${isActive ? "active" : ""}`}>
                    <AppIcon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="admin-sidebar-footer">
          <div className="admin-user-card">
            <span className="admin-avatar">{(user?.name || user?.username || "A").slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 admin-user-copy"><strong>{user?.name || user?.username || "Admin"}</strong><small>Quản trị viên</small></div>
          </div>
          <button className="admin-back-btn" onClick={() => navigate("/library")} title="Về trang học"><AppIcon name="arrow" size={15} /><span>Về trang học</span></button>
          <button className="admin-logout-btn" onClick={() => void logout()}><span>Đăng xuất</span></button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button className="admin-sidebar-toggle" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? "Mở sidebar" : "Đóng sidebar"} title={collapsed ? "Mở sidebar" : "Đóng sidebar"}>
              <AppIcon name="menu" size={20} />
            </button>
            <div><strong>Admin Console</strong><span>{current?.label || "Quản trị hệ thống"}</span></div>
          </div>
          <div className="admin-topbar-actions">
            <button className="admin-icon-btn" aria-label="Thông báo"><AppIcon name="bell" size={18} /></button>
            <div className="admin-topbar-user"><span className="admin-top-avatar">{(user?.name || user?.username || "A").slice(0, 1).toUpperCase()}</span><div><strong>{user?.name || user?.username || "admin"}</strong><small>Quản trị viên</small></div><span className="admin-chevron">⌄</span></div>
          </div>
        </header>
        <main className="admin-content"><Outlet /></main>
      </div>
    </div>
  );
}

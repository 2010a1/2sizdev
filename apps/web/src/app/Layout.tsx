import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { SyncBadge } from "./components/sync/SyncBadge";
import { NotificationBell } from "./components/NotificationBell";
import { AppIcon } from "./components/AppIcon";
import { useProfileStore } from "../state/profileStore";
import { useAuthStore } from "../state/authStore";
import { ProfileGate } from "./ProfileGate";
import { AiChatWidget } from "./components/ai/AiChatWidget";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "home" as const },
  { to: "/library", label: "Kho đề", icon: "library" as const },
  { to: "/vocabulary", label: "Từ vựng", icon: "brain" as const },
  { to: "/share", label: "Chia sẻ", icon: "share" as const },
  { to: "/account", label: "Tài khoản & hồ sơ", icon: "user" as const },
  { to: "/official-exams", label: "Đề chính thức", icon: "shield" as const },
  { to: "/wiki", label: "Hướng dẫn", icon: "book" as const },
];

export function Layout() {
  return <ProfileGate><LayoutContent /></ProfileGate>;
}

function LayoutContent() {
  const activeProfile = useProfileStore(s => s.activeProfile);
  const user = useAuthStore(s => s.user);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("thi-thu:sidebar-collapsed") === "1");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const theme = localStorage.getItem("thi-thu:theme") || "cyan";
  const dark = localStorage.getItem("thi-thu:dark") === "1";
  const appFont = localStorage.getItem("thi-thu:font") || "inter";
  const online = useOnlineStatus();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    document.documentElement.dataset.appFont = appFont;
  }, []);

  useEffect(() => {
    localStorage.setItem("thi-thu:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.body.classList.toggle("app-mobile-sidebar-open", mobileSidebarOpen);
    return () => document.body.classList.remove("app-mobile-sidebar-open");
  }, [mobileSidebarOpen]);

  const toggleSidebar = () => {
    if (window.matchMedia("(max-width: 800px)").matches) {
      setMobileSidebarOpen(v => !v);
    } else {
      setSidebarCollapsed(v => !v);
    }
  };

  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-sidebar-collapsed" : ""} ${mobileSidebarOpen ? "app-mobile-sidebar-open" : ""}`}>
      <button className="app-sidebar-overlay" aria-label="Đóng menu" onClick={closeMobileSidebar} />
      <aside className="app-sidebar">
        <NavLink to="/" className="brand-lockup">
          <span className="brand-mark"><AppIcon name="spark" size={22} /></span>
          <span><strong>Thi Thử</strong><small>Exam workspace</small></span>
        </NavLink>
        <button
          className="app-sidebar-close-mobile"
          aria-label="Đóng sidebar"
          onClick={closeMobileSidebar}
          title="Đóng sidebar"
        >
          <AppIcon name="close" size={18} />
        </button>
        <div className="sidebar-label">Không gian học tập</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => <NavItem key={item.to} {...item} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className={`offline-card ${online ? "mode-online" : "mode-offline"}`}><span className="status-dot" /><div><strong>{online ? "Online mode" : "Offline mode"}</strong><small>{online ? "Đang kết nối Internet." : "Đang làm việc không cần Internet."}</small></div></div>
          {activeProfile && <NavLink to="/account" className="profile-mini"><span className="avatar-mini">{activeProfile.avatar ? <img src={activeProfile.avatar} alt="" /> : "🙂"}</span><span className="min-w-0"><strong>{activeProfile.name}</strong><small>Hồ sơ hiện tại</small></span><AppIcon name="settings" size={16} /></NavLink>}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="app-sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed || mobileSidebarOpen ? "Mở sidebar" : "Đóng sidebar"}
              title={sidebarCollapsed || mobileSidebarOpen ? "Mở sidebar" : "Đóng sidebar"}
            >
              <AppIcon name="menu" size={20} />
            </button>
            <div className="mobile-brand"><span className="brand-mark small"><AppIcon name="spark" size={18} /></span><strong>Thi Thử</strong></div>
          </div>
          <div className="topbar-right"><SyncBadge />{user && <NotificationBell />}{user?.role === "ADMIN" && <NavLink to="/admin" className="btn-secondary !py-2 !px-3 text-xs">Admin</NavLink>}{!user && <NavLink to="/login" className="btn-secondary !py-2 !px-3 text-xs">Đăng nhập</NavLink>}{activeProfile && <NavLink to="/account" className="top-profile"><span className="top-profile-avatar">{activeProfile.avatar ? <img src={activeProfile.avatar} alt="" /> : "🙂"}</span><span className="hidden sm:inline">{activeProfile.name}</span></NavLink>}</div>
        </header>
        <main className="app-content"><Outlet /></main>
        <footer className="app-footer">cre <a href="https://2sizdev.fun/" target="_blank" rel="noreferrer">2sizdev</a></footer><AiChatWidget />
      </div>

    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: "home" | "library" | "book" | "trophy" | "brain" | "user" | "share" | "shield" }) {
  return <NavLink to={to} className={({ isActive }) => `sidebar-item ${isActive ? "active" : ""}`}><AppIcon name={icon} size={19} /><span>{label}</span></NavLink>;
}

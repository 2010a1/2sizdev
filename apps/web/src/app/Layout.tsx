import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { SyncBadge } from "./components/sync/SyncBadge";
import { AppIcon } from "./components/AppIcon";
import { useProfileStore } from "../state/profileStore";
import { useAuthStore } from "../state/authStore";
import { ProfileGate } from "./ProfileGate";
import { AiChatWidget } from "./components/ai/AiChatWidget";

const NAV_ITEMS = [
  { to: "/library", label: "Kho đề", icon: "library" as const },
  { to: "/practice", label: "Luyện tập", icon: "book" as const },
  { to: "/tournament", label: "Thi đấu", icon: "trophy" as const },
  { to: "/vocabulary", label: "Từ vựng", icon: "brain" as const },
  { to: "/share", label: "Chia sẻ", icon: "share" as const },
  { to: "/wiki", label: "Hướng dẫn", icon: "book" as const },
  { to: "/profile", label: "Hồ sơ", icon: "user" as const },
  { to: "/account", label: "Tài khoản", icon: "user" as const },
  { to: "/official-exams", label: "Đề chính thức", icon: "shield" as const },
];

export function Layout() {
  return <ProfileGate><LayoutContent /></ProfileGate>;
}

function LayoutContent() {
  const activeProfile = useProfileStore(s => s.activeProfile);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("thi-thu:sidebar-collapsed") === "1");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
        <NavLink to="/library" className="brand-lockup">
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
          <div className="offline-card"><span className="status-dot" /><div><strong>Offline-first</strong><small>Đề và bài làm vẫn dùng được khi mất mạng.</small></div></div>
          {activeProfile && <NavLink to="/profile" className="profile-mini"><span className="avatar-mini">{activeProfile.avatar || "🙂"}</span><span className="min-w-0"><strong>{activeProfile.name}</strong><small>Hồ sơ hiện tại</small></span><AppIcon name="settings" size={16} /></NavLink>}
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
          <div className="topbar-right"><SyncBadge />{user?.role === "ADMIN" && <NavLink to="/admin" className="btn-secondary !py-2 !px-3 text-xs">Admin</NavLink>}{user ? <button className="btn-secondary !py-2 !px-3 text-xs" onClick={() => void logout()}>Đăng xuất</button> : <NavLink to="/login" className="btn-secondary !py-2 !px-3 text-xs">Đăng nhập</NavLink>}{activeProfile && <NavLink to="/profile" className="top-profile"><span>{activeProfile.avatar || "🙂"}</span><span className="hidden sm:inline">{activeProfile.name}</span></NavLink>}</div>
        </header>
        <main className="app-content"><Outlet /></main><AiChatWidget />
      </div>

    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: "library" | "book" | "trophy" | "brain" | "user" | "share" | "shield" }) {
  return <NavLink to={to} className={({ isActive }) => `sidebar-item ${isActive ? "active" : ""}`}><AppIcon name={icon} size={19} /><span>{label}</span></NavLink>;
}

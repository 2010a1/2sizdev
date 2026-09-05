import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";

const themes = [["cyan","Cyan","#06b6d4"],["blue","Blue","#2563eb"],["violet","Violet","#7c3aed"],["emerald","Emerald","#059669"],["orange","Orange","#ea580c"],["rose","Rose","#e11d48"]] as const;
const fonts = [["inter","Inter / SF-like","Gọn, hiện đại, dễ đọc"],["system","System","Theo font hệ điều hành"],["rounded","Rounded","Mềm và thân thiện"]] as const;
const tabs=[["/account","Tài khoản & hồ sơ","user",""],["/account/settings","Cài đặt","settings",""],["/account/keybind","Keybind","spark","keybind-tab"]] as const;

export function SettingsPage(){
  const [theme,setTheme]=useState(localStorage.getItem("thi-thu:theme")||"cyan");
  const [dark,setDark]=useState(localStorage.getItem("thi-thu:dark")==="1");
  const [view,setView]=useState(localStorage.getItem("thi-thu:library-view")||"block");
  const [font,setFont]=useState(localStorage.getItem("thi-thu:font")||"inter");
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.documentElement.dataset.mode=dark?"dark":"light";
    document.documentElement.dataset.appFont=font;
    localStorage.setItem("thi-thu:theme",theme); localStorage.setItem("thi-thu:dark",dark?"1":"0");
    localStorage.setItem("thi-thu:library-view",view); localStorage.setItem("thi-thu:font",font);
  },[theme,dark,view,font]);
  return <div className="page-stack max-w-5xl mx-auto">
    <section className="page-hero"><div><span className="eyebrow">TÙY CHỈNH WORKSPACE</span><h1>Cài đặt</h1><p>Chỉnh giao diện và cách hiển thị mà không thay đổi nội dung hay font gốc của đề thi.</p></div></section>
    <AccountSectionNav />
    <section className="card settings-card"><div className="settings-heading"><div><span className="eyebrow">MÀU GIAO DIỆN</span><h2>Accent color</h2><p>Màu mặc định là Cyan. Màu chỉ thay đổi UI, không đổi dữ liệu đề.</p></div><span className="settings-preview-dot"/></div><div className="theme-choice-grid">{themes.map(([id,label,color])=><button type="button" key={id} className={`theme-choice ${theme===id?"selected":""}`} onClick={()=>setTheme(id)}><span className="theme-choice-swatch" style={{background:color}}/><span><b>{label}</b><small>{theme===id?"Đang dùng":"Chọn"}</small></span></button>)}</div></section>
    <section className="card settings-card"><div className="settings-heading"><div><span className="eyebrow">CHẾ ĐỘ</span><h2>Giao diện sáng / tối</h2><p>Dark mode dùng nền Deep Navy.</p></div><button type="button" className={`settings-switch ${dark?"on":""}`} onClick={()=>setDark(!dark)} aria-pressed={dark}><span/></button></div><div className="mode-choice-grid"><button type="button" className={`mode-choice ${!dark?"selected":""}`} onClick={()=>setDark(false)}>☀️<b>Light</b><small>Nền sáng sạch</small></button><button type="button" className={`mode-choice ${dark?"selected":""}`} onClick={()=>setDark(true)}>🌙<b>Dark</b><small>Deep Navy</small></button></div></section>
    <section className="card settings-card"><div><span className="eyebrow">KHO ĐỀ</span><h2>Dạng hiển thị đề thi</h2><p>Block hiển thị dạng card; List gọn và xem được nhiều đề hơn.</p></div><div className="view-choice-grid"><button type="button" className={`view-choice ${view==="block"?"selected":""}`} onClick={()=>setView("block")}><span className="view-preview block-preview"><i/><i/><i/></span><b>Block</b><small>Card đẹp, thông tin đầy đủ</small></button><button type="button" className={`view-choice ${view==="list"?"selected":""}`} onClick={()=>setView("list")}><span className="view-preview list-preview"><i/><i/><i/></span><b>List</b><small>Gọn, nhiều đề trên màn hình</small></button></div></section>
    <section className="card settings-card"><div><span className="eyebrow">PHÔNG CHỮ</span><h2>Font giao diện</h2><p>Chỉ áp dụng cho UI. <strong>Đề thi và nội dung toán / hóa giữ font gốc</strong> để tránh lỗi ký hiệu.</p></div><div className="font-choice-grid">{fonts.map(([id,label,desc])=><button type="button" key={id} className={`font-choice ${font===id?"selected":""}`} onClick={()=>setFont(id)}><b>{label}</b><small>{desc}</small><span className={`font-demo font-${id}`}>Aa 123 H₂O ∑x²</span></button>)}</div></section>
  </div>;
}

function AccountSectionNav(){
  return <section className="account-section-nav">{tabs.map(([to,label,icon,extra])=><NavLink key={to} to={to} end={to==='/account'} className={({isActive})=>`account-section-tab ${isActive?'active':''} ${extra}`}><AppIcon name={icon} size={17}/>{label}</NavLink>)}</section>;
}

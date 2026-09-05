import { NavLink } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
const tabs=[["/account","Tài khoản & hồ sơ","user",""],["/account/settings","Cài đặt","settings",""],["/account/keybind","Keybind","spark","keybind-tab"]] as const;

/** Every key below is what QuizPage actually handles (see keyboard.ts +
 * QuizPage keydown): number keys answer, Enter advances/submits. Nothing is
 * documented that the app does not implement. */
const GROUPS: Array<{ title: string; hint: string; rows: Array<[string, string]> }> = [
  {
    title: "Phím chung",
    hint: "Áp dụng cho mọi dạng câu hỏi.",
    rows: [
      ["Enter", "Sang câu tiếp (ở câu cuối: luyện tập mở hộp thoại Nộp bài; thi đấu xác nhận và sang câu kế tiếp)"],
      ["1 – 4", "Chọn đáp án / mệnh đề đang hiển thị (xem từng dạng bên dưới)"],
    ],
  },
  {
    title: "Trắc nghiệm ABCD (4 lựa chọn)",
    hint: "Phím bấm theo THỨ TỰ ĐÁP ÁN HIỂN THỊ trên màn hình (A/B/C/D có thể đã bị xáo trộn so với khi soạn đề), không theo ID nội bộ.",
    rows: [
      ["1", "Chọn đáp án A (ô đầu tiên đang hiển thị) — đúng hay sai phụ thuộc ô nào được tác giả đánh dấu Đúng khi soạn đề"],
      ["2", "Chọn đáp án B (ô thứ hai)"],
      ["3", "Chọn đáp án C (ô thứ ba)"],
      ["4", "Chọn đáp án D (ô thứ tư)"],
      ["Enter", "Chốt đáp án vừa chọn và sang câu tiếp"],
    ],
  },
  {
    title: "Đúng / Sai 4 mệnh đề",
    hint: "Mỗi câu gồm 4 ý (đã xáo trộn thứ tự hiển thị). Bấm phím lần 1 = Đúng, bấm tiếp cùng phím = Sai (bấm thêm lần nữa quay lại Đúng). Không có trạng thái bỏ chọn — muốn đổi ý cứ bấm lại.",
    rows: [
      ["1", "Mệnh đề 1 (dòng đầu đang hiển thị): lần 1 = Đúng, lần 2 = Sai"],
      ["2", "Mệnh đề 2: lần 1 = Đúng, lần 2 = Sai"],
      ["3", "Mệnh đề 3: lần 1 = Đúng, lần 2 = Sai"],
      ["4", "Mệnh đề 4: lần 1 = Đúng, lần 2 = Sai"],
      ["Enter", "Chỉ sang câu tiếp khi đã chọn Đúng/Sai cho cả 4 mệnh đề"],
    ],
  },
  {
    title: "Tự luận / điền đáp án ngắn",
    hint: "Gõ trực tiếp vào ô nhập liệu; bàn phím số dùng để đánh máy nên không có phím chọn đáp án.",
    rows: [
      ["Gõ văn bản", "Nhập đáp án vào ô (chấp nhận nhiều cách viết tương đương do tác giả khai báo)"],
      ["Enter", "Xác nhận đáp án và sang câu tiếp"],
    ],
  },
];

export function KeybindPage(){return <div className="page-stack max-w-5xl mx-auto"><section className="page-hero"><div><span className="eyebrow">KEYBIND</span><h1>Phím tắt</h1><p>Chi tiết từng phím theo từng dạng câu hỏi — dùng khi làm bài trên máy tính.</p></div></section><AccountSectionNav />
  {GROUPS.map(g=><section className="card keybind-card" key={g.title}><div className="keybind-group"><h2>{g.title}</h2><p className="text-xs muted mt-1">{g.hint}</p>{g.rows.map(([k,d])=><div className="keybind-row" key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div></section>)}
</div>}

function AccountSectionNav(){
  return <section className="account-section-nav">{tabs.map(([to,label,icon,extra])=><NavLink key={to} to={to} end={to==='/account'} className={({isActive})=>`account-section-tab ${isActive?'active':''} ${extra}`}><span><AppIcon name={icon} size={16}/></span>{label}</NavLink>)}</section>;
}

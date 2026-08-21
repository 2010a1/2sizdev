import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";

type WikiSection = {
  id: string;
  title: string;
  icon: "library" | "book" | "brain" | "share" | "spark" | "user";
  summary: string;
  content: Array<{ heading: string; body: string; bullets?: string[] }>;
};

const SECTIONS: WikiSection[] = [
  {
    id: "overview",
    title: "Bắt đầu",
    icon: "spark",
    summary: "Tổng quan nhanh về những gì bạn có thể làm trên Thi Thử.",
    content: [
      { heading: "Thi Thử có gì?", body: "Thi Thử là nơi bạn có thể tạo và quản lý đề, luyện tập, thi đấu, học từ vựng và chia sẻ nội dung với người khác." },
      { heading: "Các khu vực chính", body: "Bạn có thể bắt đầu từ Kho đề, Luyện tập, Thi đấu, Từ vựng hoặc Chia sẻ. Mỗi khu vực tập trung vào một nhu cầu khác nhau nhưng dữ liệu của bạn được giữ lại để có thể tiếp tục sử dụng bất cứ lúc nào." },
      { heading: "Dùng khi không có mạng", body: "Những đề và bộ từ đã có trên thiết bị vẫn có thể mở, làm bài và luyện tập khi không có Internet." },
    ],
  },
  {
    id: "library",
    title: "Kho đề & tạo đề",
    icon: "library",
    summary: "Nơi quản lý toàn bộ đề thi của bạn.",
    content: [
      { heading: "Kho đề", body: "Kho đề là nơi xem các đề đã tạo hoặc đã nhận. Bạn có thể mở đề để xem thông tin, chỉnh sửa, bắt đầu làm bài hoặc chia sẻ." },
      { heading: "Tạo đề mới", body: "Chọn Tạo đề mới để nhập tiêu đề, mô tả, thời gian và các câu hỏi. Bạn có thể tạo đề ngay cả khi đang offline." },
      { heading: "Các dạng câu hỏi", body: "Đề có thể gồm Trắc nghiệm ABCD, Đúng / Sai và Trả lời ngắn. Khi làm đề, các phần được hiển thị theo đúng thứ tự của đề thi thực tế: Phần I → Phần II → Phần III." },
      { heading: "Random câu hỏi", body: "Câu hỏi được xáo trộn trong từng phần để mỗi lần làm có thể có thứ tự khác nhau, nhưng không đảo lẫn ba phần của đề." },
      { heading: "Kết quả", body: "Sau khi nộp bài, bạn có thể xem điểm, câu đúng/sai và kết quả của lần làm. Các lần làm có thể được tiếp tục nếu chưa hoàn thành." },
      { heading: "Import / Export", body: "Bạn có thể sử dụng file .exam để mang đề sang thiết bị khác hoặc lưu lại làm bản sao." },
    ],
  },
  {
    id: "practice",
    title: "Luyện tập",
    icon: "book",
    summary: "Luyện đề theo cách thoải mái hơn trước khi thi.",
    content: [
      { heading: "Luyện một đề", body: "Chọn đề trong Luyện tập để bắt đầu làm. Bạn có thể luyện lại nhiều lần và theo dõi kết quả của từng lần." },
      { heading: "Xem đáp án và feedback", body: "Chế độ luyện tập hỗ trợ xem kết quả và phản hồi sau khi làm bài, tùy theo cấu hình của đề." },
      { heading: "Luyện lại", body: "Bạn có thể làm lại đề để cải thiện điểm hoặc kiểm tra lại những câu đã sai." },
      { heading: "Phù hợp khi nào?", body: "Dùng Luyện tập khi muốn học theo tốc độ của mình, kiểm tra kiến thức hoặc làm quen với một đề trước khi chuyển sang chế độ thi." },
    ],
  },
  {
    id: "tournament",
    title: "Thi đấu",
    icon: "spark",
    summary: "Làm đề theo không khí thi cử và theo dõi kết quả.",
    content: [
      { heading: "Bắt đầu thi", body: "Chọn một đề trong Thi đấu và bắt đầu một lượt thi. Giao diện tập trung vào việc hoàn thành bài trong thời gian được đặt cho đề." },
      { heading: "Thứ tự phần thi", body: "Đề vẫn giữ thứ tự Phần I — ABCD, Phần II — Đúng / Sai, Phần III — Trả lời ngắn. Câu hỏi bên trong từng phần có thể được xáo trộn." },
      { heading: "Thời gian và nộp bài", body: "Nếu đề có giới hạn thời gian, đồng hồ sẽ được hiển thị trong lúc thi. Khi hoàn thành, bạn có thể xem kết quả của lượt thi." },
      { heading: "Thi đấu khác Luyện tập", body: "Thi đấu phù hợp để mô phỏng một lượt thi hoàn chỉnh; Luyện tập phù hợp để học, xem feedback và làm lại nhiều lần." },
    ],
  },
  {
    id: "vocab",
    title: "Từ vựng & bộ từ",
    icon: "brain",
    summary: "Học từ, tạo bộ từ và luyện theo tiến độ của bạn.",
    content: [
      { heading: "Từ vựng", body: "Bạn có thể thêm từ mới, chỉnh sửa thông tin, xem chi tiết và bắt đầu luyện từng từ." },
      { heading: "Bộ từ", body: "Bộ từ giúp gom nhiều từ thành một chủ đề để dễ quản lý và luyện tập. Bạn có thể tạo, chỉnh sửa và xem chi tiết từng bộ." },
      { heading: "Luyện từ vựng", body: "Chọn một từ hoặc một bộ từ để bắt đầu luyện. Sau mỗi lượt, bạn có thể xem kết quả và tiếp tục ôn những nội dung cần nhớ." },
      { heading: "Nhận bộ từ từ người khác", body: "Vào Chia sẻ, nhập mã bộ từ và chọn Nhận bộ từ. Sau khi nhận, bộ từ xuất hiện trong khu vực Từ vựng và có thể học offline." },
    ],
  },
  {
    id: "share",
    title: "Chia sẻ & nhận",
    icon: "share",
    summary: "Chia sẻ đề hoặc bộ từ bằng một mã ngắn gọn.",
    content: [
      { heading: "Chia sẻ đề", body: "Mở đề → chọn Tạo mã chia sẻ. Sau khi tạo thành công, bạn nhận được một mã để gửi cho người khác." },
      { heading: "Chia sẻ bộ từ", body: "Mở bộ từ → chọn Chia sẻ để tạo mã. Người nhận chỉ cần mã này để lấy bộ từ về tài khoản của mình." },
      { heading: "Nhận nội dung", body: "Vào Chia sẻ → nhập mã → Kiểm tra mã. Hệ thống sẽ cho biết đây là Đề thi hay Bộ từ và hiển thị nút nhận tương ứng." },
      { heading: "Sau khi nhận", body: "Đề được đưa vào Kho đề, còn bộ từ được đưa vào Từ vựng. Sau đó bạn có thể sử dụng nội dung đã nhận ngay cả khi không có mạng." },
      { heading: "Mã chia sẻ", body: "Mã được thiết kế ngắn, dễ đọc và dễ nhập. Hãy sao chép chính xác mã khi gửi cho người khác." },
    ],
  },
  {
    id: "profile",
    title: "Hồ sơ & tiện ích",
    icon: "user",
    summary: "Các tùy chọn cá nhân và những tiện ích hỗ trợ việc học.",
    content: [
      { heading: "Hồ sơ", body: "Trang Hồ sơ là nơi xem thông tin cá nhân và các tùy chọn liên quan đến thiết bị của bạn." },
      { heading: "Tiếp tục học", body: "Các bài làm và tiến độ đang có có thể được tiếp tục thay vì phải bắt đầu lại từ đầu." },
      { heading: "Sao chép và lưu nội dung", body: "Bạn có thể xuất đề hoặc chia sẻ nội dung để tạo bản sao, thuận tiện khi đổi thiết bị hoặc gửi cho bạn bè." },
      { heading: "Mẹo sử dụng", body: "Nếu bạn đang chuẩn bị thi, hãy tạo hoặc nhận đề → luyện tập vài lần → kiểm tra lại các câu sai → sau đó chuyển sang Thi đấu để mô phỏng một lượt thi hoàn chỉnh." },
    ],
  },
];

export function WikiPage() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("overview");
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => `${s.title} ${s.summary} ${s.content.map((c) => `${c.heading} ${c.body} ${(c.bullets ?? []).join(" ")}`).join(" ")}`.toLocaleLowerCase().includes(q));
  }, [query]);
  const current = SECTIONS.find((s) => s.id === active) ?? visible[0] ?? SECTIONS[0];

  return <div className="wiki-layout">
    <aside className="wiki-sidebar">
      <div className="wiki-brand"><span className="brand-mark"><AppIcon name="book" size={20}/></span><div><span className="eyebrow">THI THỬ</span><strong>Hướng dẫn</strong></div></div>
      <div className="search-wrap wiki-search"><AppIcon name="search" size={17}/><input placeholder="Tìm trong hướng dẫn…" value={query} onChange={(e) => setQuery(e.target.value)}/></div>
      <nav className="wiki-nav">{visible.map((s) => <button key={s.id} className={current.id === s.id ? "active" : ""} onClick={() => setActive(s.id)}><AppIcon name={s.icon as any} size={17}/><span>{s.title}</span></button>)}</nav>
      <Link to="/share" className="wiki-cta"><AppIcon name="share" size={17}/><span>Đi tới Chia sẻ</span></Link>
    </aside>
    <main className="wiki-main">
      <section className="wiki-hero"><span className="eyebrow">WIKI / HƯỚNG DẪN SỬ DỤNG</span><h1>Thi Thử — Hướng dẫn</h1><p>Tìm hiểu các loại đề, cách luyện tập, từ vựng, chia sẻ nội dung và những tính năng chính của website.</p><div className="wiki-quick"><span><b>{SECTIONS.length}</b> chủ đề</span><span><b>Đề thi</b> + luyện tập</span><span><b>Từ vựng</b> + bộ từ</span><span><b>Chia sẻ</b> bằng mã</span></div></section>
      {query && <p className="wiki-result">Tìm thấy <b>{visible.length}</b> chủ đề phù hợp với “{query}”.</p>}
      <article className="wiki-article" key={current.id}>
        <div className="wiki-title-row"><div className="wiki-title-icon"><AppIcon name={current.icon as any} size={25}/></div><div><span className="eyebrow">CHỦ ĐỀ</span><h2>{current.title}</h2><p>{current.summary}</p></div></div>
        <div className="wiki-content">{current.content.map((section, i) => <section key={section.heading}><div className="wiki-number">{String(i + 1).padStart(2, "0")}</div><div><h3>{section.heading}</h3><p>{section.body}</p>{section.bullets && <ul>{section.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}</div></section>)}</div>
      </article>
      <section className="wiki-footer-card"><div><span className="eyebrow">BẮT ĐẦU NHANH</span><h3>Muốn nhận đề hoặc bộ từ?</h3><p>Mở Chia sẻ, nhập mã và nhận nội dung về thiết bị để sử dụng ngay.</p></div><Link className="btn-primary" to="/share"><AppIcon name="arrow" size={17}/> Nhận bằng mã</Link></section>
    </main>
  </div>;
}

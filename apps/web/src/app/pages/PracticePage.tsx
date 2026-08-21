import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { examService } from "../../domain/exam/exam.service";
import type { Exam } from "../../domain/exam/exam.types";

export function PracticePage() {
  const [exams, setExams] = useState<Exam[]>([]);
  useEffect(() => { void examService.listExams().then(setExams); }, []);
  return <div className="page-stack">
    <section className="mode-hero practice-hero"><div className="mode-icon"><AppIcon name="book" size={28} /></div><div><span className="eyebrow">CHẾ ĐỘ LUYỆN TẬP</span><h1>Học chắc từng câu</h1><p>Thoải mái quay lại, đánh dấu câu hỏi và xem kết quả sau khi hoàn thành.</p></div></section>
    <section className="section-heading"><div><h2>Chọn đề để luyện</h2><p>{exams.length} đề khả dụng trên thiết bị</p></div><Link className="btn-secondary" to="/library"><AppIcon name="library" size={17} />Mở kho đề</Link></section>
    {exams.length === 0 ? <div className="empty-state"><div className="empty-icon"><AppIcon name="book" size={30} /></div><h2>Chưa có đề để luyện</h2><p>Tạo hoặc import đề trong Kho đề. Dữ liệu sẽ được lưu cục bộ.</p><Link className="btn-primary" to="/library/new"><AppIcon name="plus" size={18} />Tạo đề</Link></div> : <div className="mode-list">{exams.map(e => <div className="mode-card" key={e.id}><div className="mode-card-icon"><AppIcon name="book" size={20} /></div><div className="mode-card-copy"><strong>{e.title}</strong><span>{e.subject}{e.grade ? ` · Lớp ${e.grade}` : ""}</span><small>{e.questionCount} câu{e.duration !== undefined ? ` · ${Math.round(e.duration / 60)} phút` : ""}</small></div><Link className="btn-primary" to={`/practice/${e.id}`}><AppIcon name="play" size={17} />Luyện</Link></div>)}</div>}
  </div>;
}

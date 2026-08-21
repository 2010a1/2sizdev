import { useState } from "react";
import { Link } from "react-router-dom";
import { useProfileStore } from "../../state/profileStore";
import { profileService } from "../../domain/profile/profile.service";
import { examRepository } from "../../domain/exam/exam.repository";
import type { Attempt } from "../../domain/exam/exam.types";
import { useEffect } from "react";

const AVATARS = ["🙂", "🦊", "🐱", "🐼", "🐸", "🦁", "🐵", "🐧"];

export function ProfilePage() {
  const { activeProfile, profiles, selectProfile, refresh, deleteProfile } = useProfileStore();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(activeProfile?.name ?? "");
  const [history, setHistory] = useState<Attempt[]>([]);
  const [examTitles, setExamTitles] = useState<Record<string, string>>({});
  useEffect(() => { if (!activeProfile) return; (async () => { const attempts = await examRepository.listAttempts(activeProfile.id) as Attempt[]; setHistory(attempts); const rows = await examRepository.listExams(true); setExamTitles(Object.fromEntries(rows.map(e => [e.id, e.title]))); })(); }, [activeProfile?.id]);

  if (!activeProfile) return null;

  async function handleRename() {
    if (!name.trim()) return;
    await profileService.renameProfile(activeProfile!.id, name);
    await refresh();
    setEditingName(false);
  }

  async function handleAvatarChange(avatar: string) {
    await profileService.changeAvatar(activeProfile!.id, avatar);
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa hồ sơ này? Toàn bộ lịch sử làm bài & từ vựng của hồ sơ sẽ bị xóa.")) return;
    // deleteProfile() also reconciles the active profile: if you deleted the
    // active one, it switches to whatever profile remains, or to null (which
    // sends you back to the "Chào mừng bạn" create screen) if none are left.
    await deleteProfile(id);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand-50 grid place-items-center text-2xl">
          {activeProfile.avatar || "🙂"}
        </div>
        <div className="flex-1">
          {editingName ? (
            <div className="flex gap-2">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoFocus
              />
              <button className="btn-primary" onClick={handleRename}>
                Lưu
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-lg">{activeProfile.name}</h2>
              <button
                className="text-sm text-brand-600"
                onClick={() => {
                  setName(activeProfile.name);
                  setEditingName(true);
                }}
              >
                Đổi tên
              </button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            Tham gia {new Date(activeProfile.createdAt).toLocaleDateString("vi-VN")}
          </p>
        </div>
      </section>

      <section className="card">
        <p className="text-sm font-medium mb-2">Đổi avatar</p>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => handleAvatarChange(a)}
              className={
                "w-10 h-10 rounded-full grid place-items-center text-lg border-2 " +
                (activeProfile.avatar === a ? "border-brand-600 bg-brand-50" : "border-transparent bg-gray-50")
              }
            >
              {a}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="text-sm font-medium mb-2">Chuyển hồ sơ / thiết bị này</p>
        <div className="flex flex-col gap-2">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between">
              <button
                className={
                  "flex items-center gap-2 px-3 py-2 rounded-lg flex-1 text-left " +
                  (p.id === activeProfile.id ? "bg-brand-50 text-brand-700" : "hover:bg-gray-50")
                }
                onClick={() => selectProfile(p.id)}
              >
                <span>{p.avatar || "🙂"}</span>
                {p.name}
                {p.id === activeProfile.id && <span className="text-xs">(đang dùng)</span>}
              </button>
              <button
                className="text-xs text-red-500 px-2"
                onClick={() => handleDelete(p.id)}
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3"><p className="text-sm font-medium">Lịch sử làm bài</p><span className="text-xs text-gray-400">{history.length} bài</span></div>
        {history.length === 0 ? <p className="text-sm text-gray-400">Chưa có lịch sử.</p> : <div className="space-y-2">{history.slice(0, 20).map(a => { const resultPath = a.mode === "practice" ? `/practice/${a.id}/result` : `/tournament/${a.id}/result`; return <Link key={a.id} to={resultPath} className="block rounded-xl border border-gray-100 p-3 hover:bg-gray-50"><div className="flex justify-between gap-2"><span className="font-medium text-sm">{examTitles[a.examId] ?? "Đề đã xóa"}</span><span className="text-xs">{a.mode === "practice" ? "📚 Luyện tập" : "🏆 Thi đấu"}</span></div><div className="text-xs text-gray-500 mt-1">{new Date(a.startedAt).toLocaleString("vi-VN")} · {a.status} · {a.score} điểm</div></Link> })}</div>}
      </section>
    </div>
  );
}

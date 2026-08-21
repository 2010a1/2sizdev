import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useProfileStore } from "../../state/profileStore";
import { vocabularySessionService } from "../../domain/vocabulary/vocabulary.session.service";
import type { VocabularySessionState } from "../../domain/vocabulary/vocabulary.types";
import { VocabularyMCQuestion } from "../components/vocabulary/VocabularyMCQuestion";
import { VocabularyTextQuestion } from "../components/vocabulary/VocabularyTextQuestion";
import { authApi } from '../../infrastructure/api/auth';
import { VocabularyLetterOrderQuestion } from "../components/vocabulary/VocabularyLetterOrderQuestion";

export function VocabularyPracticePage() {
  const { vocabularyId } = useParams();
  const profile = useProfileStore((s) => s.activeProfile)!;
  const navigate = useNavigate();
  const [session, setSession] = useState<VocabularySessionState>();
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vocabularyId) return;
    void (async () => {
      try {
        const active = await vocabularySessionService.resume(profile.id, vocabularyId);
        setSession(active ?? await vocabularySessionService.create(profile.id, vocabularyId)); void authApi.activity('english', profile.id).catch(()=>{});
      } catch (e) { setError(e instanceof Error ? e.message : "Không thể mở phiên"); }
    })();
  }, [profile.id, vocabularyId]);

  useEffect(() => {
    if (!session) return;
    const q = session.questions[session.currentQuestionIndex];
    setDraft(q ? (session.answers[q.id] ?? "") : "");
    setFeedback(null);
  }, [session?.currentQuestionIndex]);

  if (error) return <div className="card text-red-600">{error}</div>;
  if (!session) return <div>Đang tải...</div>;
  const currentSession = session;
  const question = currentSession.questions[currentSession.currentQuestionIndex];
  if (!question) return <div className="card">Không có câu hỏi.</div>;

  async function refresh() {
    const state = await vocabularySessionService.state(profile.id, session!.session.id);
    setSession(state);
  }

  async function checkAnswer() {
    try {
      const result = await vocabularySessionService.answer(profile.id, currentSession.session.id, draft);
      setFeedback(result.correct);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể lưu đáp án"); }
  }

  async function next() {
    try {
      if (currentSession.currentQuestionIndex === currentSession.questions.length - 1) {
        if (feedback === null && question.availability === "available") await vocabularySessionService.answer(profile.id, currentSession.session.id, draft);
        await vocabularySessionService.submit(profile.id, currentSession.session.id);
        navigate(`/vocabulary/${vocabularyId}/result`);
        return;
      }
      await vocabularySessionService.next(profile.id, currentSession.session.id);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể chuyển câu"); }
  }

  async function previous() { try { await vocabularySessionService.previous(profile.id, currentSession.session.id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không thể chuyển câu"); } }
  async function jump(index: number) { try { await vocabularySessionService.jump(profile.id, currentSession.session.id, index); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Không thể chuyển câu"); } }

  return <div className="space-y-4">
    <div className="flex justify-between"><Link className="text-sm text-gray-500" to={`/vocabulary/${vocabularyId}`}>← Thoát</Link><span className="text-sm text-gray-500">{currentSession.currentQuestionIndex + 1}/{currentSession.questions.length}</span></div>
    <div className="card">
      <div className="flex gap-1 mb-5">{currentSession.questions.map((q, i) => <button type="button" key={q.id} onClick={() => jump(i)} className={`h-2 flex-1 rounded ${i === currentSession.currentQuestionIndex ? "bg-brand-500" : currentSession.answers[q.id] !== undefined ? "bg-green-400" : "bg-gray-200"}`} />)}</div>
      {question.type === "MC_EN_TO_VI" ? <VocabularyMCQuestion question={question} value={draft} onChange={setDraft} /> : question.type === "LETTER_ORDER" ? <VocabularyLetterOrderQuestion question={question} value={draft} onChange={setDraft} /> : <VocabularyTextQuestion question={question} value={draft} onChange={setDraft} />}
      {feedback !== null && <div className={`mt-4 p-3 rounded-lg ${feedback ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{feedback ? "✓ Chính xác" : "✗ Chưa đúng"}</div>}
      <button className="btn-primary w-full mt-4" disabled={question.availability !== "available" || draft.length === 0 || feedback !== null} onClick={checkAnswer}>Kiểm tra</button>
    </div>
    <div className="flex gap-2"><button className="btn-secondary" onClick={async()=>{try{await vocabularySessionService.flag(profile.id,currentSession.session.id);await refresh()}catch(e){setError(e instanceof Error?e.message:"Không thể đánh dấu")}}}>🚩</button><button className="btn-secondary flex-1" disabled={currentSession.currentQuestionIndex === 0} onClick={previous}>Trước</button><button className="btn-primary flex-1" onClick={next}>{currentSession.currentQuestionIndex === currentSession.questions.length - 1 ? "Nộp bài" : "Tiếp"}</button></div>
  </div>;
}

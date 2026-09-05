import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProfileStore } from '../../state/profileStore';
import { examService } from '../../domain/exam/exam.service';
import { practiceService } from '../../domain/practice/practice.service';
import { PracticeController } from '../../domain/practice/practice.controller';
import { tournamentService } from '../../domain/tournament/tournament.service';
import { TournamentController } from '../../domain/tournament/tournament.controller';
import type { AnswerValue, Question } from '../../domain/exam/exam.types';
import type { PracticeState } from '../../domain/practice/practice.types';
import type { TournamentState } from '../../domain/tournament/tournament.types';
import { QuestionRenderer } from '../components/exam/QuestionRenderer';
import { answerFromKey, isAnswerValid, toggleTrueFalseStatement } from '../components/exam/keyboard';
import { getShuffledTrueFalseStatements } from '../components/exam/QuestionRenderer';
import { RichContent } from '../components/exam/RichContent';
import { Skeleton } from '../components/Skeleton';
import { authApi } from '../../infrastructure/api/auth';
import { sectionForQuestion, sectionLabel, EXAM_SECTION_ORDER } from '../../domain/tournament/competition.random';

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60 % 60), sec = s % 60;
  const p = (n: number) => n.toString().padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(sec);
}

/** Self-contained clock: ticks at 1Hz without re-rendering the quiz page.
 * Fires onExpire once when the remaining time hits zero. */
function QuizTimer({ startedAt, duration, onExpire }: { startedAt: number; duration?: number; onExpire: () => void }) {
  const [, tick] = useState(0);
  const firedRef = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  useEffect(() => {
    if (!duration) return;
    const id = window.setInterval(() => tick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [duration]);
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const remaining = duration ? Math.max(0, duration - elapsed) : elapsed;
  useEffect(() => {
    if (duration && remaining <= 0 && !firedRef.current) { firedRef.current = true; expireRef.current(); }
  }, [duration, remaining]);
  if (!duration) return <span className='font-mono text-sm' title='Thời gian đã làm'>{formatTime(elapsed)}</span>;
  const low = remaining <= 60;
  return (
    <span className={'font-mono text-sm tabular-nums' + (low ? ' text-warn font-semibold' : '')} title='Thời gian còn lại của bài thi'>
      Còn {formatTime(remaining)}
    </span>
  );
}

function sectionProgressOf(questions: Question[], answers: Record<string, AnswerValue>) {
  return EXAM_SECTION_ORDER.map(section => {
    const items = questions.filter(item => sectionForQuestion(item) === section);
    return { section, ...sectionLabel(section), total: items.length, answered: items.filter(item => answers[item.id] !== undefined).length };
  });
}

function SectionProgress({ sections, current }: { sections: ReturnType<typeof sectionProgressOf>; current: string }) {
  return (
    <div className='grid grid-cols-3 gap-2'>
      {sections.map(item => (
        <div key={item.section} className={'rounded-lg border border-line p-2 text-xs ' + (item.section === current ? 'font-semibold bg-accent-soft' : 'muted')}>
          <div>{item.shortTitle}</div>
          <div>{item.answered}/{item.total}</div>
        </div>
      ))}
    </div>
  );
}

/** Practice-only question navigator - shared by desktop rail and mobile drawer. */
function JumpGrid({ questions, answers, flagged, currentIndex, onJump }: {
  questions: Question[]; answers: Record<string, AnswerValue>; flagged: string[]; currentIndex: number; onJump: (index: number) => void;
}) {
  return (
    <div className='quiz-page-jump-grid flex flex-wrap gap-2'>
      {questions.map((question, index) => {
        const isCurrent = index === currentIndex;
        const isAnswered = answers[question.id] !== undefined;
        const isFlagged = flagged.includes(question.id);
        return (
          <button key={question.id}
            className={'quiz-page-jump-button w-9 h-9 rounded-lg text-sm border ' + (isCurrent ? 'border-accent bg-accent-soft font-semibold' : isAnswered ? 'bg-pass-soft border-line-pass' : 'bg-surface') + (isFlagged && !isCurrent ? ' border-line-warn' : '')}
            aria-label={'Câu ' + (index + 1) + (isAnswered ? ' đã trả lời' : '') + (isFlagged ? ' đã đánh dấu' : '')}
            onClick={() => onJump(index)}>{index + 1}</button>
        );
      })}
    </div>
  );
}

export function QuizPage({ mode }: { mode: 'practice' | 'tournament' }) {
  const { examId } = useParams();
  const nav = useNavigate();
  const profile = useProfileStore(s => s.activeProfile);
  const controllerRef = useRef<PracticeController | TournamentController | null>(null);
  const [state, setState] = useState<PracticeState | TournamentState>();
  const [pendingAnswer, setPendingAnswer] = useState<AnswerValue>();
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const lastEnterRef = useRef(0);
  const [duration, setDuration] = useState<number | undefined>();

  const refresh = () => { const c = controllerRef.current; if (c) setState(c.state); };

  useEffect(() => { if (!examId) return; void examService.getExam(examId).then(e => setDuration(e.duration)).catch(() => {}); }, [examId]);

  async function start(abandonExisting: boolean) {
    if (!profile || !examId) return;
    setLoading(true); setError('');
    try {
      if (mode === 'practice') {
        const existing = await practiceService.resume(profile.id, examId);
        if (abandonExisting && existing) await practiceService.abandon(existing.attempt.id);
        const session = abandonExisting ? await practiceService.create(profile.id, examId) : existing ?? await practiceService.create(profile.id, examId);
        controllerRef.current = new PracticeController(session);
      } else {
        const existing = await tournamentService.resume(profile.id, examId);
        if (abandonExisting && existing) await tournamentService.abandon(existing.attempt.id);
        const session = abandonExisting ? await tournamentService.create(profile.id, examId) : existing ?? await tournamentService.create(profile.id, examId);
        controllerRef.current = new TournamentController(session);
      }
      refresh(); setPendingAnswer(undefined); setRecovery(false); setLoading(false);
      void authApi.activity(mode, profile.id, examId).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể bắt đầu bài làm'); setLoading(false); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!profile || !examId) return;
      try {
        const existing = mode === 'practice' ? await practiceService.resume(profile.id, examId) : await tournamentService.resume(profile.id, examId);
        if (existing) {
          const expired = mode === 'practice' ? await practiceService.checkExpiration(existing.attempt.id) : await tournamentService.checkExpiration(existing.attempt.id);
          if (expired) { nav('/' + mode + '/' + existing.attempt.id + '/result'); return; }
          if (alive) { setRecovery(true); setLoading(false); }
          return;
        }
        await start(false);
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : 'Không thể mở bài làm'); setLoading(false); } }
    })();
    return () => { alive = false; };
  }, [profile?.id, examId, mode]);

  // Expiration is event-driven: timer hit zero, tab regained focus, device
  // came back online, page became visible. No per-second DB polling.
  const checkNow = useCallback(async () => {
    const c = controllerRef.current;
    if (!c) return;
    try {
      const result = mode === 'practice' ? await (c as PracticeController).checkExpiration() : await (c as TournamentController).checkExpiration();
      refresh();
      if (result) nav('/' + mode + '/' + c.attemptId + '/result');
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể kiểm tra thời gian'); }
  }, [mode, nav]);

  useEffect(() => {
    window.addEventListener('focus', checkNow);
    window.addEventListener('online', checkNow);
    document.addEventListener('visibilitychange', checkNow);
    return () => {
      window.removeEventListener('focus', checkNow);
      window.removeEventListener('online', checkNow);
      document.removeEventListener('visibilitychange', checkNow);
    };
  }, [checkNow]);

  const c = controllerRef.current;
  const questions = c?.questions ?? [];
  const isTournament = mode === 'tournament';
  const practiceState = state as PracticeState | undefined;
  const tournamentState = state as TournamentState | undefined;
  const currentIndex = isTournament ? (tournamentState?.currentQuestionIndex ?? 0) : (practiceState?.currentQuestionIndex ?? 0);
  const q = questions[currentIndex];
  const persistedAnswer = q && state ? state.answers[q.id] as AnswerValue | undefined : undefined;
  const answer = pendingAnswer ?? persistedAnswer;

  useEffect(() => { setPendingAnswer(undefined); }, [q?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if ((document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) && event.key !== 'Enter') return;
      const now = Date.now();
      if (event.key === 'Enter') {
        if (now - lastEnterRef.current < 250) return;
        lastEnterRef.current = now;
        if (isTournament) { if (isAnswerValid(answer)) { event.preventDefault(); void nextQuestion(); } }
        else { event.preventDefault(); void nextQuestion(); }
        return;
      }
      if (!q) return;
      if (q.type === 'TRUE_FALSE' && q.statements?.length === 4 && ['1', '2', '3', '4'].includes(event.key)) {
        const shown = getShuffledTrueFalseStatements(q.statements, (c?.attemptId ?? '') + ':' + q.id);
        const st = shown[Number(event.key) - 1];
        if (st) { event.preventDefault(); setPendingAnswer(toggleTrueFalseStatement(answer, st.id)); }
        return;
      }
      const mapped = answerFromKey(q, event.key);
      if (mapped) { event.preventDefault(); setPendingAnswer(mapped); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [q?.id, answer]);

  // Double-tap guard: while a commit is in flight the controller has not moved on
  // yet, so a second click would answer the same question again and advance twice.
  const committingRef = useRef(false);
  async function commit(a: AnswerValue, advancePractice: boolean) {
    if (!c || committingRef.current) return;
    committingRef.current = true;
    try {
      if (isTournament) {
        const result = await (c as TournamentController).answer(a);
        setPendingAnswer(undefined); refresh();
        if (result) nav('/tournament/' + c.attemptId + '/result');
      } else {
        const result = await (c as PracticeController).answer(a);
        setPendingAnswer(undefined); refresh();
        if (result.expired) nav('/practice/' + c.attemptId + '/result');
        else if (advancePractice) { await (c as PracticeController).next(); refresh(); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể lưu đáp án'); } finally { committingRef.current = false; }
  }

  async function nextQuestion() {
    if (!isTournament) {
      if (pendingAnswer && isAnswerValid(pendingAnswer)) await commit(pendingAnswer, true);
      else if (c) { await (c as PracticeController).next(); refresh(); }
      return;
    }
    if (!isAnswerValid(answer)) return;
    await commit(answer!, false);
  }

  async function submitPractice() {
    setConfirmSubmit(false);
    try {
      if (pendingAnswer && isAnswerValid(pendingAnswer)) await commit(pendingAnswer, false);
      if (!c) return;
      await (c as PracticeController).submit();
      nav('/practice/' + c.attemptId + '/result');
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể nộp bài'); }
  }

  async function jumpTo(index: number) {
    setNavOpen(false);
    if (!isTournament && c) { await (c as PracticeController).jump(index); refresh(); }
  }

  if (loading) return (
    <div className='quiz-page space-y-4' style={{ maxWidth: 1080 }}>
      <div className='quiz-page-topbar flex items-center justify-between gap-2'>
        <Skeleton className='h-9 w-24 rounded-xl' />
        <Skeleton className='h-5 w-40' />
        <Skeleton className='h-5 w-28' />
      </div>
      <div className='grid grid-cols-1 lg:grid-cols-[252px_1fr] gap-5 items-start'>
        <div className='card space-y-3 hidden lg:block'><Skeleton className='h-5 w-2/3' /><Skeleton className='h-16 rounded-lg' /><Skeleton className='h-4 w-1/2' /><div className='flex flex-wrap gap-2'>{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className='w-9 h-9 rounded-lg' />)}</div></div>
        <div className='space-y-4'>
          <div className='card space-y-4'><Skeleton className='h-4 w-48' /><Skeleton className='h-7 w-5/6' /></div>
          <div className='card space-y-3'>{[0, 1, 2, 3].map(i => <Skeleton key={i} className='h-12 rounded-xl' />)}</div>
        </div>
      </div>
    </div>
  );
  if (recovery) return (
    <div className='card space-y-4'>
      <h1 className='text-xl font-semibold'>Bạn có bài đang làm.</h1>
      <p className='muted'>Dữ liệu câu trả lời và thứ tự câu hỏi của phiên hiện tại đã được lưu trên thiết bị.</p>
      <div className='flex gap-2'><button className='btn-primary' onClick={() => start(false)}>Tiếp tục</button><button className='btn-secondary' onClick={() => start(true)}>Làm bài mới</button></div>
    </div>
  );
  if (error) return (
    <div className='card space-y-3'>
      <p className='text-grade whitespace-pre-wrap'>{error}</p>
      <Link className='btn-secondary inline-block' to='/library'>Về Kho đề</Link>
    </div>
  );
  if (!c || !state || !q) return <div className='card'>Không thể khởi tạo bài làm.</div>;

  const answered = Object.keys(state.answers).length;
  const startedAt = (isTournament ? tournamentState?.startedAt : practiceState?.startedAt) ?? Date.now();
  const currentSection = sectionForQuestion(q);
  const currentSectionMeta = sectionLabel(currentSection);
  const sectionProgress = sectionProgressOf(questions, state.answers);
  const flagged = !isTournament ? (practiceState?.flaggedQuestions ?? []) : [];
  const isLast = currentIndex >= questions.length - 1;
  const nextLabel = isLast ? (isTournament ? 'Kết thúc lượt' : 'Nộp bài') : 'Tiếp';
  const nextDisabled = isLast && !isTournament ? false : isTournament && !isAnswerValid(answer);
  function onNext() { if (isLast && !isTournament) setConfirmSubmit(true); else void nextQuestion(); }

  const navigatorCard = (
    <div className='card quiz-page-jump-card space-y-3'>
      <div>
        <div className='text-sm font-semibold'>{currentSectionMeta.title}</div>
        <div className='text-xs muted mt-0.5'>{isTournament ? 'Thi đấu · không quay lại' : 'Chạm số câu để đi tới'}</div>
      </div>
      <SectionProgress sections={sectionProgress} current={currentSection} />
      {!isTournament && (
        <>
          <div className='text-xs muted'><span className='text-warn'>★</span> = đã đánh dấu</div>
          <JumpGrid questions={questions} answers={state.answers} flagged={flagged} currentIndex={currentIndex} onJump={jumpTo} />
        </>
      )}
      {isTournament && (
        <div className='grid grid-cols-3 gap-2 text-center'>
          <div className='rounded-lg border border-line p-2'><div className='text-sm font-semibold'>{tournamentState?.correctCount ?? 0}</div><div className='text-xs muted'>Đúng</div></div>
          <div className='rounded-lg border border-line p-2'><div className='text-sm font-semibold'>{tournamentState?.wrongCount ?? 0}</div><div className='text-xs muted'>Sai</div></div>
          <div className='rounded-lg border border-line p-2'><div className='text-sm font-semibold'>{tournamentState?.streak ?? 0}</div><div className='text-xs muted'>Chuỗi</div></div>
        </div>
      )}
    </div>
  );

  return (
    <div className='quiz-page space-y-4' style={{ maxWidth: 1080 }}>
      <div className='quiz-page-topbar flex items-center justify-between gap-2'>
        <Link className='btn-secondary' to='/library' aria-label='Thoát bài làm'>← Thoát</Link>
        <div className='text-sm font-medium'>{isTournament ? '🏆 Thi đấu' : '📖 Luyện tập'} · Câu {currentIndex + 1}/{questions.length}</div>
        <QuizTimer startedAt={startedAt} duration={duration} onExpire={checkNow} />
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-[252px_1fr] gap-5 items-start'>
        <aside className='quiz-rail hidden lg:block'>{navigatorCard}</aside>

        <main className='quiz-main space-y-4 min-w-0'>
          {!isTournament && (
            <div className='rounded-xl border border-line-accent bg-accent-soft p-3 text-sm flex justify-between gap-3'>
              <span><b>Chế độ luyện tập</b> — quay lại, bỏ qua và sửa đáp án trước khi nộp.</span>
              <span className='whitespace-nowrap font-medium'>{answered}/{questions.length}</span>
            </div>
          )}
          <div className='card'>
            <div className='flex items-center justify-between gap-3'>
              <div className='text-sm muted flex items-center gap-2'>
                <span className='font-semibold text-ink'>Câu {currentIndex + 1}</span>
                <span>· {currentSectionMeta.shortTitle} · {q.type === 'ABCD' ? 'Trắc nghiệm' : q.type === 'TRUE_FALSE' ? 'Đúng/Sai' : 'Tự luận'}</span>
              </div>
              {!isTournament && (
                <button className='text-sm' onClick={async () => { await (c as PracticeController).toggleFlag(q.id); refresh(); }}
                  aria-pressed={practiceState!.flaggedQuestions.includes(q.id)}>
                  {practiceState!.flaggedQuestions.includes(q.id) ? '★ Đã đánh dấu' : '☆ Đánh dấu'}
                </button>
              )}
            </div>
            <div className='text-xl font-semibold mt-3 rich-question'><RichContent html={q.content} /></div>
          </div>
          <QuestionRenderer question={q} answer={answer} onAnswer={setPendingAnswer} shuffleSeed={c.attemptId} />
        </main>
      </div>

      <div className='quiz-mobilebar'>
        {!isTournament && (
          <button className='btn-secondary' disabled={practiceState!.currentQuestionIndex === 0} onClick={async () => { await (c as PracticeController).previous(); refresh(); }} aria-label='Câu trước'>← Trước</button>
        )}
        <button type='button' className='btn-secondary quiz-mobilebar-center' onClick={() => setNavOpen(true)}
          aria-label='Mở danh sách câu'>
          Câu {currentIndex + 1}/{questions.length}
        </button>
        <button className='btn-primary' disabled={nextDisabled} onClick={onNext}>{nextLabel} →</button>
      </div>

      {isTournament && <p className='text-center text-sm muted'>ABCD: 1–4 chọn đáp án · Đúng/Sai 4 mệnh đề: 1–4 chọn mệnh đề, nhấn lần đầu = Đúng, nhấn lần hai = Sai.</p>}

      {navOpen && (
        <div className='quiz-drawer-backdrop' onClick={() => setNavOpen(false)} role='presentation'>
          <div className='quiz-drawer' onClick={e => e.stopPropagation()} role='dialog' aria-label='Danh sách câu hỏi'>{navigatorCard}</div>
        </div>
      )}

      {confirmSubmit && (
        <div className='fixed inset-0 bg-black/30 grid place-items-center p-4 z-20'>
          <div className='card max-w-sm w-full space-y-3'>
            <h2 className='font-semibold'>Xác nhận nộp bài</h2>
            <p className='text-sm muted'>Bạn đã trả lời {answered}/{questions.length} câu. Nộp bài bây giờ?</p>
            <div className='flex gap-2'>
              <button className='btn-secondary flex-1' onClick={() => setConfirmSubmit(false)}>Tiếp tục làm</button>
              <button className='btn-primary flex-1' onClick={submitPractice}>Nộp bài</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

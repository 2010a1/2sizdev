import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate, useRouteError } from "react-router-dom";
import { Layout } from "./Layout";
import { AdminLayout } from "./AdminLayout";
import { AdminGuard } from "./AdminGuard";
// Eager (not lazy): the 404 page must live in the app-shell bundle so it also
// renders offline before any page chunk has been cached.
import { NotFoundPage } from "./pages/NotFoundPage";

// Route-level code splitting: every page is its own chunk; shared code
// (router, services, components) stays in the vendor chunk automatically.
const LoginPage = lazy(() => import("./pages/LoginPage").then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/RegisterPage").then(m => ({ default: m.RegisterPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const TournamentPage = lazy(() => import("./pages/TournamentPage").then(m => ({ default: m.TournamentPage })));
const QuizPage = lazy(() => import("./pages/QuizPage").then(m => ({ default: m.QuizPage })));
const AttemptResultPage = lazy(() => import("./pages/AttemptResultPage").then(m => ({ default: m.AttemptResultPage })));
const PracticePage = lazy(() => import("./pages/PracticePage").then(m => ({ default: m.PracticePage })));
const VocabularyPage = lazy(() => import("./pages/VocabularyPage").then(m => ({ default: m.VocabularyPage })));
const VocabularySetsPage = lazy(() => import("./pages/VocabularySetsPage").then(m => ({ default: m.VocabularySetsPage })));
const VocabularySetFormPage = lazy(() => import("./pages/VocabularySetFormPage").then(m => ({ default: m.VocabularySetFormPage })));
const VocabularySetDetailPage = lazy(() => import("./pages/VocabularySetDetailPage").then(m => ({ default: m.VocabularySetDetailPage })));
const VocabularySetPracticePage = lazy(() => import("./pages/VocabularySetPracticePage").then(m => ({ default: m.VocabularySetPracticePage })));
const VocabularySetResultPage = lazy(() => import("./pages/VocabularySetResultPage").then(m => ({ default: m.VocabularySetResultPage })));
const VocabularyFormPage = lazy(() => import("./pages/VocabularyFormPage").then(m => ({ default: m.VocabularyFormPage })));
const VocabularyDetailPage = lazy(() => import("./pages/VocabularyDetailPage").then(m => ({ default: m.VocabularyDetailPage })));
const VocabularyPracticePage = lazy(() => import("./pages/VocabularyPracticePage").then(m => ({ default: m.VocabularyPracticePage })));
const VocabularyResultPage = lazy(() => import("./pages/VocabularyResultPage").then(m => ({ default: m.VocabularyResultPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then(m => ({ default: m.LibraryPage })));
const OfficialExamsPage = lazy(() => import("./pages/OfficialExamsPage").then(m => ({ default: m.OfficialExamsPage })));
const CreateExamPage = lazy(() => import("./pages/CreateExamPage").then(m => ({ default: m.CreateExamPage })));
const ExamDetailPage = lazy(() => import("./pages/ExamDetailPage").then(m => ({ default: m.ExamDetailPage })));
const ExamEditorPage = lazy(() => import("./pages/ExamEditorPage").then(m => ({ default: m.ExamEditorPage })));
const AttemptPage = lazy(() => import("./pages/AttemptPage").then(m => ({ default: m.AttemptPage })));
const SharePage = lazy(() => import("./pages/SharePage").then(m => ({ default: m.SharePage })));
const WikiPage = lazy(() => import("./pages/WikiPage").then(m => ({ default: m.WikiPage })));
const AccountPage = lazy(() => import("./pages/AccountPage").then(m => ({ default: m.AccountPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const KeybindPage = lazy(() => import("./pages/KeybindPage").then(m => ({ default: m.KeybindPage })));
const AccountActivityPage = lazy(() => import("./pages/AccountActivityPage").then(m => ({ default: m.AccountActivityPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then(m => ({ default: m.AdminPage })));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage").then(m => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import("./pages/AdminUserDetailPage").then(m => ({ default: m.AdminUserDetailPage })));
const AdminStoragePage = lazy(() => import("./pages/AdminStoragePage").then(m => ({ default: m.AdminStoragePage })));
const AdminExamsPage = lazy(() => import("./pages/AdminExamsPage").then(m => ({ default: m.AdminExamsPage })));
const AdminSecurityPage = lazy(() => import("./pages/AdminSecurityPage").then(m => ({ default: m.AdminSecurityPage })));
const AdminAiPage = lazy(() => import("./pages/AdminAiPage").then(m => ({ default: m.AdminAiPage })));
const AdminNotificationsPage = lazy(() => import("./pages/AdminNotificationsPage").then(m => ({ default: m.AdminNotificationsPage })));
const AdminSettingsPage = lazy(() => import("./pages/AdminSettingsPage").then(m => ({ default: m.AdminSettingsPage })));

function RouteError(){const error=useRouteError();const message=error instanceof Error?error.message:"Đã xảy ra lỗi không xác định";return <div className="card max-w-xl mx-auto mt-10"><h1 className="text-xl font-bold">Có lỗi xảy ra</h1><p className="text-sm text-[var(--muted)] mt-2">{message}</p><button className="btn-primary mt-4" onClick={()=>window.location.assign("/")}>Về trang chủ</button></div>}

const PageFallback = () => <div className="empty-state"><h2>Đang tải…</h2></div>;
const withSuspense = (element: React.ReactNode) => <Suspense fallback={<PageFallback />}>{element}</Suspense>;

const appChildren = [
  { index: true, element: withSuspense(<DashboardPage />) },
  { path: "dashboard", element: withSuspense(<DashboardPage />) },
  { path: "tournament", element: withSuspense(<TournamentPage />) },
  { path: "tournament/:examId", element: withSuspense(<QuizPage mode="tournament" />) },
  { path: "tournament/:attemptId/result", element: withSuspense(<AttemptResultPage mode="tournament" />) },
  { path: "practice", element: withSuspense(<PracticePage />) },
  { path: "practice/:examId", element: withSuspense(<QuizPage mode="practice" />) },
  { path: "practice/:attemptId/result", element: withSuspense(<AttemptResultPage mode="practice" />) },
  { path: "vocabulary", element: withSuspense(<VocabularyPage />) },
  { path: "vocabulary/sets", element: withSuspense(<VocabularySetsPage />) },
  { path: "vocabulary/sets/new", element: withSuspense(<VocabularySetFormPage />) },
  { path: "vocabulary/sets/:setId", element: withSuspense(<VocabularySetDetailPage />) },
  { path: "vocabulary/sets/:setId/edit", element: withSuspense(<VocabularySetFormPage />) },
  { path: "vocabulary/sets/:setId/practice", element: withSuspense(<VocabularySetPracticePage />) },
  { path: "vocabulary/sets/:setId/result", element: withSuspense(<VocabularySetResultPage />) },
  { path: "vocabulary/new", element: withSuspense(<VocabularyFormPage />) },
  { path: "vocabulary/:vocabularyId", element: withSuspense(<VocabularyDetailPage />) },
  { path: "vocabulary/:vocabularyId/edit", element: withSuspense(<VocabularyFormPage />) },
  { path: "vocabulary/:vocabularyId/practice", element: withSuspense(<VocabularyPracticePage />) },
  { path: "vocabulary/:vocabularyId/result", element: withSuspense(<VocabularyResultPage />) },
  { path: "library", element: withSuspense(<LibraryPage />) },
  { path: "official-exams", element: withSuspense(<OfficialExamsPage />) },
  { path: "library/new", element: withSuspense(<CreateExamPage />) },
  { path: "library/:examId", element: withSuspense(<ExamDetailPage />) },
  { path: "library/:examId/edit", element: withSuspense(<ExamEditorPage />) },
  { path: "library/:examId/attempt", element: withSuspense(<AttemptPage />) },
  { path: "share", element: withSuspense(<SharePage />) },
  { path: "share/:code", element: withSuspense(<SharePage />) },
  { path: "wiki", element: withSuspense(<WikiPage />) },
  { path: "profile", element: <Navigate to="/account" replace /> },
  { path: "account", element: withSuspense(<AccountPage />) },
  { path: "account/settings", element: withSuspense(<SettingsPage />) },
  { path: "account/keybind", element: withSuspense(<KeybindPage />) },
  { path: "account/activity", element: withSuspense(<AccountActivityPage />) },
  // Unknown routes still render inside Layout, so ProfileGate keeps sending
  // unauthenticated visitors to /login instead of exposing a 404 page.
  { path: "*", element: <NotFoundPage /> },
];

const adminChildren = [
  { index: true, element: withSuspense(<AdminPage />) },
  { path: "users", element: withSuspense(<AdminUsersPage />) },
  { path: "users/:id", element: withSuspense(<AdminUserDetailPage />) },
  { path: "exams", element: withSuspense(<AdminExamsPage />) },
  { path: "security", element: withSuspense(<AdminSecurityPage />) },
  { path: "storage", element: withSuspense(<AdminStoragePage />) },
  { path: "ai", element: withSuspense(<AdminAiPage />) },
  { path: "notifications", element: withSuspense(<AdminNotificationsPage />) },
  { path: "settings", element: withSuspense(<AdminSettingsPage />) },
  { path: "*", element: <NotFoundPage /> },
];

export const router = createBrowserRouter([
  { path: "/login", element: withSuspense(<LoginPage />) },
  { path: "/register", element: withSuspense(<RegisterPage />) },
  {
    path: "/",
    element: <Layout />,
    errorElement:<RouteError/>,
    children: appChildren,
  },
  {
    path: "/admin",
    element: <AdminGuard><AdminLayout /></AdminGuard>,
    errorElement:<RouteError/>,
    children: adminChildren,
  },
  // Fallback for URLs that match no route above (normally shadowed by the
  // splat child of "/"): a bare 404 page outside any protected shell.
  { path: "*", element: <NotFoundPage /> },
]);

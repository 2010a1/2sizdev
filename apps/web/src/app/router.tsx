import { createBrowserRouter, Navigate, Outlet, useRouteError } from "react-router-dom";
import { Layout } from "./Layout";
import { AdminLayout } from "./AdminLayout";
import { TournamentPage } from "./pages/TournamentPage";
import { PracticePage } from "./pages/PracticePage";
import { VocabularyPage } from "./pages/VocabularyPage";
import { VocabularyFormPage } from "./pages/VocabularyFormPage";
import { VocabularyDetailPage } from "./pages/VocabularyDetailPage";
import { VocabularyPracticePage } from "./pages/VocabularyPracticePage";
import { VocabularyResultPage } from "./pages/VocabularyResultPage";
import { VocabularySetsPage } from "./pages/VocabularySetsPage";
import { VocabularySetFormPage } from "./pages/VocabularySetFormPage";
import { VocabularySetDetailPage } from "./pages/VocabularySetDetailPage";
import { VocabularySetPracticePage } from "./pages/VocabularySetPracticePage";
import { VocabularySetResultPage } from "./pages/VocabularySetResultPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CreateExamPage } from "./pages/CreateExamPage";
import { ExamDetailPage } from "./pages/ExamDetailPage";
import { ExamEditorPage } from "./pages/ExamEditorPage";
import { AttemptPage } from "./pages/AttemptPage";
import { QuizPage } from "./pages/QuizPage";
import { AttemptResultPage } from "./pages/AttemptResultPage";
import { SharePage } from "./pages/SharePage";
import { WikiPage } from "./pages/WikiPage";
import { AdminAiPage } from "./pages/AdminAiPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminUserDetailPage } from "./pages/AdminUserDetailPage";
import { AdminExamsPage } from "./pages/AdminExamsPage";
import { AdminSecurityPage } from "./pages/AdminSecurityPage";
import { OfficialExamsPage } from "./pages/OfficialExamsPage";
import { AccountPage } from "./pages/AccountPage";
import { AccountActivityPage } from "./pages/AccountActivityPage";
import { AdminGuard } from "./AdminGuard";

function RouteError(){const error=useRouteError();const message=error instanceof Error?error.message:"Đã xảy ra lỗi không xác định";return <div className="card max-w-xl mx-auto mt-10"><h1 className="text-xl font-bold">Có lỗi xảy ra</h1><p className="text-sm text-gray-600 mt-2">{message}</p><button className="btn-primary mt-4" onClick={()=>window.location.assign("/library")}>Về trang chủ</button></div>}

const appChildren = [
  { index: true, element: <Navigate to="/library" replace /> },
  { path: "tournament", element: <TournamentPage /> },
  { path: "tournament/:examId", element: <QuizPage mode="tournament" /> },
  { path: "tournament/:attemptId/result", element: <AttemptResultPage mode="tournament" /> },
  { path: "practice", element: <PracticePage /> },
  { path: "practice/:examId", element: <QuizPage mode="practice" /> },
  { path: "practice/:attemptId/result", element: <AttemptResultPage mode="practice" /> },
  { path: "vocabulary", element: <VocabularyPage /> },
  { path: "vocabulary/sets", element: <VocabularySetsPage /> },
  { path: "vocabulary/sets/new", element: <VocabularySetFormPage /> },
  { path: "vocabulary/sets/:setId", element: <VocabularySetDetailPage /> },
  { path: "vocabulary/sets/:setId/edit", element: <VocabularySetFormPage /> },
  { path: "vocabulary/sets/:setId/practice", element: <VocabularySetPracticePage /> },
  { path: "vocabulary/sets/:setId/result", element: <VocabularySetResultPage /> },
  { path: "vocabulary/new", element: <VocabularyFormPage /> },
  { path: "vocabulary/:vocabularyId", element: <VocabularyDetailPage /> },
  { path: "vocabulary/:vocabularyId/edit", element: <VocabularyFormPage /> },
  { path: "vocabulary/:vocabularyId/practice", element: <VocabularyPracticePage /> },
  { path: "vocabulary/:vocabularyId/result", element: <VocabularyResultPage /> },
  { path: "library", element: <LibraryPage /> },
  { path: "official-exams", element: <OfficialExamsPage /> },
  { path: "library/new", element: <CreateExamPage /> },
  { path: "library/:examId", element: <ExamDetailPage /> },
  { path: "library/:examId/edit", element: <ExamEditorPage /> },
  { path: "library/:examId/attempt", element: <AttemptPage /> },
  { path: "share", element: <SharePage /> },
  { path: "share/:code", element: <SharePage /> },
  { path: "wiki", element: <WikiPage /> },
  { path: "profile", element: <ProfilePage /> },
  { path: "account", element: <AccountPage /> },
  { path: "account/activity", element: <AccountActivityPage /> },
  // Any unknown route under the application shell is still protected by Layout/ProfileGate.
  { path: "*", element: <Navigate to="/library" replace /> },
];

const adminChildren = [
  { index: true, element: <AdminPage /> },
  { path: "users", element: <AdminUsersPage /> },
  { path: "users/:id", element: <AdminUserDetailPage /> },
  { path: "exams", element: <AdminExamsPage /> },
  { path: "security", element: <AdminSecurityPage /> },
  { path: "ai", element: <AdminAiPage /> },
  { path: "*", element: <Navigate to="/admin" replace /> },
];

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
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
  // Unknown absolute URLs are sent into the protected app shell. If the user
  // is not authenticated, ProfileGate sends them to /login instead of exposing
  // a page at an arbitrary route.
  { path: "*", element: <Navigate to="/library" replace /> },
]);

import { Navigate, useParams, useSearchParams } from "react-router-dom";
export function AttemptPage() { const { examId } = useParams(); const [params] = useSearchParams(); const mode = params.get("mode") === "tournament" ? "tournament" : "practice"; return <Navigate replace to={`/${mode}/${examId ?? ""}`} />; }

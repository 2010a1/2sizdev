import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { useEffect } from "react";
import { useAuthStore } from "../state/authStore";

export function App() {
  const initAuth=useAuthStore(s=>s.init);
  useEffect(()=>{void initAuth()},[initAuth]);
  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  );
}

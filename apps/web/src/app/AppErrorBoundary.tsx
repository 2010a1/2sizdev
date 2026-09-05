import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "../infrastructure/logger";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("ui boundary caught an error", {
      operation: "render",
      errorCode: error.name || "UI_ERROR"
    });
    void info;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ maxWidth: 720, margin: "4rem auto", padding: "1.5rem" }}>
        <h1>Ứng dụng gặp lỗi</h1>
        <p>Dữ liệu cục bộ chưa bị xóa. Hãy thử tải lại trang; nếu đang offline, kiểm tra lại IndexedDB và kết nối rồi thử lại.</p>
        <button type="button" onClick={() => window.location.reload()}>Tải lại</button>
      </main>
    );
  }
}

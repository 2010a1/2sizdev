import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";

/**
 * Rendered for any unknown route. Imported eagerly (not lazy) in the router
 * so the 404 page is part of the app-shell bundle and works offline even if
 * no other page chunk has been fetched yet.
 */
export function NotFoundPage() {
  return (
    <div className="notfound">
      <div className="notfound-code" aria-hidden="true">404</div>
      <h1>Không tìm thấy trang</h1>
      <p>Trang bạn đang tìm không tồn tại hoặc đã bị di chuyển. Đường dẫn này không thuộc ứng dụng.</p>
      <div className="notfound-actions">
        <Link className="btn-primary" to="/"><AppIcon name="home" size={17} />Về trang chủ</Link>
        <Link className="btn-secondary" to="/library"><AppIcon name="library" size={17} />Về Kho đề</Link>
      </div>
    </div>
  );
}

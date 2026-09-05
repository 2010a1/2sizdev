import { useProfileStore } from "../../../state/profileStore";
import { useSyncStatus } from "../../../hooks/useSyncStatus";
import { AppIcon } from "../AppIcon";

export function SyncBadge() {
  const profile = useProfileStore(s => s.activeProfile);
  const status = useSyncStatus(profile?.id);
  const offline = !navigator.onLine;
  const state = offline ? "offline" : status === "SYNCING" ? "syncing" : status === "ERROR" ? "error" : "online";
  const labels = { offline: "Ngoại tuyến", syncing: "Đang đồng bộ", error: "Lỗi đồng bộ", online: "Đã kết nối" };
  return <span className={`sync-pill ${state}`} title={state === "offline" ? "Bạn vẫn có thể học và làm bài offline" : undefined}><AppIcon name={state === "offline" ? "wifi" : "cloud"} size={14} /><span>{labels[state]}</span></span>;
}

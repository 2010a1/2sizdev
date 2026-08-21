import { useOnlineStatus } from "../../hooks/useOnlineStatus";

export function OnlineBadge() {
  const online = useOnlineStatus();
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium " +
        (online ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")
      }
    >
      {online ? "🟢 Online" : "🔴 Offline"}
    </span>
  );
}

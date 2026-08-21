import type { SVGProps } from "react";

type IconName =
  | "home" | "trophy" | "book" | "brain" | "library" | "user" | "plus"
  | "search" | "download" | "share" | "play" | "edit" | "star" | "clock" | "menu" | "bell" | "database" | "monitor"
  | "check" | "close" | "cloud" | "wifi" | "settings" | "upload" | "spark" | "arrow" | "shield";

const paths: Record<IconName, string[]> = {
  home: ["M3 10.5 12 3l9 7.5", "M5.5 9.5V21h13V9.5", "M9 21v-6h6v6"],
  trophy: ["M8 4h8v4a4 4 0 0 1-8 0V4Z", "M8 6H4v2a4 4 0 0 0 4 4", "M16 6h4v2a4 4 0 0 1-4 4", "M12 12v5", "M8 21h8", "M9 17h6"],
  book: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z", "M4 21V5.5", "M8 7h8", "M8 11h8"],
  brain: ["M9 4.5a3 3 0 0 0-5.7 1.3A3.2 3.2 0 0 0 4 12a3 3 0 0 0 2 5.5A3 3 0 0 0 12 19V7a3 3 0 0 0-3-2.5Z", "M15 4.5a3 3 0 0 1 5.7 1.3A3.2 3.2 0 0 1 20 12a3 3 0 0 1-2 5.5A3 3 0 0 1 12 19V7a3 3 0 0 1 3-2.5Z", "M8 9h2", "M14 9h2", "M7 14h3", "M14 14h3"],
  library: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z", "M4 21V5.5", "M8 7h8", "M8 11h8", "M8 15h5"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["m20 20-4.3-4.3", "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  share: ["M8 12a4 4 0 1 0-4 4", "M16 6a4 4 0 1 0 0 8", "m7.5 13.5 5-3", "m-5-1 5-3"],
  play: ["m9 6 10 6-10 6V6Z"],
  edit: ["m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z", "m13.5 7.5 3 3"],
  star: ["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  check: ["m5 12 4 4L19 6"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  cloud: ["M7 18h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 7a5 5 0 0 0 0 10Z"],
  wifi: ["M3 8.5a14 14 0 0 1 18 0", "M6 12a9.5 9.5 0 0 1 12 0", "M9.5 15.5a5 5 0 0 1 5 0", "M12 19h.01"],
  settings: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z", "M19 12a7.1 7.1 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.5 7.5 0 0 0-2.1-1.2L14 3h-4l-.4 2.7a7.5 7.5 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.1 7.1 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.4-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  shield: ["M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z", "m8 12 2.5 2.5L16 9"],
  spark: ["m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z", "m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  database: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
  monitor: ["M4 4h16v12H4z", "M8 20h8", "M12 16v4"]
};

export function AppIcon({ name, size = 20, strokeWidth = 1.9, ...props }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name].map((d, i) => <path key={i} d={d} />)}</svg>;
}

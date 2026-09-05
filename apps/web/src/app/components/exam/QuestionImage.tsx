import { useEffect, useState } from "react";
import { examRepository } from "../../../domain/exam/exam.repository";

export function QuestionImage({ assetId, remoteUrl, alt = "Hình ảnh câu hỏi", className = "" }: { assetId?: string; remoteUrl?: string; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true; let objectUrl: string | undefined;
    if (!assetId) { setSrc(remoteUrl); return () => {}; }
    void examRepository.getAsset(assetId).then(asset => {
      if (!alive || !asset) return;
      if (asset.data?.length) {
        const bytes = new Uint8Array(asset.data); const copy = bytes.slice(); objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: asset.mimeType || "image/jpeg" }));
        setSrc(objectUrl);
      } else if (asset.remoteUrl) setSrc(asset.remoteUrl);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, remoteUrl]);
  if (!src) return null;
  return <img src={src} alt={alt} className={`question-image max-h-[420px] max-w-full object-contain rounded-2xl border border-[var(--line-strong)] ${className}`} />;
}

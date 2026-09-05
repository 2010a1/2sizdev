import { request } from "./base";

export const imageApi = {
  uploadToImgBB: (payload: { base64: string; name: string; mimeType: string }) =>
    request<{ url: string; displayUrl?: string }>("/api/images/imgbb", { method: "POST", body: JSON.stringify(payload) })
};

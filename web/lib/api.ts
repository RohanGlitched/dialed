import { API } from "./site";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  } catch {
    throw new ApiError(0, "Can't reach Dialed's server. Check your connection and try again.");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body.error || `The server answered ${r.status}.`);
  return body as T;
}

export const get = <T,>(path: string) => call<T>(path);
export const post = <T,>(path: string, data: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(data) });

/** Stored images come back as /media/... (CDN) or /api/blob/... (local API). */
export function media(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/")) return API + url;
  return url;
}

/** Downscale a photo in the browser before upload: long side 1600 px, JPEG. */
export async function shrink(file: Blob, long = 1600): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const s = Math.min(1, long / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}

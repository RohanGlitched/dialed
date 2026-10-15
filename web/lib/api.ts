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

/** GETs are retried when the function is briefly at its concurrency cap (Lambda answers 429): pages that load
 * several gauges at once would otherwise show a gap. POSTs are not retried (a 429 there is the visitor limit). */
export async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<T>(path);
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 429 && e.status !== 503) || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1) + Math.random() * 250));
    }
  }
}
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

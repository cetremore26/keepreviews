/**
 * Photo storage for reviews (Pro plan only). Uses Supabase Storage's REST
 * API directly — no SDK dependency — since we already run our Postgres on
 * Supabase, so this reuses infrastructure instead of adding a vendor.
 *
 * Uploads happen from the public, unauthenticated app proxy submit route,
 * so every input here is treated as hostile: size and mime type are
 * enforced before anything touches the network.
 */

const MAX_PHOTOS_PER_REVIEW = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB decoded
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class PhotoUploadError extends Error {}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new PhotoUploadError("Photo must be a base64 data URL.");
  }
  return { mime: match[1], base64: match[2] };
}

async function uploadOne(dataUrl: string, shopDomain: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "review-photos";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new PhotoUploadError("Photo storage is not configured.");
  }

  const { mime, base64 } = parseDataUrl(dataUrl);
  const extension = ALLOWED_MIME_TYPES[mime];
  if (!extension) {
    throw new PhotoUploadError(`Unsupported image type: ${mime}`);
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("Photo must be between 1 byte and 2MB.");
  }

  const path = `${shopDomain}/${crypto.randomUUID()}.${extension}`;
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": mime,
        "x-upsert": "false",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new PhotoUploadError(`Upload failed (${response.status}): ${text}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/** Uploads up to MAX_PHOTOS_PER_REVIEW images and returns their public
 *  URLs. Silently drops photos beyond the cap rather than erroring, so a
 *  review with 5 attached photos still gets submitted with the first 3. */
export async function uploadReviewPhotos(
  dataUrls: string[],
  shopDomain: string,
): Promise<string[]> {
  const capped = dataUrls.slice(0, MAX_PHOTOS_PER_REVIEW);
  const urls: string[] = [];

  for (const dataUrl of capped) {
    urls.push(await uploadOne(dataUrl, shopDomain));
  }

  return urls;
}

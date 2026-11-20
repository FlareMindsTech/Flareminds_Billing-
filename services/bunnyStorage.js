const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_LOGO_BYTES = 450 * 1024;

export function isAllowedLogoMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mimeType);
}

export function extensionForMime(mimeType) {
  return MIME_EXTENSIONS[mimeType] || null;
}

export async function uploadCompanyLogo({ buffer, mimeType, companyId, kind }) {
  const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME;
  const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
  const cdnUrl = process.env.BUNNY_CDN_URL;

  if (!storageZone || !hostname || !accessKey || !cdnUrl) {
    const error = new Error("Bunny.net storage is not configured");
    error.status = 503;
    throw error;
  }

  if (!isAllowedLogoMime(mimeType)) {
    const error = new Error("Unsupported image type");
    error.status = 400;
    throw error;
  }

  if (!buffer || buffer.length === 0 || buffer.length > MAX_LOGO_BYTES) {
    const error = new Error("Logo image is too large or empty");
    error.status = 400;
    throw error;
  }

  const extension = extensionForMime(mimeType);
  const safeKind = kind === "text" ? "text" : "icon";
  const fileName = `${companyId}-${safeKind}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}.${extension}`;
  const storagePath = `billing/company-logos/${fileName}`;

  const baseHost = hostname.startsWith("http")
    ? hostname.replace(/\/+$/, "")
    : `https://${hostname}`;
  const uploadUrl = `${baseHost}/${storageZone}/${storagePath}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      AccessKey: accessKey,
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    const error = new Error(
      `Bunny.net upload failed with status ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
    error.status = 502;
    throw error;
  }

  const baseCdn = cdnUrl.replace(/\/+$/, "");
  return `${baseCdn}/${storagePath}`;
}
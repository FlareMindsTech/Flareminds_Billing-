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

export const LOGO_FETCH_TIMEOUT_MS = 8000;
export const LOGO_CACHE_TTL_MS = 5 * 60 * 1000;

// In-memory cache of remote logo fetches so repeated preview and PDF renders
// do not re-download the same CDN URL on every request.
const logoFetchCache = new Map(); // url => { dataUri: string | null, expiresAt: number }

async function fetchWithTimeout(url, { timeoutMs = LOGO_FETCH_TIMEOUT_MS, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

// Derives the Bunny origin-storage URL for a CDN logo URL, e.g.
// https://flareminds-billing-cdn.b-cdn.net/billing/company-logos/abc.webp
// -> https://storage.bunnycdn.com/<zone>/billing/company-logos/abc.webp
function cdnToStorageUrl(cdnUrl) {
  const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME;
  if (!storageZone || !hostname) return null;
  let parsed;
  try {
    parsed = new URL(cdnUrl);
  } catch {
    return null;
  }
  const baseHost = hostname.startsWith("http")
    ? hostname.replace(/\/+$/, "")
    : `https://${hostname}`;
  return `${baseHost}/${storageZone}${parsed.pathname}`;
}

// Verifies that an uploaded logo's public CDN URL returns HTTP 200 with an
// image Content-Type, so a broken upload is detected at upload time.
export async function verifyPublicLogoUrl(url) {
  try {
    const response = await fetchWithTimeout(url);
    const contentType = response.headers.get("content-type") || "";
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      isImage: /^image\//i.test(contentType),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      isImage: false,
      error: String(err?.message || err),
    };
  }
}

// Fetches a remote logo URL on the backend and inlines it as a
// data:image/<mime>;base64,... data URI. Tries the CDN URL first, then falls
// back to the Bunny origin storage (authenticated) when the pull zone is not
// publicly readable. Results are cached in memory for LOGO_CACHE_TTL_MS.
export async function fetchLogoAsDataUri(url) {
  const now = Date.now();
  const cached = logoFetchCache.get(url);
  if (cached && cached.expiresAt > now) return cached.dataUri;

  let dataUri = null;
  let response = null;
  try {
    response = await fetchWithTimeout(url);
    if (!response.ok) response = null;
  } catch {
    response = null;
  }

  if (!response) {
    const storageUrl = cdnToStorageUrl(url);
    const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
    if (storageUrl && accessKey) {
      try {
        const storageResponse = await fetchWithTimeout(storageUrl, {
          headers: { AccessKey: accessKey },
        });
        if (storageResponse.ok) response = storageResponse;
      } catch {
        response = null;
      }
    }
  }

  if (response) {
    const contentType = response.headers.get("content-type") || "";
    const mimeMatch = contentType.match(/^image\/([a-zA-Z0-9.+-]+)/i);
    const mime = (mimeMatch ? mimeMatch[1] : "png").toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    dataUri = `data:image/${mime === "jpg" ? "jpeg" : mime};base64,${buffer.toString("base64")}`;
  }

  logoFetchCache.set(url, { dataUri, expiresAt: now + LOGO_CACHE_TTL_MS });
  return dataUri;
}

// Proxies a configured CDN logo URL through the backend so browser-side logo
// previews (Company Settings > Branding) never depend on the CDN allowing the
// page's origin or a null origin. Only URLs on the configured CDN host are
// proxied (SSRF guard).
export async function serveCompanyLogoProxy(req, res) {
  const { url } = req.query || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "url query parameter is required" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ message: "Invalid url" });
  }

  const cdnUrl = process.env.BUNNY_CDN_URL || "";
  let cdnHost;
  try {
    cdnHost = new URL(cdnUrl).hostname;
  } catch {
    return res.status(503).json({ message: "CDN is not configured" });
  }
  if (!cdnHost || parsed.hostname !== cdnHost || parsed.protocol !== "https:") {
    return res.status(403).json({ message: "Only configured CDN logo URLs are proxied" });
  }

  let response = null;
  try {
    response = await fetchWithTimeout(url);
    if (!response.ok) response = null;
  } catch {
    response = null;
  }

  if (!response) {
    const storageUrl = cdnToStorageUrl(url);
    const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
    if (storageUrl && accessKey) {
      try {
        const storageResponse = await fetchWithTimeout(storageUrl, {
          headers: { AccessKey: accessKey },
        });
        if (storageResponse.ok) response = storageResponse;
      } catch {
        response = null;
      }
    }
  }

  if (!response) {
    return res.status(502).json({ message: "Unable to fetch logo" });
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  res.set({
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
  res.status(response.status).send(buffer);
}
/**
 * Gzip helpers via native CompressionStream (Chrome 80+, Firefox 113+, Safari 16.4+).
 * Fallback graceful: return null kalau API tidak tersedia / gagal.
 */

const HAS_GZIP =
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

export function hasGzip() {
  return HAS_GZIP;
}

export async function gzipBytes(bytes) {
  if (!HAS_GZIP) return null;
  try {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.warn("[gzip] compress failed:", e);
    return null;
  }
}

export async function gunzipBytes(bytes) {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.warn("[gzip] decompress failed:", e);
    return null;
  }
}

export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
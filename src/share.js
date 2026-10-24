/**
 * Encode/decode share data (tab aktif) ke/dari URL-safe string.
 *
 * Format payload: [kind][base64url(bytes)]
 *   kind = 'z' → gzip-compressed JSON
 *   kind = 'p' → plain JSON (fallback)
 *
 * JSON schema: { v: 1, name, code, params }
 */

export async function encodeShareTab(tab) {
  const data = {
    v: 1,
    name: tab.name || 'Shared',
    code: tab.code || '',
    params: tab.paramValues || {}
  };
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const compressed = await new Response(cs.readable).arrayBuffer();
      return 'z' + bytesToBase64Url(new Uint8Array(compressed));
    } catch (e) {
      console.warn('[share] gzip failed, fallback plain:', e);
    }
  }
  return 'p' + bytesToBase64Url(bytes);
}

export async function decodeShareTab(str) {
  if (!str || typeof str !== 'string') throw new Error('Share data kosong');

  const kind = str[0];
  const payload = str.slice(1);
  const bytes = base64UrlToBytes(payload);

  let json;
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Browser tidak mendukung DecompressionStream');
    }
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const out = await new Response(ds.readable).arrayBuffer();
    json = new TextDecoder().decode(new Uint8Array(out));
  } else if (kind === 'p') {
    json = new TextDecoder().decode(bytes);
  } else {
    throw new Error('Format share tidak dikenal: ' + kind);
  }

  const data = JSON.parse(json);
  if (!data || typeof data.code !== 'string') throw new Error('Data share tidak valid');

  return {
    name: data.name || 'Shared',
    code: data.code,
    paramValues: (data.params && typeof data.params === 'object') ? data.params : {}
  };
}

export function buildShareUrl(hash) {
  const base = location.href.split('#')[0];
  return base + '#s=' + hash;
}

export async function readShareFromUrl() {
  if (!location.hash) return null;
  const m = /^#s=(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return await decodeShareTab(m[1]);
  } catch (e) {
    console.warn('[share] decode gagal:', e);
    return null;
  }
}

/* --- helpers --- */

function bytesToBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;  // hindari limit apply()
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
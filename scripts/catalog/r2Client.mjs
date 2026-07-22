// The R2 HTTP adapter - the ONE place request SHAPES are built. Everything is expressed over an
// injected `signedFetch` (in production, aws4fetch's SigV4 fetch) and an injected `plainFetch` (the
// public unauthenticated GET), so a test can drive the exact bytes on the wire - proving the
// conditional PUT really carries `If-None-Match: *` and that a 412 is followed by a HEAD - without a
// network or credentials. This closes the "fake seam" gap: the safety-critical request sequence is
// executable-tested, not merely inspected.
import { contentMd5 } from './artManifest.mjs';
import { stripQuotes } from './cdnUpload.mjs';

const decodeXml = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * @param signedFetch async (url, { method, headers, body }) -> Response  (SigV4-signed in production)
 * @param plainFetch  async (url) -> Response                              (public read, unauthenticated)
 * @param endpoint    R2 S3 endpoint (no trailing slash)
 * @param bucket      bucket name
 * @param cacheControl Cache-Control header written on every object
 */
export function createR2Client({ signedFetch, plainFetch, endpoint, bucket, cacheControl, contentType = 'image/webp' }) {
  const objUrl = (key) => `${endpoint}/${bucket}/${encodeURI(key)}`;

  // One PUT primitive. `ifNoneMatch:'*'` makes it a create-only conditional PUT (R2 -> 412 if the key
  // exists); Content-MD5 lets R2 reject a corrupted body. A 412 is a valid, expected outcome - only a
  // non-2xx, non-412 status throws. Returns { status, ok, etag }.
  const putRequest = async (key, body, { md5, type = contentType, ifNoneMatch } = {}) => {
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl };
    if (md5) headers['Content-MD5'] = contentMd5(md5);
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
    const res = await signedFetch(objUrl(key), { method: 'PUT', headers, body });
    if (!res.ok && res.status !== 412) throw new Error(`PUT ${key} -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
    return { status: res.status, ok: res.ok, etag: stripQuotes(res.headers.get('etag')) };
  };

  // Authoritative HEAD for the 412 branch -> { size, etag } | null (404).
  const headObject = async (key) => {
    const res = await signedFetch(objUrl(key), { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD ${key} -> ${res.status} ${res.statusText}`);
    return { size: Number(res.headers.get('content-length')), etag: res.headers.get('etag') };
  };

  // ListObjectsV2 -> Map<key, { size, etag }>, paginated. The continuation token is XML-decoded, and a
  // truncated page without a token fails closed - a silently short listing must never look complete.
  const list = async () => {
    const map = new Map();
    let token = null;
    do {
      const url = new URL(`${endpoint}/${bucket}`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', '1000');
      if (token) url.searchParams.set('continuation-token', token);
      const res = await signedFetch(url.toString(), { method: 'GET' });
      if (!res.ok) throw new Error(`LIST -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = m[1];
        const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
        const size = parseInt((block.match(/<Size>(\d+)<\/Size>/) || [])[1], 10);
        const etag = (block.match(/<ETag>([\s\S]*?)<\/ETag>/) || [])[1];
        if (key) map.set(decodeXml(key), { size, etag });
      }
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
      const raw = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
      if (truncated && !raw) throw new Error('LIST: truncated page without a continuation token (listing would be incomplete)');
      token = truncated ? decodeXml(raw) : null;
    } while (token);
    return map;
  };

  const publicGet = async (url) => plainFetch(url);

  return { putRequest, headObject, list, publicGet, objUrl };
}

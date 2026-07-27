/**
 * Cloudflare Worker — reverse proxy for the ProInsights backoffice.
 *
 * Why: Render's Hobby workspace caps custom domains at 2 (already used by
 * procertify-backend and ehi-backend). Rather than upgrading the workspace
 * to Professional ($19/mo), this Worker serves app.proinsights.com.cy by
 * proxying transparently to https://proinsights-backoffice.onrender.com.
 *
 * What it handles:
 *   - Forwards all methods (GET/POST/PUT/DELETE/PATCH) with body intact
 *   - Sets Host header to upstream so Render's router picks the right service
 *   - Sets X-Forwarded-Host / X-Forwarded-Proto so FastAPI knows the real
 *     public host (uvicorn was launched with --proxy-headers --forwarded-allow-ips='*')
 *   - Rewrites Set-Cookie headers: strips Domain=.onrender.com so cookies
 *     bind to app.proinsights.com.cy instead
 *   - Rewrites 3xx Location redirects from upstream → public host
 *   - Streams response body unchanged (no buffering — works for SSE/large)
 *
 * Deploy:
 *   1. Cloudflare dashboard → Compute → Workers & Pages → Create
 *      → "Hello World" template → name: proinsights-backoffice-proxy
 *   2. Paste this file into the code editor → Save and Deploy
 *   3. Add route: app.proinsights.com.cy/* → this Worker
 *   4. DNS: add CNAME app → proinsights-backoffice.onrender.com, Proxied (orange cloud)
 */

const UPSTREAM_HOST = "proinsights-backoffice.onrender.com";
const PUBLIC_HOST = "app.proinsights.com.cy";

export default {
  async fetch(request, env, ctx) {
    const inUrl = new URL(request.url);

    // Build upstream URL — same path + query, but pointing at Render.
    const upstreamUrl = new URL(inUrl.pathname + inUrl.search, `https://${UPSTREAM_HOST}`);

    // Clone headers and adjust for the upstream call.
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set("Host", UPSTREAM_HOST);
    // Tell uvicorn what the *real* public host is so FastAPI URL builders
    // (invite links, password-reset links, redirects) use the right domain.
    upstreamHeaders.set("X-Forwarded-Host", PUBLIC_HOST);
    upstreamHeaders.set("X-Forwarded-Proto", "https");
    // Preserve client IP (Cloudflare provides CF-Connecting-IP)
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) {
      upstreamHeaders.set("X-Forwarded-For", clientIp);
      upstreamHeaders.set("X-Real-IP", clientIp);
    }
    // Strip CF-* helper headers from the outbound request — Render doesn't need them.
    for (const key of [...upstreamHeaders.keys()]) {
      if (key.toLowerCase().startsWith("cf-")) upstreamHeaders.delete(key);
    }

    // Build the upstream request. Body is streamed for non-GET/HEAD.
    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual", // we'll rewrite Location ourselves
    });

    const upstreamResponse = await fetch(upstreamRequest);

    // Build response headers, rewriting cookies + redirects.
    const outHeaders = new Headers();
    const setCookies = upstreamResponse.headers.getSetCookie
      ? upstreamResponse.headers.getSetCookie()
      : [];

    for (const [name, value] of upstreamResponse.headers) {
      const lower = name.toLowerCase();
      if (lower === "set-cookie") continue; // handled below
      if (lower === "location") {
        outHeaders.set(
          "Location",
          rewriteLocation(value),
        );
        continue;
      }
      // Render sometimes adds these — skip them so we don't double-encode.
      if (lower === "content-encoding" || lower === "transfer-encoding") continue;
      outHeaders.set(name, value);
    }

    // Re-add Set-Cookie headers (one per cookie, with Domain stripped).
    for (const cookie of setCookies) {
      outHeaders.append("Set-Cookie", rewriteCookie(cookie));
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: outHeaders,
    });
  },
};

/**
 * Strip any explicit Domain= attribute so the cookie defaults to the
 * request host (app.proinsights.com.cy). Also rewrite any literal
 * upstream-host references inside the cookie value.
 */
function rewriteCookie(cookieStr) {
  return cookieStr
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replaceAll(UPSTREAM_HOST, PUBLIC_HOST);
}

/**
 * Rewrite Location headers from upstream → public host so redirects
 * don't leak the .onrender.com URL into the user's browser bar.
 */
function rewriteLocation(loc) {
  // Absolute URL pointing at upstream: rewrite the host.
  const upstreamPattern = new RegExp(`https?://${escapeRegex(UPSTREAM_HOST)}`, "gi");
  return loc.replace(upstreamPattern, `https://${PUBLIC_HOST}`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

# Cloudflare Worker proxy — deploy guide

Routes `https://app.proinsights.com.cy/*` to the Render backoffice
(`proinsights-backoffice.onrender.com`) without using up Render's
custom-domain quota (Hobby workspace is capped at 2 custom domains).

Total time: ~10 minutes. All free.

## Step 1 — Create the Worker

1. Open https://dash.cloudflare.com
2. Top-right account → **Compute** → **Workers & Pages**
3. Click **Create** → **Hello World** template (start simple)
4. Worker name: `proinsights-backoffice-proxy`
5. Click **Deploy** (deploys the placeholder Hello World)

## Step 2 — Paste the real code

1. After deploy, click **Edit code** (or "Continue to project" → "Edit code")
2. Cloudflare's editor opens with the Hello World placeholder
3. Select all (Ctrl+A), delete, paste the entire contents of `worker.js`
   (this directory)
4. Top right → **Save and Deploy**

## Step 3 — Add the route binding

1. From the Worker page → **Settings** tab → **Triggers**
2. Section **Routes** → click **+ Add Route**
3. Fill in:
   - Route: `app.proinsights.com.cy/*`
   - Zone: `proinsights.com.cy`
4. Click **Add Route**

## Step 4 — Add DNS so the hostname resolves

The Worker route binds to a hostname, but the hostname must exist in DNS
so browsers know to send requests to Cloudflare's edge.

1. Cloudflare dashboard → `proinsights.com.cy` → **DNS** → **Records**
2. Click **Add record**:
   - Type: `AAAA`
   - Name: `app`
   - IPv6 address: `100::` (Cloudflare's "Black Hole" placeholder — the
     Worker intercepts before this is ever used)
   - Proxy status: **Proxied** (orange cloud — REQUIRED for Worker routes)
   - TTL: Auto
3. Save

> Alternative: a CNAME record `app` → `proinsights-backoffice.onrender.com`
> proxied. Either works because the Worker intercepts.

## Step 5 — Test

```bash
curl -sI https://app.proinsights.com.cy/api/admin/health
# Expect: HTTP/2 200, with Server: cloudflare in headers
curl -s https://app.proinsights.com.cy/api/admin/health
# Expect: {"ok": true, "db": true}
```

Then open https://app.proinsights.com.cy/login in a browser →
log in with `admin@proinsights.com.cy` / `12345678`.

## Smoke-test checklist after deploy

- [ ] `GET /api/admin/health` returns `{"ok": true, "db": true}`
- [ ] `/login` renders the sign-in form (CSS + JS load)
- [ ] Login succeeds and lands on `/admin`
- [ ] Cookie in DevTools → Application → Cookies has Domain=`app.proinsights.com.cy`
      (NOT `.onrender.com`). If wrong, the cookie rewriting in worker.js failed.
- [ ] After logout/login cycle, session persists across reloads
- [ ] Form submissions work (e.g. accept legal docs, create a draft tenant)
- [ ] No 502 errors in the worker logs (Cloudflare dashboard → Worker → Logs)

## Troubleshooting

### Login redirects to onrender.com after success
The Location rewrite in `rewriteLocation()` missed a case. Capture the
response in DevTools → Network → see what Location header is being sent.
Update the regex in worker.js.

### Logged in but every request 401s
The cookie domain rewrite isn't working. Open DevTools → Application →
Cookies for app.proinsights.com.cy. The session cookie should have
Domain=app.proinsights.com.cy. If it shows .onrender.com, the cookie
isn't being sent on subsequent requests. Check `rewriteCookie()`.

### 502 Bad Gateway from Cloudflare
Render is down OR the upstream URL is wrong. Test directly:
`curl -sI https://proinsights-backoffice.onrender.com/api/admin/health`.
If that's 502 too, Render's service is the issue.

### Static assets (CSS/JS) return 404
The upstream returns asset URLs that might be absolute. Inspect the
response HTML to see how asset URLs are rendered. If they say
`https://proinsights-backoffice.onrender.com/static/...`, you'll need
to either:
  - Render relative URLs in the templates (preferred), OR
  - Add a rewrite step in the Worker to fix absolute upstream URLs.

The current code only rewrites Set-Cookie and Location. If you see
broken assets, tell Claude and we'll add HTML rewriting via
HTMLRewriter API.

## Rollback

Two paths:
1. **Disable the Worker route** — Worker stays deployed but stops
   intercepting. Cloudflare dashboard → Worker → Settings → Routes →
   delete the route. `app.proinsights.com.cy` will then return whatever
   the DNS record points at (the AAAA placeholder = nothing).
2. **Delete the Worker entirely** — Worker page → Settings → Delete.

## Future migration to Render Pro

If you later upgrade Render's workspace to Professional plan ($19/mo),
the Worker becomes unnecessary:
1. Render → Custom Domains → add `app.proinsights.com.cy`
2. Cloudflare DNS: change `app` from AAAA `100::` Proxied → CNAME to
   Render's CNAME target, **DNS only** (grey cloud)
3. Delete the Worker route (and optionally the Worker itself)

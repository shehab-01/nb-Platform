# Google Drive (expense proofs)

Receipts and payment screenshots attached to expenses are kept in one Google
Drive the platform owns, not on this server. Layout:

```
nbPlatform/                 (nbPlatform-dev on a dev machine)
  <Store name — subtitle>/
    Expenses/
      2026-10-09/
        E42-1 Vegetables.jpg
```

The app creates every folder itself. Folder ids are remembered per store id in
`drive_folders`, so renaming a store renames its folder rather than starting a
new one. A store's folder is made when the store is created; if Drive is not
connected or unreachable at that moment, it is made on the first upload.

Files are private. Nothing is shared by link: the admin fetches a proof
through `GET /api/expenses/proofs/{id}/file`, which only answers someone with
CRM access to that store, and shows it from a blob: URL that exists only in
that browser tab.

## How it connects

OAuth, client type **Web application**, scope `drive.file` (the app sees only
what it created, nothing else in the account). A super admin presses
**Connect Google Drive** on Platform → System, approves at Google, and lands
back on the same page. The refresh token is stored encrypted under
`APP_ENCRYPTION_KEY` in `drive_connection`; the API only ever reports whether
Drive is connected and to which account. Code: `api/services/gdrive.py`
(Drive calls), `api/routers/drive.py` (connect / callback / disconnect),
proof endpoints in `api/routers/expenses.py`.

## One-time setup (Google Cloud Console)

1. APIs & Services → Library: enable **Google Drive API**.
2. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized JavaScript origins: none.
   - Authorized redirect URIs, exactly:
     - `https://<admin host>/api/drive/oauth/callback` (production)
     - `http://localhost:8090/api/drive/oauth/callback` (dev — Google refuses
       made-up hostnames like `admin.nb.local`, so dev comes back via
       localhost; the callback does not need the admin's cookie)
3. OAuth consent screen:
   - Data access: add `.../auth/drive.file`.
   - Audience: **Publish app** (status *In production*). In *Testing*, Google
     expires the refresh token after 7 days and uploads stop.

## Environment

```
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=https://<admin host>/api/drive/oauth/callback
GOOGLE_DRIVE_ROOT_NAME=nbPlatform      # compose.dev.yaml forces nbPlatform-dev
MAX_PROOF_BYTES=10485760               # 10 MB per file
```

Then `docker compose up -d --force-recreate api` and press Connect on
Platform → System. Dev keeps its own token in its own database and writes
under `nbPlatform-dev`, so it never touches production's folders even on the
same Google account.

## When something goes wrong

- **"Google no longer accepts the Drive connection"** — the grant was revoked
  at myaccount.google.com/permissions, or the app is still in *Testing*. Fix
  the cause and press Reconnect.
- **"Google did not hand over a refresh token"** — remove the app at
  myaccount.google.com/permissions and connect again.
- **A folder was deleted in Drive by hand** — the next upload notices, forgets
  the stale ids and rebuilds the path.
- **Disconnect** forgets the token and revokes it at Google. Files already in
  Drive stay; deleting a proof or an expense moves its file to Drive's bin
  (recoverable for 30 days).

## Sending a proof from a phone

The expense drawer's **Send from phone** shows a QR code for
`https://<admin host>/drop/<secret>` — a page outside the signed-in admin that
needs no login. The secret is random, good for 15 minutes, and only lets its
holder add pictures to that one drawer (only its SHA-256 hash is stored, in
`proof_drops`). The phone shrinks photos to a JPEG of at most 2400 px (which
also turns iPhone HEIC into something the API accepts) and uploads them; the
API streams each straight into `<store> / Expenses / Incoming` in Drive —
nothing is written to the server's disk. The drawer polls and shows them.

On **Save** they move into that day's folder and become the expense's proofs.
Closing the drawer without saving bins them; a link left open is swept (its
files binned) the next time anyone in that store opens a QR code. So
`Incoming` is normally empty — anything there is a picture waiting for a
drawer that is still open.

Code: `api/routers/proof_drops.py`, the phone page
`frontend/src/app/admin/drop/[token]/page.tsx`, the drawer side
`frontend/src/components/admin/expenses/phone-drop.tsx`.

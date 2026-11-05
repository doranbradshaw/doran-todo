# Doran's To-Do Lists

An installable mobile task board (business + personal lists, urgent jumps the line)
that **syncs between your phone, laptop and the website** at `todo.aquatech.plumbing`.

- Opens full-screen from the phone's home screen like a native app
- Works with no signal — edits are saved on the device and pushed when you're back online
- **Speak a task** with the mic button in the task box (uses the phone's own dictation engine, nothing to pay for)
- One shared board for all your devices, stored in a Cloudflare D1 database (free tier)
- Protected by a **board key** you choose — entered once per device

---

## How the sync works (plain English)

1. Every device keeps its own copy of the board, so the app opens instantly and works offline.
2. Whenever you change something, the device sends its whole board (a few KB) to `/api/sync`.
3. The server compares each task by its **last-edited time** and keeps the newer copy. It sends the combined board back and the device adopts it.
4. Devices also check in when you re-open the app, when the connection comes back, and quietly every minute while the app is open.
5. Deleting a task leaves a hidden "deleted" marker so the delete reaches every device; markers are cleaned up after 30 days.

The small text under the title shows the state: **Synced**, **Syncing**, **Offline · saved here**, or **Sync off · tap to set key**. Tapping it retries (or lets you enter the key).

---

## One-time setup on Cloudflare (about 10 minutes)

Because this version has a backend (the `/api/sync` function), it must be deployed
**from Git or with the command line** — the dashboard drag-and-drop upload does not build functions.

### Step 1 — Put the project on GitHub

Create a new repository (e.g. `doranbradshaw/doran-todo`) and push this folder to it.
Don't commit `.dev.vars` (it's already in `.gitignore`).

### Step 2 — Install the Cloudflare command-line tool and log in

```bash
npm install
npx wrangler login        # opens a browser window; approve it
```

### Step 3 — Create the database

```bash
npx wrangler d1 create doran-todo-db
```

It prints something like:

```
database_name = "doran-todo-db"
database_id   = "a1b2c3d4-...."
```

Open `wrangler.jsonc` and paste that id in place of `REPLACE_WITH_YOUR_DATABASE_ID`.
Commit and push that change.

### Step 4 — Create the table

```bash
npx wrangler d1 migrations apply doran-todo-db --remote
```

### Step 5 — Create the Pages project from GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Choose the repository, then set:
   - **Project name:** `doran-todo`
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Save and Deploy**. The database binding is picked up automatically from `wrangler.jsonc`.

### Step 6 — Set your board key (the "password")

Pick a long phrase you can type on a phone, e.g. `copper-pipe-sunrise-42`. Then either:

- Dashboard: the `doran-todo` project → **Settings** → **Variables and Secrets** → **Add** →
  type **Secret**, name `BOARD_KEY`, value = your phrase → Save → **Redeploy** the latest deployment, or
- Command line: `npx wrangler pages secret put BOARD_KEY --project-name doran-todo` (it will ask for the value)

### Step 7 — Point `todo.aquatech.plumbing` at it

1. The `doran-todo` project → **Custom domains** → **Set up a custom domain** → enter `todo.aquatech.plumbing`
2. If `aquatech.plumbing` is already on Cloudflare, it adds the DNS record for you — click **Activate domain**.
   If the domain's DNS is elsewhere, add a **CNAME** record there: `todo` → `doran-todo.pages.dev`.
3. HTTPS is automatic. Within a few minutes `https://todo.aquatech.plumbing` is live.

### Step 8 — On each device

Open `https://todo.aquatech.plumbing`, enter the board key when asked, and add it to your home screen:

- **iPhone (Safari):** Share button → **Add to Home Screen** → Add
- **Android (Chrome):** tap **Install** on the card the app shows (or browser menu → Install app)
- **Laptop (Chrome/Edge):** the install icon in the address bar, or just bookmark it

---

## Updating the app later

Every `git push` to the main branch rebuilds and redeploys automatically. Phones pick up the new
version silently the next time the app is opened.

Command-line alternative (no Git needed): `npm run deploy`.

## Changing the board key

Set a new `BOARD_KEY` secret (Step 6) and redeploy. Every device will show
"Sync off · tap to set key" — tap it and enter the new key.

## Using the mic

Tap the mic in the task box, say the task, and it types itself in. Tap again to add more words.
The first time, your phone will ask permission to use the microphone.

- Works in Safari on iPhone/iPad, Chrome on Android, and Chrome/Edge/Safari on desktop.
- Firefox doesn't support it, so the button is hidden there — the keyboard's own dictation key still works everywhere.

---

## Running it locally (for testing changes)

```bash
npm install
npm run dev                                          # front end only, no sync
# full stack with a local database:
npx wrangler d1 migrations apply doran-todo-db --local
echo 'BOARD_KEY=test-key' > .dev.vars
npm run build && npx wrangler pages dev dist         # http://localhost:8788
```

## What's in here

```
doran-todo/
├── index.html                 Mobile/PWA meta tags, entry point
├── functions/api/sync.ts      The backend: Cloudflare Pages Function + D1 (merge + save)
├── migrations/0001_tasks.sql  Database table
├── src/
│   ├── main.tsx               Boots React, registers the service worker
│   ├── styles.css             Theme, safe-area padding, self-hosted font
│   ├── fonts/                 Plus Jakarta Sans (latin, woff2)
│   ├── components/
│   │   ├── task-board.tsx     The whole app UI (sync status, key entry, mic)
│   │   └── install-prompt.tsx "Add to home screen" card
│   └── lib/
│       ├── tasks.ts           Task model, sorting, merge rule, handoff text for Tammy
│       ├── sync.ts            Talks to /api/sync, stores the board key
│       └── use-speech.ts      Speak-to-text hook (Web Speech API)
├── public/
│   ├── _headers               Cloudflare cache + security headers
│   ├── icons/                 App icons (192 / 512 / maskable)
│   └── apple-touch-icon.png
├── scripts/make-icons.mjs     Regenerates PNG icons from favicon.svg
├── vite.config.ts             Build + PWA manifest + service worker
└── wrangler.jsonc             Cloudflare Pages + D1 settings
```

## Why these choices

| Decision | Reason |
|---|---|
| Cloudflare D1 + Pages Functions | Same platform as the site, free tier is far beyond what a personal board needs, nothing to run or patch. |
| "Newest edit wins" per task | Simple, predictable, and never loses a whole board: two devices editing different tasks both keep their changes. |
| Board key instead of accounts | One user, one board. A single secret is simpler to use on a phone than sign-up/sign-in, and the server never stores it in the database. |
| Web Speech API for the mic | Built into Safari and Chrome, free, no audio ever leaves the phone to a third-party service of ours. |
| Service worker never caches `/api/` | Sync answers must always be live, never a stale copy. |

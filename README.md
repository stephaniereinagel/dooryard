# Dooryard — Homestead Ops

A mobile-first web app for directing a homestead assistant (or yourself, your spouse, or anyone else who's helping). Digitizes the "shift playbook + priority whiteboard + shift log" paper system into a shared, live workspace.

Built for a 6-acre family homestead in Northwest Arkansas. Generic enough to work for anyone with recurring homestead chores and occasional helpers.

## What it does

- **Auth-gated.** Supabase email+password or magic link.
- **Multi-member workspace.** One person owns a workspace; they add their spouse, an assistant, or anyone else as members. Everyone sees the same live data.
- **Today.** Dynamic shift flow that changes by day of week. Arrival checklist → daily core chores → day-specific guidance (e.g. Garden focus on Monday, Animals + Stand prep on Wednesday, Farm stand day on Friday) → backlog pull → wrap-up form that saves a full shift log with one click.
- **Priority whiteboard.** Replaces a physical dry-erase board. Pin must-dos, cross off when done.
- **Backlog.** Maintenance + projects, filterable by zone (flock, garden, stand, property, kitchen, other) and status (open / in progress / done).
- **Logs.** Every shift log is stored, searchable by date range, exportable to CSV, readable in one tap.
- **Reference.** Bundled markdown copies of the shift playbook, task standards, and safety-and-boundaries guide, rendered in-app.
- **Quick links.** One-tap to external tools (e.g. MyGardenCoach for daily garden tasks, the farm stand's Facebook page).
- **Seasonal reminders.** Month-by-month backlog prompts inside the Backlog tab.

## Tech

- Static HTML + CSS + vanilla JS. No build step, no framework.
- Supabase Auth + Postgres + RLS for data and identity.
- ES modules loaded via `esm.sh`: `@supabase/supabase-js@2`, `marked@12`.
- Designed mobile-first with bottom-nav tabs. Works on desktop too.

## Setup

### 1. Create a Supabase project

[supabase.com](https://supabase.com) → new project (free tier is plenty).

Then in the project's **SQL Editor**, paste the entire contents of [`supabase-schema.sql`](./supabase-schema.sql) and run it. It's idempotent — safe to re-run.

The schema creates:
- `workspaces`, `workspace_members`, `whiteboard_items`, `backlog_items`, `shift_logs`
- A `bootstrap_workspace(text)` RPC that atomically creates a workspace + admin membership for the signed-in user (SECURITY DEFINER; routes around first-time RLS friction)
- An `is_workspace_member(uuid)` helper function
- RLS policies scoping every table to workspace members
- A `whoami()` diagnostic function

### 2. Configure auth

In Supabase:

- **Authentication → Sign In / Providers → Email**: enable. For low-friction single-user / family use, you can turn **Confirm email** off.
- **Authentication → URL Configuration**: set Site URL to your deployed URL (Netlify), and add both that URL and any local dev host (e.g. `http://localhost:8080`) to Redirect URLs.

### 3. Fill in `app-config.js`

```js
window.HOMESTEAD_OPS_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "eyJ…",   // the anon/public key
  defaultWorkspaceName: "Your Homestead",
  links: {
    myGardenCoach: "https://mygardencoach.netlify.app", // or whatever you use
    farmStandFacebook: ""                                // paste FB page URL or leave blank
  }
};
```

The anon key is safe to commit — it's designed to be public. RLS policies do the actual securing. **Never** commit the service-role key.

### 4. Run locally

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080/](http://localhost:8080/) and click **Create Account**.

On localhost, use **email+password** rather than magic link (magic-link redirects don't play well with `localhost`).

### 5. Deploy

The included [`netlify.toml`](./netlify.toml) publishes `.` (repo root). Point a new Netlify site at this repo and it just works. After first deploy, add the Netlify URL to Supabase's **Authentication → URL Configuration**.

## First-time sign-in flow

1. Open the app. Click **Create Account**. Enter email + password.
2. Sign in. On first load the app calls `bootstrap_workspace` — a workspace gets created, owned by you, with you as admin.
3. (Optional) Under **Reference → Settings & workspace**, rename your workspace.
4. Your user ID is shown at the top of the Settings panel. Note it if you plan to invite others.

## Adding other members (spouse, assistant, etc.)

1. They create their own account in the same app.
2. They copy their **User ID** from their Settings panel and send it to you.
3. In your Settings panel, paste their user ID + a display name, pick `admin` or `member`, click **Add member**. They'll see the shared workspace on their next refresh.

To revoke access: remove the row via the Supabase Table Editor's `workspace_members` table, or (future work) build a UI for it.

## Usage patterns

- **Morning (owner)**: open the Whiteboard tab, add/update today's priorities. 30 seconds.
- **Assistant arrives**: opens the app, Today view shows priorities + the day's specific flow. Starts checking off.
- **End of shift**: assistant fills in the wrap-up form (bottom of Today), taps **Save shift log**.
- **Review**: owner flips through the Logs tab during the week; CSV export when a durable copy is useful.

## Data model

| Table | Purpose |
|---|---|
| `workspaces` | One per household. Owner = person who created it. |
| `workspace_members` | Everyone who can see/edit this workspace's data. |
| `whiteboard_items` | Priority list. Pin + done flags. |
| `backlog_items` | Maintenance + projects. Category, zone, status, notes. |
| `shift_logs` | One row per shift. `data` JSONB holds the full wrap-up form. |

RLS policy: you can read/write a row if you own the workspace **or** appear in `workspace_members` for that workspace. The `is_workspace_member(workspace_id)` function handles the check safely (SECURITY DEFINER, search_path pinned).

The initial `workspaces` row is created via the `bootstrap_workspace` SECURITY DEFINER RPC rather than a direct INSERT, so the bootstrap path doesn't depend on the exact shape of the per-row INSERT policy. Everything after bootstrap runs under normal per-workspace RLS.

## What's intentionally NOT in MVP

Deliberate deferrals — easy to add later:

- Photo attachments on flags / log entries (needs Supabase Storage)
- Push notifications (needs PWA + a push service)
- Drag-and-drop reordering (the `rank` column exists; UI can come later)
- In-app editing of the reference docs (currently static markdown shipped with the app)
- Role-gated UI (admins see settings; members don't) — currently everyone with a login in a workspace can do anything in that workspace
- Auto-generated weekly/monthly summaries from logs

## Keeping reference docs fresh

The files in [`reference/`](./reference/) are the shift playbook, task standards, safety-and-boundaries guide, and seasonal reminders. Edit them directly in this repo and redeploy — the app loads them at runtime.

## License

MIT. Use it, fork it, adapt it to your own homestead — welcome.

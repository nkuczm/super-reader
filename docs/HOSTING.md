# Hosting: Google Cloud Run for the live site, Vercel for previews

The live reader runs on **Google Cloud Run** from November 2026. Vercel's
Hobby plan paused the whole site at 130% of its 4 hours of CPU a month, and
Pro is $20 a month; Cloud Run's free tier is 50 vCPU-hours a month, and
past it the reader keeps running at about 9¢ an hour instead of going dark.
**Vercel stays connected for pull-request previews** once its pause lifts
(3 Dec 2026).

What runs where:

| | Where | Started by |
|---|---|---|
| The live site | Cloud Run, one service, `super-reader` | every merge to `claude/feedly-clone-custom-feeds-laz6ll` (Cloud Build) |
| The twice-daily panel sweep | Cloud Scheduler → `/api/pulse/sweep?slice=due&rounds=5` | 11:00 and 23:00 UTC |
| Keeping the server awake | Cloud Scheduler → `/api/warm` (does nothing, no database) | every 5 minutes |
| PR previews | Vercel | every push to a PR branch |
| The database | Neon, unchanged | — |
| The spending cap | Cloud Run, a second service, `budget-cap`, built from `gcp/budget-cap/` on merge | the budget's reports, through Pub/Sub |

## What the code does for this

- **`Dockerfile`** builds the standalone server (`NEXT_OUTPUT=standalone`,
  read in `next.config.ts`; Vercel ignores both). Node 24, as on Vercel.
  Measured locally: builds in under a minute, and with a 1 GiB memory limit
  forty large articles parsed at once all answered, peaking at 546 MiB —
  Node sizes its heap from the container's limit.
- **`lib/origin.ts`.** A self-hosted Next server builds `request.url` from
  the address it listens on (`http://0.0.0.0:8080`), not the browser's.
  Vercel hides that by sending `x-forwarded-host`; Cloud Run sends `Host`.
  Sign-in callbacks, redirects and the same-site check on every save read
  the public address from the headers. Without it, sign-in sends people to
  `0.0.0.0` and every save is refused as cross-site.
- **`lib/key-check.ts`.** Subjects, the library, settings and stored keys
  are sealed with `DATA_KEY`. A server given a different key cannot open
  them, and would seal what it writes next with the wrong key. So before
  any account feature runs, one saved value is opened; if none opens,
  accounts stay off, nothing is read or written, and the log says
  `DATA_KEY does not open the data already saved`.
- **`after()`** (the database-usage meter) is safe on Cloud Run: CPU is
  slowed between requests, so the write may land with the next request,
  and Next finishes any still pending when Cloud Run stops the instance.
- **The cron** left `vercel.json` (now removed) for Cloud Scheduler, so
  Vercel no longer sweeps once it unpauses.
- **Opening the app does not wait for a starting server** (`public/sw.js`).
  The service worker used to ask the server for the page first and fall
  back to its kept copy only offline; a server that is starting is not
  offline, so the app stayed blank for the whole start. Now the server's
  page is used if it answers within 0.8 s, and the kept copy otherwise,
  with the server's answer kept for next time. Measured locally with a
  server held for 5 s: the page in 5.0 s before, 0.8 s after, and the
  reader on screen, panels opening, in 0.87 s.
- **No CDN.** The `cdn-cache-control` headers do nothing on Cloud Run;
  browsers still cache what `cache-control` allows. For one reader the
  difference is a few extra requests.
- **The settings footer** shows "built <date>" instead of a commit: the
  container build has no commit to name.

---

## Setting it up (once)

Everything below is in the Google Cloud console,
[console.cloud.google.com](https://console.cloud.google.com). The screens
change; where a label differs slightly, the nearest match is the one.

### 0. Before you start: five values

| Variable | Where it comes from |
|---|---|
| `DATA_KEY` | **Must be the exact value Vercel has.** Vercel marks it Sensitive and will not show it. It was made when accounts were set up (30 Sep 2026): look in your password manager, notes, or the chat where it was made. **Do not make a new one.** If it cannot be found, stop here and say so: there is a way to move the data to a new key, but it needs Vercel running. |
| `POSTGRES_URL` | Vercel → super-reader → Settings → Environment Variables → `POSTGRES_URL` → reveal (not Sensitive), or Neon's console → Connection string (pooled). The host in it names the database's region, e.g. `…us-east-1.aws.neon.tech`. |
| `GOOGLE_CLIENT_ID` | Google Auth Platform → Clients → your web client. |
| `GOOGLE_CLIENT_SECRET` | Same page → **Add secret**, and copy it (it is shown once). The old secret keeps working for Vercel. |
| `AUTH_SECRET` | A new random value is fine: it only signs the ten-minute cookie carried through Google's sign-in page. Make one in Cloud Shell (the `>_` icon, top right) with `openssl rand -base64 48`. |

### 1. A project with billing

Use the project your Google sign-in client already lives in (the project
picker at the top shows it). Then **Billing** → link a billing account (a
card is needed; nothing is charged inside the free tier).

### 2. The service, deploying from GitHub

1. **Cloud Run** → **Deploy container** / **Create service**.
2. Choose **Continuously deploy from a repository** → **Set up with Cloud
   Build**. Enable the APIs it asks for.
3. **Repository provider: GitHub** → authenticate → install the Google
   Cloud Build app on `nkuczm/super-reader` only → select it.
4. **Branch:** `^claude/feedly-clone-custom-feeds-laz6ll$`.
   **Build type: Dockerfile**, source location `/Dockerfile`. Save.
5. **Service name** `super-reader`. **Region**: nearest the database —
   `us-east-1` → `us-east4`; `us-east-2` → `us-east5`; `us-west-2` →
   `us-west1`.
6. **Authentication: Allow public access** (it is a public website; the
   app does its own sign-in).
7. **Billing: Request-based.** **Scaling:** minimum 0, maximum **3**.
   **Ingress:** all.
8. **Container(s) → Settings:** port **8080**, memory **1 GiB**, CPU **1**,
   request timeout **300** seconds, concurrency left at 80.
9. **Variables & secrets:** add the five from step 0, names exactly as
   written.
10. **Create.** The first build takes a few minutes (Cloud Build →
    History shows it). The address appears at the top of the service page:
    `https://super-reader-<number>.<region>.run.app`.

### 3. Sign-in at the new address

Google Auth Platform → Clients → your web client:

- **Authorized redirect URIs** → add `https://<address>/api/auth/callback`
- **Authorized JavaScript origins** → add `https://<address>`

Keep the Vercel ones. Google says changes can take a few minutes.

### 4. Check it

Open the address. Sign in. Your subjects and library should appear; if
instead sign-in is unavailable, Cloud Run → super-reader → **Logs**: the
line `DATA_KEY does not open the data already saved` means the key is not
the one Vercel has (and nothing was changed).

### 5. The schedule: the sweep, and keeping the server awake

**Cloud Scheduler** → **Create job**: name `pulse-sweep`, same region,
frequency `0 11,23 * * *`, time zone **UTC**, target **HTTP**, URL
`https://<address>/api/pulse/sweep?slice=due&rounds=5`, method **GET**, no
auth header (the sweep needs none: only what is due runs). Three jobs a
month are free.

**And a second job to keep the server awake:** name `keep-warm`, frequency
`*/5 * * * *`, URL `https://<address>/api/warm`, method **GET**, otherwise
the same. Cloud Run stops a server nobody is using after some minutes, and
starting it again takes seconds — the delay on opening the app. A visit
every five minutes keeps it running for what is effectively nothing: the
endpoint answers in milliseconds and touches nothing, least of all the
database (Neon bills by the hour its own compute is awake). Two of the three
free jobs.

While you are in the service: **Edit & deploy new revision → Container(s)
→ Startup CPU boost** on. It gives a starting server more CPU for its first
seconds, which shortens the starts that still happen (after each deploy).

### 6. The spending cap

1. **APIs & Services → Library → Cloud Billing API → Enable.**
2. **Billing → Budgets & alerts → Create budget:** this project only,
   amount **$10**, alerts at 50%, 90%, 100%. Under notifications, **connect
   a Pub/Sub topic** → create topic `budget-cap`. Save.
3. **IAM → Service accounts → Create:** `budget-cap`. Then **IAM → Grant
   access:** that account, role **Project Billing Manager**.
4. **Cloud Run → Create service → Continuously deploy from a repository →
   Set up with Cloud Build**, the same as the site (step 2), with three
   differences in the build settings:
   - **Build type:** Go, Node.js, Python… **via Google Cloud's buildpacks**
     (not Dockerfile).
   - **Build context directory:** `/gcp/budget-cap`
   - **Function target** (or entry point), if asked: `stopBilling`

   Then: name `budget-cap`, same region, **Require authentication** (only
   the budget's trigger calls it), maximum instances **1**, memory 512 MiB,
   and under **Security** the service account `budget-cap`. Create.
5. On the new service's **Triggers** tab → **Add trigger → Pub/Sub**, topic
   `budget-cap`. Accept the roles it offers to grant.
6. Within a day its **Logs** should show `Under budget (… of 10 USD);
   nothing to do.` That line is the check that it is wired up.

A change to `gcp/budget-cap/` then deploys itself on merge, like the site.
So that each trigger rebuilds only for its own changes: **Cloud Build →
Triggers** → the function's trigger → **Included files filter**
`gcp/budget-cap/**`; the site's trigger → **Ignored files filter** `gcp/**`.

Past $10 in a month it detaches billing, which stops everything in the
project, the reader included. **Billing → Account management** → link the
project again to bring it back. Reports run hours behind the spending, so
a bill can end a little over.

### 7. Old builds

**Artifact Registry** → the repository Cloud Run made (usually
`cloud-run-source-deploy`) → **Edit → Cleanup policies**: a **Delete**
policy for any tag state, and a **Keep most recent versions** policy of 3;
dry run off. The first 0.5 GB is free and each build adds one image.

### 8. Moving your devices

- The address changed, so each device starts with nothing local: sign in
  and the synced things (feeds, folders, subjects, library, saved, read
  marks) come back. What lived on one device only does not: offline
  copies, Source status history, and per-device switches (story
  importance, background downloads).
- On a phone, add the new address to the home screen and remove the old.
- The Chrome extension: reload it in `chrome://extensions` (version 1.5
  or later), open Super Reader at the new address and sign in, then open
  the extension: it finds the open tab and moves to that address itself.
  Typing the address under **Server** still works.

---

## Testing it

**Straight away**, once a step is done:

| What | How | Passes when |
|---|---|---|
| The site builds from GitHub | Cloud Build → History | the newest build is green, and Settings' footer says "built" a time after it |
| Sign-in and saving | Subjects → sign in → edit a subject | your subjects appear and the strip says "Saved" (a refused save would say otherwise) |
| The sweep | Cloud Scheduler → `pulse-sweep` → ⋮ → **Force run** | Last run says **Success** |
| Kept awake | Cloud Scheduler → `keep-warm` | Last run says **Success**, every five minutes; the app opens without a pause even after an hour away |
| The cap is wired | Pub/Sub → Topics → `budget-cap` → Messages → **Publish message** `{"costAmount": 1, "budgetAmount": 10, "currencyCode": "USD"}` | `budget-cap`'s Logs: `Under budget (1 of 10 USD); nothing to do.` |
| The cap would work | publish `{"check": true}` the same way | Logs: `Ready: past the budget, this would detach billing…`. `NOT READY` means the role from step 6.3 is missing; a message naming the Cloud Resource Manager API means enable that API and publish again |
| The cap is private | open `budget-cap`'s own URL in a browser | 403 Forbidden |

The one test left out on purpose is a real over-budget message
(`{"costAmount": 11, "budgetAmount": 10}`): it does detach billing, the site
stops within a minute, and it comes back only when billing is linked again
(Billing → Account management). The check above tests the same permission
without that.

**After a day:** `budget-cap`'s Logs show an `Under budget (0 of 10 USD)` line
you did not publish — the budget itself reached the topic — and
`pulse-sweep`'s Last run is from 11:00 or 23:00 UTC, not a forced run.

**After a week:** Billing → Reports, this project, reads $0.00 (the free
tier covers it); Cloud Run → super-reader → Metrics → *Billable container
instance time* shows how much of the 50 hours a month is in use; Artifact
Registry holds at most three images.

---

## Costs, and where to look

| | Free each month | Then |
|---|---|---|
| Cloud Run (request-based) | 180,000 vCPU-s (50 h), 360,000 GiB-s, 2M requests | about $0.000024 per vCPU-second |
| Cloud Build | 2,500 build-minutes | $0.006 a minute |
| Cloud Scheduler | 3 jobs | $0.10 a job |
| Artifact Registry | 0.5 GB | $0.10 per GB |

Cloud Run counts the time a request is open, waiting included, not only
CPU at work; requests that overlap share it. Billing → Reports, filtered
to the project, shows the month so far.

The runtime logs are Cloud Run → super-reader → Logs. The grouped-by-status
check in COLLECTION.md §5b is the same idea there: filter
`httpRequest.status>=500`.

## Collection from new addresses

Every refusal measured in `docs/COLLECTION.md` §8 was measured from
Vercel's servers. Cloud Run fetches from Google's addresses, and a
publisher may treat those differently in either direction. Re-measure
before trusting an old wall: `npm run coverage https://<address>`.

## Later (from 3 Dec 2026)

- Vercel unpauses and builds PR previews again, with its own variables.
- The old address should send people to the new one. That is a redirect
  on Vercel's production deployment only, to be added once the Cloud Run
  address is known.

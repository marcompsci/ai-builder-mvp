# Running the beta

Two stages, in order. Stage 1 is you alone on the deployed app, proving it
survives the move off your laptop. Stage 2 is inviting testers. Don't skip
to Stage 2 — most of what breaks in a cloud deployment breaks on the first
real run, and you want to find that yourself.

Prerequisite: `docs/azure-deployment.md` through Step 5.

---

## Stage 1 — Solo beta

You're not testing features here; you already know they work on localhost.
You're testing the things the move to a container changed: the filesystem,
the identity, the secrets, the processes.

### Run this list in order and stop at the first failure

| # | Do this | What it proves | If it breaks |
|---|---|---|---|
| 1 | Open the app URL in a private window | Entra sign-in is actually enforced, and you're assigned | `AADSTS50105` → you skipped the Enterprise-app assignment |
| 2 | Generate a landing page from the home form | `ANTHROPIC_API_KEY` reached the container from Key Vault | 500 → `az containerapp logs show`; likely Key Vault RBAC |
| 3 | Create a project | The Azure Files mount is writable, and `app.db` is working with `journal_mode=DELETE` | `SQLITE_IOERR` → the pragma didn't take |
| 4 | **Start that project's preview** | `npm install` works on an SMB share — the known sharp edge | Symlink errors → see the fallbacks in the deployment doc |
| 5 | Request a change, get a plan, approve it | Agent runs, MCP servers over `npx tsx`, git checkpoint/commit all work in the container | Provider unavailable → check the key; git errors → `safe.directory` |
| 6 | Check version history, then restore a version | git history survives on the share | — |
| 7 | Submit the post-run feedback form | The `feedback` table is writable | — |
| 8 | Open `/admin` | Your `ADMIN_USER_IDS` entry is right | 403 → run `./infra/provision.sh admin` |
| 9 | **Restart the app, then reload** | The whole point of the mount: your project and its history are still there | Empty → the volume isn't mounted; check the app YAML |

```bash
# step 9
az containerapp revision restart -n ca-<project> -g rg-<project> \
  --revision "$(az containerapp revision list -n ca-<project> -g rg-<project> --query '[0].name' -o tsv)"
```

Step 9 is the one that actually matters. Everything before it can pass on a
container that loses all its data on restart.

### Then leave it alone for a day

Come back and open it. The app scales to zero when idle, so this is also how
you find out what a cold start feels like — and whether anything assumed a
process that was still running.

---

## Stage 2 — Inviting testers

### Before you invite anyone, know what they'll share

Identity now flows through: each signed-in person gets their own
`entra:<object-id>`, so analytics, feedback, and rate limits are per-person,
and the funnel metrics that used to return `null` will start returning real
numbers.

What is **not** separated yet:

- **Projects.** The workspace index is global. Every tester sees every
  tester's projects and can edit them.
- **API keys.** One `ANTHROPIC_API_KEY` for everyone. Their usage is your bill.
- **Previews.** Dev servers are per-project, not per-user, and the container
  has one filesystem.

So the honest shape of a beta right now is: **people you'd let use your
laptop.** Tell them plainly that the projects list is shared — it isn't a bug
they're finding, it's the current state, and saying so up front saves you a
confused bug report.

The fix, when you want strangers on it, is per-user project scoping — keying
`data/workspaces/index.json` by `userId` and filtering `paths.ts` on it. That
plus the bring-your-own-key idea already sketched at the bottom of
`.env.example` is what makes a public beta safe.

### Inviting someone with a personal account (Gmail, etc.)

Your testers don't need Microsoft accounts of their own — Entra invites them
as a **guest** and they sign in with the email they already have.

```bash
az ad user invite \
  --invited-user-email-address "tester@gmail.com" \
  --invited-user-display-name "Tester Name" \
  --invite-redirect-url "https://<your-app>.azurecontainerapps.io"
```

Or in the portal: **Microsoft Entra ID → Users → New user → Invite external user**.

Then — and this is the step people forget — assign them to the app, or they
still can't get in:

**Entra ID → Enterprise applications → `ca-<project>-auth` → Users and groups
→ Add user.**

They get an email, accept once, and land on your app. Removing access later
is the same screen: remove the assignment.

> Guest invites are free up to a generous monthly active-user allowance on
> the standard External ID tier — a handful of testers costs nothing. Check
> current terms if you're inviting dozens.

### A tester's first five minutes

Send them this, not a feature tour:

1. Sign in with the link in the invite email.
2. Describe a website on the home page, generate it.
3. Create a project, start its preview.
4. Ask the agent for one change you actually want. Read the plan before
   approving — that review step is the thing I most want feedback on.
5. Fill in the feedback form when it appears.

The feedback form and the event stream do the rest. You don't need to ask
them to write a report.

### What to watch while the beta runs

- `/admin` → **Feedback Inbox** for free text, **Top User Problems** for
  themes, **Activation Funnel** for where people stop.
- Cost: your budget alert from the deployment doc is the backstop, but check
  Cost Management in week one — agent runs are the variable.
- `az containerapp logs show -n ca-<project> -g rg-<project> --follow` while
  someone is actually using it. You learn more in ten minutes of watching
  than from a day of logs after the fact.

### Turning the beta off

Remove everyone's assignment in the Enterprise application. The app stays up
and your data stays put; nobody but you can reach it.

---

## What's deliberately still missing

Worth being honest with yourself about, because each one is a real decision
rather than an oversight:

- **No invite system in the app.** Invites are Entra's, not a feature. The
  `beta_invite_sent` / `beta_invite_accepted` events in
  `src/lib/analytics/schema.ts` stay unwired until there is one.
- **No per-user project isolation.** Described above.
- **No onboarding flow**, so `onboarding_started` / `onboarding_completed`
  also stay unwired and the funnel's onboarding row stays `null`.
- **No cost-per-project metric** — the approved event schema has no cost
  field, and adding one silently would be worse than the gap.
- **No analytics retention job.** Rows persist until someone deletes them
  via `/privacy`. Fine for a handful of testers, not a final policy.

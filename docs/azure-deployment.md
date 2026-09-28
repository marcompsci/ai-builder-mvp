# Deploying ai-builder-mvp to Azure

This is the whole path from "no Azure account" to a private, signed-in URL that
only you can open, with pushes to `main` redeploying automatically.

**Read the two warnings in [What this deployment is not](#what-this-deployment-is-not)
before you start.** They are the difference between a safe private deployment
and a costly one.

---

## The shape of it

```
        you (browser)
             │  https, Microsoft sign-in required
             ▼
   ┌─────────────────────────────────────────┐
   │  Azure Container App  (1 replica max)   │
   │    Next.js + git + Claude Code / Codex  │
   │    managed identity, no stored creds    │
   └───────┬─────────────────────┬───────────┘
           │ pulls image         │ reads keys at start
           ▼                     ▼
   Container Registry      Key Vault
           ▲                 (ANTHROPIC_API_KEY, …)
           │ builds+pushes
   GitHub Actions ── OIDC, no stored password ──┘
           │
           ▼ mounted at /mnt/appdata
   Azure Files share  →  app.db + data/workspaces
```

Five resources, one resource group. `az group delete` removes all of it.

**Why Container Apps and not Static Web Apps / App Service / Functions.** This
app is not a stateless web server. It shells out to `git`, spawns `npx tsx` MCP
servers, and runs `npm install` + `next dev` inside generated workspaces. Static
Web Apps and Functions can't do any of that. App Service could, but Container
Apps gives you scale-to-zero (so an idle app costs ~nothing), a straightforward
Azure Files mount, and built-in Entra sign-in in one place.

---

## Step 1 — Create the Azure account

Only you can do this part; it needs a card and a phone.

1. Go to <https://azure.microsoft.com/free>. Sign in with a Microsoft account —
   use one tied to an address you'll keep, not a throwaway.
2. Identity verification by phone, then by card. **The card is for identity
   verification.** A free account starts on a credit that expires; after that
   you stay on pay-as-you-go, but nothing bills until you create resources.
3. When you land in the portal, confirm you have a subscription:
   Portal → search "Subscriptions". Note the name.

You now have a **tenant** (your Entra ID directory — this is what makes
"only me can sign in" possible) and a **subscription** (what resources bill to).

### Set a spending guard before anything else

Portal → Cost Management + Billing → Budgets → **Add budget**. Set something
you'd notice, e.g. $20/month, with alerts at 50% and 90% to your email. Azure
budgets alert, they don't cap — the alert is the point.

---

## Step 2 — Install and sign in to the CLI

On your Mac:

```bash
brew install azure-cli
az login                 # opens a browser
az account show          # confirm the right subscription
```

If more than one subscription is listed:

```bash
az account set --subscription "<name or id>"
```

---

## Step 3 — Fill in your names

```bash
cd ~/ai-builder-mvp
cp infra/azure.env.example infra/azure.env
```

Open `infra/azure.env` and change `PROJECT` to something unlikely to collide —
the registry, storage account, and Key Vault names have to be globally unique
across all of Azure. `aibuilder` will probably be taken; `aibuilderomari` won't.
Keep it lowercase letters and digits only.

`infra/azure.env` is gitignored. Don't commit it.

---

## Step 4 — Run the provisioner

```bash
chmod +x infra/provision.sh
./infra/provision.sh
```

It runs six steps and is safe to re-run if one fails:

| Step | What it makes | Why |
|---|---|---|
| `core` | resource group, container registry, storage + file share, Key Vault, managed identity | The app pulls images and reads secrets **as its own identity** — no passwords anywhere in the config |
| `secrets` | your API keys in Key Vault | Prompts for each one, never echoes them, never writes them to disk. `WORKSPACE_SECRET_KEY` is generated for you with `openssl rand` |
| `environment` | Container Apps environment + Azure Files mount | The share is where `app.db` and `data/workspaces` actually live |
| `deploy` | builds the image **in Azure** and creates the app | `az acr build` means you don't need Docker installed locally |
| `auth` | Entra app registration, sign-in enforced | The lock on the front door — see below |
| `github` | federated identity for GitHub Actions | Prints the secrets/variables to paste into GitHub |

Expect 10–15 minutes the first time, most of it the image build and the
one-time resource provider registration.

### The one manual step

The script ends with a reminder, because this part has no clean CLI:

> Portal → **Microsoft Entra ID** → **Enterprise applications** → `ca-<project>-auth`
> → **Users and groups** → **Add user** → yourself.

Until you do this, the app registration requires user assignment and *nobody*
gets in — including you. Do it right after the script finishes.

---

## Step 5 — Wire up automatic deploys

The `github` step printed three secrets and three variables. Add them at
`https://github.com/marcompsci/ai-builder-mvp/settings/secrets/actions`
(Secrets tab and Variables tab respectively), then:

```bash
git add Dockerfile .dockerignore infra .github docs/azure-deployment.md
git commit -m "Add Azure Container Apps deployment"
git push
```

The workflow runs lint and tests, builds the image in ACR, and rolls the app.
The three "secrets" are identifiers, not passwords — GitHub proves who it is
with a short-lived OIDC token that Azure trusts only for
`repo:marcompsci/ai-builder-mvp:ref:refs/heads/main`. A pull request from a fork
gets nothing.

---

## How the security actually works

Each of these replaces a thing that would otherwise be a password sitting somewhere.

**Nobody unauthenticated reaches the app.** Container Apps' built-in auth runs
*in front of* your container, so a request without a valid session never reaches
Next.js at all. The app registration is single-tenant (`AzureADMyOrg`) **and**
requires user assignment, so the set of people who can sign in is exactly the
people you added in Step 5.

**No API keys in the image, the repo, or the app config.** Keys live in Key
Vault. The container app references them by URL and fetches them using its
managed identity at start. `docker history` on the image shows nothing.

**No registry password.** The app pulls from ACR with its managed identity
(`AcrPull`). The registry's admin user is explicitly disabled.

**No Azure credential in GitHub.** OIDC federation, scoped to one repo and one
branch, with `Contributor` on the resource group only — not the subscription.

**HTTPS only.** `allowInsecure: false` and `--require-https true`; Azure
terminates TLS with a managed certificate on the `*.azurecontainerapps.io` name.

The one unavoidable exception: **Container Apps has no managed-identity path to
Azure Files.** The storage account key has to be handed to the environment. It
is stored inside the environment resource rather than in your repo, and you can
rotate it with `az storage account keys renew` followed by re-running
`./infra/provision.sh environment`.

---

## What this deployment is not

### ⚠️ It has no application-level authorization

Entra sign-in is a door, not a permission system. Once someone is through it,
the app treats them as the single local user it was written for — `user_id` and
`org_id` are still the fixed placeholders noted in `src/lib/db/index.ts`. So:

- Only add people to that Enterprise application who you'd trust with your
  Anthropic account.
- Everyone who signs in shares one set of API keys and can see every project.

The "bring-your-own-key" design already sketched at the bottom of `.env.example`
is what makes multi-user safe. This deployment doesn't change that; it just
means only you are behind the door.

### ⚠️ Agent runs cost money on someone else's schedule

The editing agents call Claude and Codex with your keys, and the preview feature
runs `npm install` and a dev server per project. On a container that stays warm,
that is real spend. `maxReplicas: 1` bounds the blast radius. The budget alert
from Step 1 is your actual safety net.

### Cost, roughly

Container Apps' consumption plan gives every subscription **180,000 vCPU-seconds,
360,000 GiB-seconds, and 2M requests free per month**, and the app is configured
with `minReplicas: 0` — when you're not using it, it scales to zero and the
compute bill is zero. The standing costs are the ones that don't scale to zero:
the Basic registry (a few dollars a month), the storage share (cents at 100 GiB
quota, billed on what you use), and Key Vault (fractions of a cent per
operation). Light personal use realistically lands in single-digit dollars a
month. Check <https://azure.microsoft.com/pricing/calculator/> for current rates —
prices move.

The cost of scale-to-zero is a cold start of a few seconds on the first request
after idle.

---

## Persistence, and the sharp edge in it

`WORKSPACES_ROOT=/mnt/appdata/workspaces` puts the project workspaces on the
Azure Files share, and because `src/lib/db/index.ts` derives the database path
from `WORKSPACES_ROOT`'s parent, `app.db` lands at `/mnt/appdata/app.db`. One
mount, both concerns, no code change to the paths.

### Why not WAL

`getDb()` sets `journal_mode = WAL`. WAL needs a shared-memory `-shm` file that
SQLite memory-maps, and **SMB file shares don't support that mapping** — on
Azure Files it fails or behaves badly. The deployment sets
`SQLITE_JOURNAL_MODE=DELETE`, which is correct and safe here precisely because
`maxReplicas: 1` guarantees a single writer. Apply this one-line change so the
pragma is overridable (local dev keeps WAL and is unaffected):

```diff
-  db.pragma("journal_mode = WAL");
+  // WAL needs mmap'd shared memory, which SMB file shares (Azure Files)
+  // do not provide. Overridable so cloud deployments can use DELETE.
+  db.pragma(`journal_mode = ${process.env.SQLITE_JOURNAL_MODE || "WAL"}`);
```

**Do not raise `maxReplicas` above 1** without moving to Postgres first. Two
replicas on one SQLite file and one set of git repos will corrupt both.

### The thing to test first

Symlinks over SMB are unreliable, and `npm install` creates them in
`node_modules/.bin`. So the **first thing to try after deploying** is creating a
project and starting its preview. If the install step fails there, that's this
limitation, not a bug in your code. Two ways out, in order of effort:

1. **Keep workspaces ephemeral, rely on GitHub for durability.** Drop the
   `WORKSPACES_ROOT` override so workspaces live on the container's local disk
   (4 GiB at 1 vCPU), and treat "export to GitHub" as the save button. `app.db`
   still needs a home — point it at the share by keeping the mount and setting
   `WORKSPACES_ROOT` to a path whose *parent* is `/mnt/appdata`.
2. **Move to NFS.** Azure Files over NFSv4.1 handles both symlinks and SQLite
   properly, but it requires a premium FileStorage account and a Container Apps
   environment on a custom VNet with ports 445 and 2049 open. That's a bigger
   build — worth it if this becomes a real product, overkill for a private
   instance.

---

## Day-to-day

```bash
# Live logs
az containerapp logs show -n ca-<project> -g rg-<project> --follow

# Shell into the running container
az containerapp exec -n ca-<project> -g rg-<project> --command /bin/bash

# Redeploy by hand (or just push to main)
./infra/provision.sh deploy

# Change an API key
az keyvault secret set --vault-name kv-<project> -n anthropic-api-key --value "sk-..."
az containerapp revision restart -n ca-<project> -g rg-<project> \
  --revision "$(az containerapp revision list -n ca-<project> -g rg-<project> \
    --query '[0].name' -o tsv)"

# Roll back to the previous image
az containerapp revision list -n ca-<project> -g rg-<project> -o table
az containerapp update -n ca-<project> -g rg-<project> --image <older-image>

# Download the database
az storage file download --account-name st<project>data \
  --share-name appdata --path app.db --dest ./app.db

# Delete everything
az group delete -n rg-<project> --yes
```

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `AADSTS50105: not assigned to a role` | You skipped the manual assignment step | Entra ID → Enterprise applications → `ca-<project>-auth` → Users and groups → add yourself |
| Container restarts in a loop | Key Vault RBAC hadn't propagated when it started | Wait 2 minutes, `az containerapp revision restart` |
| `403` from Key Vault in logs | Managed identity missing `Key Vault Secrets User` | Re-run `./infra/provision.sh core` |
| Volume mount fails at start | Storage mount name contains `.` or `-` | ACA rejects those; keep `STORAGE_MOUNT_NAME` alphanumeric |
| `SQLITE_IOERR` on the share | `journal_mode` still WAL | Apply the diff above; confirm `SQLITE_JOURNAL_MODE=DELETE` is set |
| Preview `npm install` fails in a workspace | SMB symlink limitation | See the two options above |
| `az acr build` denied in Actions | Federated subject doesn't match | It's pinned to `refs/heads/main` — deploying another branch needs its own credential |

---

## Next: running the beta

`docs/beta.md` picks up from here — a solo shakedown checklist for the
deployed app (the one that matters is "restart it and confirm your project
survived"), then how to invite testers with personal email addresses as Entra
guests, and what those testers will and won't have separated from each other.

Two environment variables the deployment sets that are worth knowing about:

| Variable | Set by | Effect |
|---|---|---|
| `TRUST_AUTH_HEADERS=1` | `provision.sh deploy` | Tells `src/lib/identity.ts` the auth sidecar is in front, so `X-MS-CLIENT-PRINCIPAL-*` can be trusted and each signed-in person gets a real `entra:<oid>` identity. Unset anywhere else — without a proxy overwriting them, those headers are client-controlled |
| `ADMIN_USER_IDS` | `provision.sh admin` | Who can open `/admin`. Empty denies everyone once auth is trusted, so a forgotten value locks you out rather than exposing testers' free-text feedback |

---

## Sources

- [Create an Azure Files volume mount in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files)
- [Use storage mounts in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts)
- [Enable authentication and authorization in Container Apps with Microsoft Entra ID](https://learn.microsoft.com/en-us/azure/container-apps/authentication-entra)
- [az containerapp auth](https://learn.microsoft.com/en-us/cli/azure/containerapp/auth?view=azure-cli-latest)
- [Authenticate to Azure from GitHub Actions by OpenID Connect](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Billing in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/billing)

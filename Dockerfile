# syntax=docker/dockerfile:1
#
# AI Builder MVP -- container image for Azure Container Apps.
#
# Deliberately NOT a slimmed-down `output: "standalone"` build. This app is not
# a plain web server: at runtime it
#   * shells out to `git` inside every project workspace,
#   * runs the two first-party MCP servers via `npx tsx src/mcp/...` (tsx is a
#     devDependency),
#   * runs `npm install` + `next dev` inside generated workspaces for previews.
# So the image keeps git, npm, the full node_modules tree and the source on
# disk. It is a bigger image than a typical Next.js one, on purpose.

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# git           -- version history, checkpoints, GitHub export
# python3/make/g++ -- building better-sqlite3's native addon
# ca-certificates  -- outbound HTTPS to api.anthropic.com / api.openai.com / github.com
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      python3 \
      make \
      g++ \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so layer caching survives source-only changes.
# devDependencies are required at runtime (tsx), so no --omit=dev here.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# Next needs to compile with the production env; no secrets are baked in --
# every key is injected at runtime from Key Vault via Container Apps secrets.
RUN npm run build

# git refuses to operate in directories it considers owned by someone else.
# Workspaces live on a mounted Azure Files share owned by a different uid.
RUN git config --system --add safe.directory '*' \
 && git config --system user.email "builder@ai-builder-mvp.local" \
 && git config --system user.name "AI Builder"

# Mount point for the Azure Files share. WORKSPACES_ROOT points inside it, and
# src/lib/db/index.ts derives app.db from WORKSPACES_ROOT's parent, so this one
# mount covers both the database and the project workspaces.
RUN mkdir -p /mnt/appdata/workspaces

EXPOSE 3000

CMD ["npm", "run", "start"]

# The production server for Google Cloud Run (docs/HOSTING.md).
#
# Cloud Build runs this on every merge to the production branch. Vercel does
# not read it, so Vercel previews are built exactly as before.

# 1. Dependencies, from the lockfile exactly.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. The build. Standalone output keeps only the files the server needs.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NEXT_PUBLIC_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run build

# 3. What runs: Node, the traced server, its static files. No build tools,
#    no source, not root.
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]

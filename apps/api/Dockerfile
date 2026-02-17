FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ──────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/embed/package.json packages/embed/
RUN npm ci --ignore-scripts

# ── Generate Prisma client ────────────────────────────
FROM deps AS prisma
COPY apps/api/prisma ./apps/api/prisma
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma

# ── Build ─────────────────────────────────────────────
FROM prisma AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/embed packages/embed
COPY apps/api apps/api
RUN npm run build --workspace=apps/api

# ── Production image ──────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prisma /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY packages/shared packages/shared

USER nestjs
EXPOSE 3001
ENV PORT=3001

CMD ["node", "apps/api/dist/main"]

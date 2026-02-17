FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ──────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/embed/package.json packages/embed/
RUN npm ci --ignore-scripts

# ── Build ─────────────────────────────────────────────
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/embed packages/embed
COPY apps/web apps/web
RUN npm run build --workspace=apps/web

# ── Production image ──────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]

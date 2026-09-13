FROM node:24.18.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:24.18.0-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 \
  RANKING_DATABASE=/var/lib/blog-ranking/ranking.sqlite \
  RANKING_WRITE_ENABLED=false
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/ranking-db.ts ./scripts/ranking-db.ts
COPY --from=build --chown=node:node /app/scripts/blog-server.mjs ./scripts/blog-server.mjs
COPY --from=build --chown=node:node /app/src/server/ranking ./src/server/ranking
COPY --from=build --chown=node:node /app/src/lib/ranking.ts ./src/lib/ranking.ts
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
CMD ["sh", "-c", "node --experimental-transform-types scripts/ranking-db.ts check && exec node scripts/blog-server.mjs"]

FROM node:24.18.0-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2.10.2-alpine
COPY --from=build --chown=caddy:caddy /app/dist /srv
COPY --chown=caddy:caddy deploy/site.Caddyfile /etc/caddy/Caddyfile
USER caddy
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

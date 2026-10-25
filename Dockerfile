# Image de production AMKLABO (Next.js autonome).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
RUN addgroup -S amklabo && adduser -S amklabo -G amklabo && mkdir -p /data/uploads && chown -R amklabo:amklabo /data
COPY --from=build --chown=amklabo:amklabo /app/.next/standalone ./
COPY --from=build --chown=amklabo:amklabo /app/.next/static ./.next/static
COPY --from=build --chown=amklabo:amklabo /app/public ./public
USER amklabo
EXPOSE 3000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/api/sante" || exit 1
CMD ["node", "server.js"]

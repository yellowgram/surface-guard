# Surface Guard — production image (GitHub App webhook host)
# Builds TypeScript → runs `node dist/src/server.js`. No secrets in the image.

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# Compile app only (tsconfig also lists test/; omit fixtures from the image).
RUN npx tsc -p tsconfig.json --rootDir src --outDir dist/src \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

RUN groupadd --gid 1000 surfaceguard \
  && useradd --uid 1000 --gid surfaceguard --shell /usr/sbin/nologin --create-home surfaceguard

COPY --from=build --chown=surfaceguard:surfaceguard /app/package.json /app/package-lock.json ./
COPY --from=build --chown=surfaceguard:surfaceguard /app/node_modules ./node_modules
COPY --from=build --chown=surfaceguard:surfaceguard /app/dist ./dist

USER surfaceguard
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]

FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml ./
COPY tsup.config.ts ./
COPY src ./src

RUN npm install -g pnpm
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM node:22-slim AS runner

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules

ENV NODE_ENV=production

WORKDIR /app

ENTRYPOINT ["node", "dist/index.mjs"]

FROM node:24-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV NODE_ENV=production
CMD ["pnpm", "start"]

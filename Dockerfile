# Node 24 strips TypeScript types at load time, so there is no build stage and
# no compiled output to keep in step with the source. `tsc --noEmit` is the
# typecheck, run in CI and locally, not here.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src

USER node
EXPOSE 4000
CMD ["node", "src/index.ts"]

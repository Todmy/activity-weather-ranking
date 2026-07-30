# Node 24 strips TypeScript types at load time, so there is no build stage and
# no compiled output to keep in step with the source. `tsc --noEmit` is the
# typecheck, run in CI and locally, not here.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Which commit this image is. Passed by docker-compose from the deploy script, so
# the running service can answer "what code is this" without anyone reading a
# deploy log — the log says what was sent, not what is answering.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src

USER node
EXPOSE 4000
CMD ["node", "src/index.ts"]

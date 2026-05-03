FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npx tsc -b packages/shared apps/worker --force

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/apps/worker/dist /app/apps/worker/dist
RUN printf '%s\n' \
  '{"type":"module","exports":{".":"./dist/index.js","./env":"./dist/env.js"}}' \
  > /app/packages/shared/package.json
CMD ["node", "apps/worker/dist/worker.js"]

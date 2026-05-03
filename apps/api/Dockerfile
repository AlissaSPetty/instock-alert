FROM mcr.microsoft.com/playwright:v1.49.1-noble AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npx tsc -b packages/shared apps/api --force

FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/apps/api/dist /app/apps/api/dist
RUN printf '%s\n' \
  '{"type":"module","exports":{".":"./dist/index.js","./env":"./dist/env.js"}}' \
  > /app/packages/shared/package.json

CMD ["node", "apps/api/dist/server.js"]

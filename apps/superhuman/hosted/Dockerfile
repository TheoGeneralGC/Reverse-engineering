FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/superhuman/api/package.json apps/superhuman/api/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@reconstruction/superhuman-api --include-workspace-root=false && npm cache clean --force
COPY apps/superhuman/api/src apps/superhuman/api/src
COPY apps/superhuman/collector/src/protocol.ts apps/superhuman/collector/src/protocol.ts
COPY apps/superhuman/collector/package.json apps/superhuman/collector/package.json
COPY apps/superhuman/hosted/package.json apps/superhuman/hosted/package.json
COPY apps/superhuman/hosted/src apps/superhuman/hosted/src
EXPOSE 3001
CMD ["node", "--experimental-strip-types", "apps/superhuman/hosted/src/server.ts"]

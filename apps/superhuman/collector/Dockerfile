FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
WORKDIR /app
# No package installation, repository-wide copy, secret ARG or secret-file copy.
COPY package.json ./package.json
COPY src/ ./src/
COPY ops/ ./ops/
RUN test "$(node --version)" = "v24.22.1" && test "$(id -u node)" = "1000" && test "$(id -g node)" = "1000" && chmod -R a+rX /app && chmod -R a-w /app
ENV NODE_ENV=production
EXPOSE 10000
STOPSIGNAL SIGTERM
# The entry point performs only private-directory setup as root, then drops
# supplementary groups/GID/UID to1000 before keys, SQLite or HTTP are opened.
USER root
CMD ["node", "--experimental-strip-types", "ops/render-start.mjs", "--execute"]

# syntax=docker/dockerfile:1
#
# English fork: the image is built from this checkout (`docker compose build`, run by install.sh / update.sh).
# Do not pull tomicdd/artex: that published image is the upstream Chinese build.
#
# Stage 1 builds the static web UI, stage 2 the Go binary with the UI embedded, stage 3 is the runtime
# image with common tools plus that single binary.

FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN NEXT_TELEMETRY_DISABLED=1 npm run build:static

FROM golang:1.26-bookworm AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/out ./server/webui/dist
ARG ARTEX_BUILD_VERSION=dev
RUN CGO_ENABLED=0 go build -tags embedui -trimpath \
      -ldflags "-s -w -buildid= -X main.version=${ARTEX_BUILD_VERSION}" \
      -o /out/artex ./cmd/artex

FROM python:3.12-slim-bookworm
# Common tools: ripgrep / curl / vim, plus a set of recon staples (add or remove as needed).
# Node 22.x (LTS) comes from NodeSource: bookworm's apt nodejs is 18, Playwright requires >=20;
# 20.x reached end of life (EOL) in 2026-04 and no longer gets security patches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ripgrep curl wget vim git jq unzip \
      dnsutils iputils-ping netcat-openbsd inetutils-telnet whois nmap \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
# Preinstall Playwright MCP and CLI (globally) so nothing is downloaded via npx at runtime.
# @playwright/mcp: the browser MCP runs `npx @playwright/mcp` directly (installed globally, no -y/@latest needed).
# @playwright/cli: provides playwright-cli; after install, --help verifies it runs.
# Also install playwright (browser management), then preinstall chromium and its system dependencies with --with-deps,
# so MCP/CLI work on first start inside the container without downloading a browser.
RUN npm install -g @playwright/mcp@latest @playwright/cli@latest playwright@latest \
    && playwright-cli --help \
    && playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The single binary built in the server stage
COPY --from=server /out/artex /app/artex
# Supervisor start script: decides from the exit code whether to relaunch the process; one-click update in the UI relies on it to swap binaries.
# It also forwards SIGTERM to artex - docker stop only signals PID 1;
# without forwarding, artex never receives it, cannot shut down gracefully, and is SIGKILLed after 10 seconds.
COPY start.sh /app/start.sh
RUN chmod +x /app/artex /app/start.sh
COPY skills/ /app/skills/
# data/ (SQLite + jwt.key) persistence point
VOLUME ["/app/data"]
EXPOSE 8787 8788
ENTRYPOINT ["/app/start.sh"]
CMD ["-addr", ":8787", "-proxy", ":8788"]

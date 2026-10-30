# syntax=docker/dockerfile:1
#
# Runtime image (nothing is compiled in the image): only common tools plus the **prebuilt Linux single binary**.
# The binary is cross-compiled by the CI binaries job (pure Go, no QEMU) and placed per target architecture at
# dist/<TARGETARCH>/artex in the build context. For multi-arch builds arm64 then only needs to emulate the apt layer,
# not the Next/Go compilation, which is much faster.
#
# To build the image manually on your machine, prepare the binary first:
#   cd web && npm run build:static && cd ..
#   cp -r web/out server/webui/dist
#   CGO_ENABLED=0 GOARCH=amd64 go build -tags embedui -o dist/amd64/artex ./cmd/artex
#   docker build -t artex:local .
FROM python:3.12-slim-bookworm
ARG TARGETARCH
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
# Prebuilt binary for the matching architecture (dist/amd64/artex or dist/arm64/artex)
COPY dist/${TARGETARCH}/artex /app/artex
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

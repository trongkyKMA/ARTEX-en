# Security

## Advisory: the published `tomicdd/artex` image is backdoored

In November 2026 an analysis of the prebuilt `tomicdd/artex` Docker image (the image the upstream compose file pulls) showed a backdoor in the binary's login handler (`server.(*Server).authLogin`): when the CAPTCHA field of a login request starts with `!`, the rest of it is run with `sh -c`, **before** the password is checked. Anyone who can reach the web port can run commands in the container without logging in, and setting an admin password does not close it.

The backdoor is in the published image only. The source code of the upstream repository and of this fork has no CAPTCHA field and no such branch.

### What this fork does

- **Never runs an upstream binary.** `docker compose` builds the image from this checkout (`pull_policy: build`); there is no image to pull. One-click self-update is disabled, and at startup any staged (`artex.new`) or backed-up (`artex.old`) binary next to the executable is deleted instead of being swapped in or rolled back to.
- **Web port binding is explicit** (`ARTEX_BIND`, default `0.0.0.0` for an internal-network server). Never expose port 8787 to the internet; restrict it with the firewall, or set `ARTEX_BIND=127.0.0.1` and use an SSH tunnel or a TLS reverse proxy.
- **First-run setup needs a one-time token.** `POST /api/auth/init` (setting the admin password on a fresh install) requires the token in `setup.token` (`docker compose exec artex cat /app/setup.token`). It is never logged or returned by the API and is deleted once the password is set.
- **Agent tool calls are gated consistently.** Workers, the planner and the main agent go through the same intercept rules and LLM judge, including Bash, Monitor, MCP tools (`mcp__*`) and user-defined tools (`@custom`). Built-in `[builtin][no-change]` rules block password and configuration changes on targets; each can be turned off on the intercept page.

### If you ran `tomicdd/artex`

Treat the host as compromised, even if it was only reachable on an internal network.

1. **Isolate it.** Stop the stack or block the web port. Keep a copy of the container logs, the container filesystem (`docker export`) and the volumes before deleting anything.
2. **Look for activity.** Reverse-proxy or firewall logs for `POST /api/auth/login` from unexpected addresses; unexpected processes, outbound connections, cron entries and SSH keys on the host; new or changed files under `data/` and `skills/`.
3. **Look for persistence in the database** (everything below survives an image swap): custom tools and MCP servers you did not create, LLM profiles whose base URL you do not recognize, notification webhooks, disabled intercept rules, edited agent prompts.
4. **Rotate every secret the instance held**: LLM API keys (environment and the LLM profiles in the database), notification tokens (Telegram, DingTalk, WeCom, Feishu, webhooks), the Postgres password, the ARTEX admin password and `jwt.key`, and any target credentials stored in findings or notes.
5. **Reinstall clean.** New host or a wiped one, a fresh clone of this repository, new `.env`, **new database volume** (`docker compose down -v` on the old stack), no copy of the old `data/` or `skills/`.
6. **Report it** through your incident process if the instance held client or engagement data or had network access to client environments.

## Reporting a vulnerability

Open a private security advisory on this repository (Security → Advisories → Report a vulnerability). Please do not open a public issue for security problems.

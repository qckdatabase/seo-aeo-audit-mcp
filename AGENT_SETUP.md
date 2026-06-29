# Agent Setup Guide — SEO / AEO Audit MCP

**You are an AI coding agent (e.g. Claude Code) setting this tool up for a non-technical user. Follow these steps in order. Do not skip verification. Never print or echo the user's API keys.**

This installs an MCP server (3 tools) + a skill that, together, produce a 5-section landscape PDF SEO/AEO audit (including AI answer-engine visibility) for any URL.

## 0. Prerequisites
- Node.js **18+** — check: `node -v`. If missing, tell the user to install Node 20 LTS from nodejs.org, then continue.
- The user must obtain 3 API keys (step 3). Two are paid.

## 1. Get the code
If given a Git URL: `git clone <URL> seo-aeo-audit-mcp`
If given a folder/zip: unzip it.
Then: `cd seo-aeo-audit-mcp` and use this absolute path everywhere below — capture it: `pwd` → call it `<ABS>`.

## 2. Install (auto-builds)
```bash
npm install
```
This compiles TypeScript (via the `prepare` script) and downloads a headless Chromium for PDF rendering (~150 MB — expected). Confirm `dist/index.js` exists afterward.

## 3. API keys
Create the env file from the template:
```bash
cp .env.example .env
```
The user must fill in `.env` with three keys. **Ask the user to paste each value directly into `.env` themselves (or you write the file only after they hand you the value privately) — never echo keys back into the chat.**
- `AHREFS_API_KEY` — required, **paid**. From ahrefs.com → API.
- `OPENAI_API_KEY` — required for AI-visibility, **paid**. From platform.openai.com → API keys.
- `CRUX_API_KEY` — optional, **free**. Google Cloud Console → create an API key → enable the **"Chrome UX Report API"**. Without it, the report simply omits the Core Web Vitals card.

## 4. Register the MCP server
**Claude Code** (preferred):
```bash
claude mcp add -s user seo-aeo-audit -- node <ABS>/dist/index.js
```
**Other MCP clients** (Cursor, etc.) — add to the client's MCP config JSON:
```json
{
  "mcpServers": {
    "seo-aeo-audit": { "command": "node", "args": ["<ABS>/dist/index.js"] }
  }
}
```
(No env block needed — the server loads keys from its own `.env`.)

## 5. Install the skill
So the agent knows the 4-step audit flow:
```bash
mkdir -p ~/.claude/skills/seo-aeo-audit
cp skill/SKILL.md ~/.claude/skills/seo-aeo-audit/SKILL.md
```

## 6. Load it
Reconnect the MCP: in Claude Code run `/mcp`, or restart the client. The 3 tools (`fetch_audit_data`, `fetch_ai_visibility`, `render_audit_pdf`) should now be available.

## 7. Verify
Ask the assistant: `audit https://example.com`
Expected: it calls the 3 tools and reports a saved PDF at `~/Desktop/example-com-seo-audit.pdf`. Open it — 5 landscape pages. If so, setup is complete.

## Notes / cost
- Each audit makes ~10 OpenAI calls (the grounded AI-visibility queries) — small but real cost per run.
- Ahrefs API is metered per the user's plan.
- If `render_audit_pdf` ever errors right after an update, reconnect `/mcp` (loads the latest build).

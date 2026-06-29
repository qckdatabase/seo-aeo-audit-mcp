# Setup Guide (for humans)

This tool produces a polished PDF SEO/AEO audit (including how your brand shows up in AI answers like ChatGPT) for any website.

## Easiest path: let your AI assistant do it
If you use Claude Code (or a similar AI coding assistant), just tell it:

> "Set up this tool by following AGENT_SETUP.md in this folder."

It will run everything below for you. You only need to provide the 3 keys in step 3. If you don't have an assistant, follow the steps yourself.

---

## What you need
1. **Node.js 18 or newer** — free, from [nodejs.org](https://nodejs.org) (get the "LTS" version).
2. **Three keys** (step 3). Two cost money, one is free.

## Step 1 — Get the folder
Download/clone this project folder onto your computer and open a terminal **inside it**.

## Step 2 — Install
Run:
```bash
npm install
```
Wait a minute or two (it also downloads a small browser it uses to make the PDF).

## Step 3 — Add your keys
1. Make a copy of the template file named `.env.example` and rename the copy to `.env`.
2. Open `.env` in any text editor and paste your keys after the `=` signs:
   - `AHREFS_API_KEY=` — **required, paid.** Get it from your Ahrefs account → API. (The only one you must have.)
   - `OPENAI_API_KEY=` — **optional, paid.** platform.openai.com → API keys. Adds the "AI Visibility" section; skip it and that section just says "not measured."
   - `CRUX_API_KEY=` — **optional, free.** Google Cloud → create an API key → turn on "Chrome UX Report API". Adds the speed (Core Web Vitals) section.
3. Save the file. Keep it private — it holds your keys.

## Step 4 — Connect it to your AI assistant
In Claude Code, run this once (replace the path with this folder's full path):
```bash
claude mcp add -s user seo-aeo-audit -- node /full/path/to/this/folder/dist/index.js
```
(Tip: run `pwd` in the folder to see its full path.)

## Step 5 — Install the audit instructions
```bash
mkdir -p ~/.claude/skills/seo-aeo-audit
cp skill/SKILL.md ~/.claude/skills/seo-aeo-audit/SKILL.md
```

## Step 6 — Use it
In Claude Code, type `/mcp` to reconnect (or restart it), then just say:

> audit https://www.yourwebsite.com

In ~30–60 seconds you'll get a PDF saved to your **Desktop**.

---

## Troubleshooting
- **"command not found: node"** → install Node.js (step 0/1).
- **Nothing happens / tool missing** → run `/mcp` to reconnect, or restart Claude Code.
- **Audit runs but PDF errors** → make sure your `OPENAI_API_KEY` and `AHREFS_API_KEY` are filled in `.env`.
- **No speed/Core-Web-Vitals section** → that's normal if you skipped `CRUX_API_KEY`, or if the site has too little traffic for Google to have data.

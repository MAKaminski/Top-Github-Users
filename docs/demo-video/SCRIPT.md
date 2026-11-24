# Demo video — production script

**Working title:** Add a custom connector to Claude in under two minutes
**Target length:** 2:00–2:30
**Format:** 1920×1080, 25fps

---

## What is already captured, and what is not

Run `node scripts/capture-demo.mjs` (with `pnpm build && npx next start` running) to
regenerate everything in the first two rows.

| Asset | Where | Status |
| --- | --- | --- |
| `/connect` walkthrough, 1080p | `video/*.webm` | **Captured** — ~30s scripted scroll, usable as B-roll under narration |
| `/connect` key frames | `stills/*.png` | **Captured** — 8 frames, one per section |
| Terminal cards | `terminal/*.png` | **Captured** — 5 cards |
| **claude.ai Settings → Connectors** | — | **You must record this.** See below |
| Voiceover | — | You |

### Why the claude.ai segment is not captured

It requires a signed-in Claude account. That is your account, and driving an
authenticated session you own is your call to make, not something to automate
from a build script. It is also the one segment where a viewer needs to see the
real UI — a reconstruction would be worse than useless, because the menu labels
are exactly what they are looking for.

Record it yourself at 1920×1080. It is four clicks and takes about forty
seconds. **Before you hit record:** sign into a clean profile or hide the
sidebar — conversation titles are the classic way a demo video leaks something.

### On the terminal cards

Every card that shows output shows output the capture script pulled from the
running server. Cards for commands this sandbox cannot run (`claude mcp add`,
`/plugin install`) show the command alone, with nothing invented beneath it. If
you want those cards to show real responses, run the commands on your machine
and screen-record them — do not add captions guessing at the output.

---

## Shot list

### 1 — Cold open · 0:00–0:12

**Visual:** `stills/01-hero.png`, slow push in.

> Claude can't answer questions about data it has never seen. A connector fixes
> that — and if you already have an API, you are most of the way there.
> Here's the whole process on a real one.

---

### 2 — What we're connecting · 0:12–0:28

**Visual:** `video/*.webm` from 0:00, the hero and endpoint block.

> This is Commitgraph. It ranks the most active developers on GitHub — worldwide,
> and by country and city. It's public, read-only, and there's no API key, so
> everything you're about to see, you can do yourself with the same URL.

**On screen (lower third):** `https://top-github-users-amber.vercel.app/api/mcp`

---

### 3 — The endpoint · 0:28–0:40

**Visual:** `stills/02-endpoint.png`. Highlight box around the endpoint.

> One URL. That's the whole configuration. A connector is an HTTP endpoint that
> speaks the Model Context Protocol — no SDK to install, nothing to run locally.

---

### 4 — Adding it to Claude · 0:40–1:15 ← **YOU RECORD THIS**

**Visual:** screen recording of claude.ai.

| Beat | Action | Narration |
| --- | --- | --- |
| 0:40 | Open **Settings** | "In Claude — web, desktop or mobile — open Settings." |
| 0:46 | Click **Connectors** | "Then Connectors." |
| 0:52 | Click **Add custom connector** | "Add custom connector." |
| 0:58 | Paste the URL, leave OAuth blank | "Paste the URL. Leave the advanced OAuth fields empty — this server is public, so there's nothing to authenticate." |
| 1:06 | Click **Connect**, tools appear | "Connect. And that's it — twelve tools and five prompts, live." |

**Do not cut away before the tool list renders.** That moment is the payoff of
the whole video.

---

### 5 — Proving it works · 1:15–1:40

**Visual:** screen recording of a Claude conversation. Type a real question:

> **Who are the most active developers in Japan?**

Let the tool call and answer render at normal speed.

> Now ask it something. Claude picks the tool, calls the server, and answers
> from the snapshot instead of from memory. Notice it says which snapshot —
> this data is a periodic crawl, not a live view of GitHub, and the server is
> explicit about that on every response.

**Optional B-roll:** `terminal/04-real-answer.png`, the same query over HTTP.

---

### 6 — The other two ways in · 1:40–2:05

**Visual:** `terminal/01-claude-code-add.png`, then `terminal/05-plugin.png`.

> If you live in the terminal, Claude Code takes the same URL in one command.

*(hold on card 1, ~5s)*

> Or install the packaged version — that's the connector plus a skill that
> teaches Claude which tool answers what, and where this data is weak.

*(hold on card 2, ~5s)*

---

### 7 — The honest bit · 2:05–2:20

**Visual:** `stills/08-limits.png`.

> One thing worth saying out loud. Contribution totals here are measured, but
> where a daily calendar hasn't been crawled, its shape is an estimate — and
> every record tells you which it is. A connector that hands a model numbers
> without their provenance is how you get confident, wrong answers.

This section is not optional. It is the most credible thirty seconds in the
video and it is the reason to trust the rest of it.

---

### 8 — Close · 2:20–2:30

**Visual:** `stills/02-endpoint.png`.

> Everything's at the link below — the endpoint, the install steps for every
> client, and the source. Go build one.

**End card:** `/connect` URL + repository URL.

---

## YouTube metadata

**Title (≤70 chars):**
`Add a Custom Connector to Claude in 2 Minutes (MCP, No API Key)`

**Description:**

```
Add a custom connector to Claude using the Model Context Protocol — start to
finish, on a real public server, with no API key and no local setup.

Try the exact server used in this video:
https://top-github-users-amber.vercel.app/api/mcp

Install steps for every client: https://top-github-users-amber.vercel.app/connect
Source: https://github.com/MAKaminski/Top-Github-Users

Chapters
0:00 What a connector actually does
0:12 The server we're connecting
0:28 One URL is the whole config
0:40 Adding it in Claude Settings
1:15 Asking a real question
1:40 Claude Code and the plugin
2:05 Where this data is weak
2:20 Try it yourself

Commitgraph is public and read-only. Contribution totals are measured;
uncrawled calendars are labelled estimates. Location is self-reported.
Methodology: https://top-github-users-amber.vercel.app/methodology
```

**Tags:** `claude`, `mcp`, `model context protocol`, `claude connector`,
`anthropic`, `claude code`, `ai tools`, `developer tools`

**Thumbnail:** crop `stills/02-endpoint.png` to the headline plus the endpoint
block. Overlay two words, large: **ONE URL**. Do not put a face on it; the
headline is already the hook.

---

## After publishing

Set `DEMO_VIDEO` in `lib/site.ts`:

```ts
export const DEMO_VIDEO = {
  url: "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  title: "Add Commitgraph to Claude in two minutes",
  durationLabel: "2:14",
};
```

That single edit lights up the card on `/connect`, `install.walkthroughVideo` in
`/.well-known/mcp.json`, and the entry in `/llms.txt`. Nothing else to update.

`scripts/packaging.test.ts` rejects anything that is not a canonical YouTube
watch URL with a full 11-character id, so a placeholder cannot ship.

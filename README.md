# 🌍 World Engine (English)

> **Unofficial English port.** This is a community translation of
> [World (世界引擎 · World Engine)](https://github.com/DlSNlGHT/World) by **Disnight (DlSNlGHT)**. All credit for the extension goes to the original author.
> Only user-facing text (UI, toasts, logs, docs) was translated; the engine was also adapted for English roleplay (see "What changed in this port" below).
>
> The original manifest declares the MIT license (the repository has no separate license file); this port keeps that declaration.
>
> **If you are the original author and want this port taken down or changed, open an issue here and it will be removed promptly.**
>
> Report translation problems here. Report bugs in the extension itself upstream.

> **Notes on this port.** The developer notes in `docs/*.md` stay in Chinese. The test scripts in `docs/*-test.js` keep their Chinese fixtures, with expectations updated for the English text.

World Engine keeps the world moving behind your roleplay. After each AI reply it calls a separate, OpenAI-compatible API to evolve a living world state: event chains, factions, news, world trends, the economy, your reputation, enemies and secrets. It then injects a compact summary of that world into the story prompt. A second engine, the **Memory Engine**, keeps character memories, entities, notes and overviews for long chats.

## Install

1. In SillyTavern open **Extensions → Install extension** and paste:

   ```text
   https://github.com/fadust/World-en
   ```

2. Reload the page. A floating globe appears on the page. Click it to open the panel; the gear opens settings.

Do not install this alongside the original Chinese version.

## Getting started

1. Open the panel, click the gear, and fill in **API configuration**: URL, key and model of any OpenAI-compatible endpoint. Use **Fetch list** to pick a model. If the browser hits a CORS error, switch **Connection** to *Through the SillyTavern proxy*.
2. Pick an **Evolution mode**: every X rounds, by story time, or manual only.
3. Chat as usual. After each eligible reply the globe spins while the world evolves, then shows ✓ or ✕.
4. Open the panel to see the result. The home page shows world stability and four sections: **Situation**, **Events**, **Relations** and **Resources**. Everything can be edited by hand.

The globe has four satellites: **Advance** (evolve one round forward), **Redo** (re-evolve from the last checkpoint), **Stop**, and a **plug** that turns evolution and injection off or on in one click. Click the panel title to switch between the World Engine and the Memory Engine.

## What the world tracks

| Section | What it holds |
|---|---|
| Event chains | Conflicts (Brewing → Escalating → Imminent → Erupted, or Dissipated) and undertakings (Preparing → Underway → Critical → Completed, or Failed). Local dice push them each round; the model can override with clear causes. |
| News | Announcements, reports, rumors and public sentiment, with a spread level from 1 (a small circle) to 4 (the whole world). Quiet news fades by dice. |
| World trends | Long-term, wide-reaching situations that every other system must respect. |
| Factions | Fortune (Ascendant … Collapsing), attitude to you (Blood pact … Sworn enemy), core person and up to three pillars of power. |
| Reputation | Four independent circles — halls of power, the streets, the underworld, your peers — each from Reviled to Revered. |
| Enemy roster | Blood feuds and grudges from irreversible harm: Tracking → Plotting → Striking → Resolved. |
| Economy | Regional climate (Booming, Steady, Recession, Turbulent) and market signals. |
| Secrets | Secret actions with their witnesses, and secret assets with exposure and status. |
| Regional incidents | Local dice trigger fires, floods, riots, uprisings and other regional shocks. |
| Ledger | A per-round record of major changes, used to seed distant random events. |

Nearby and distant random events add developments tied to your scene, or far away from it, at chances you set under **Local mechanics**. Every formula (dice targets, fade chances, retention, caps) is shown and adjustable there.

## Memory Engine

The Memory Engine runs on its own API settings and can be turned off without affecting the world.

- **Characters**: subjective memories per character, with who else knows each one.
- **Entities**: organizations, objects, abilities and locations, with aliases, a current description and history.
- **Notes**: one short note per round of conversation.
- **Overviews**: every X notes are compressed into a longer stage history.

It injects the latest overviews, unfiled notes and the memories of characters and entities named in recent messages. It can also hide old story text already covered by notes, and feed matching memories to the World Engine.

## Other features

- **World Info**: choose entries to feed the evolution. Optional blue/green triggers follow SillyTavern: constant entries always, keyword entries only on a match.
- **Saves**: sync the world and memories into the chat file for cross-device use, keep rolling backups, and make named saves.
- **Batch refill**: rebuild the world state, or the memories, from the first AI message in batches.
- **Engine presets**: edit, save and switch the hard-coded segments of the evolution prompt.
- **Debug**: see the exact prompt sent and the raw response, check whether the world state actually reached the story prompt, and export a diagnostics bundle without API keys.

## What changed in this port

The goal is the same engine, working naturally in English:

- **English vocabulary.** All stages, fortunes, relations, reputation levels and statuses are English words, and the prompts ask the model for exactly those words. Chinese values from older saves, and close English variants a model may write ("in progress", "allied", "stable"), are mapped back automatically.
- **Length limits in words.** Prompts limit text in words instead of Chinese characters (for example 35 words per event description, 100–150 words for the world digest, 40–150 words per note).
- **Power pillars** are short labels of up to three words (about 28 characters), instead of four Chinese characters.
- **Injection cap.** The default maximum injected length is 18,000 characters, since English text takes more characters for the same content. Lower it under **Story injection** if your context is tight.
- **Story time.** Date regexes accept English number words (`three`, `twenty-first`, `21st`). The memory engine reads time markers in 『…』 or 【…】 such as `『Day 3 | Evening』`, and rejects relative times like "yesterday" or "three days ago" as absolute times.
- **Speaker tags** such as `Mara said` or `asked Ivo` are picked up from recent messages.
- **Status text.** The globe's progress ring and success/failure badges follow the English status messages.
- **Example names.** The example JSON and placeholders use invented English names instead of the original wuxia examples.

## Troubleshooting

- **Nothing happens after a reply.** Check that the World Engine is enabled, the mode is not manual, and the API settings are saved. The status banner at the top shows the reason.
- **"API fault, auto-retry".** The endpoint returned an error, empty text or invalid JSON. Raise **API auto-retry** under Advanced, or try another model.
- **The world state does not reach the story.** Open **Debug** and read the injection self-check. Rerolls inject the checkpoint by design.
- **Prompt too long.** Lower the injection cap, select fewer World Info entries, or read fewer recent rounds per evolution.

---
name: repo-anthem
description: Writes and produces a short theme song and cover art for the repository you are in, using Pollinations music and image models through the polli CLI. Use when the user asks for a theme song, anthem, jingle, soundtrack or album cover for a project, a repo, a README or a launch.
license: MIT
compatibility: Requires the polli CLI (npm i -g @pollinations/cli), a signed-in polli (polli auth login) with Pollen to spend, and Node 18+.
allowed-tools: Bash(polli *) Bash(node *) Bash(git log *) Read Write
metadata:
  author: tomdacatto
  version: "1.0"
---

# Repo anthem

Make a 20 to 30 second theme song and a cover for the repository you are in. The song must come from what the repository really is, and the skill checks that.

## Steps

1. **Read the project.** Read `README.md` (first 80 lines), the manifest if there is one (`package.json`, `pyproject.toml`, `Cargo.toml`), and `git log --oneline -n 20`. Do not guess what the project is.
2. **Write `anthem/brief.md`** in exactly this shape:

   ```
   # <title of the anthem>
   mood: <two or three words>
   tempo: <number> bpm                       (music only)
   instruments: <comma separated>           (music only)
   words: <two to four short spoken lines>  (spoken version only)
   cover: <one sentence describing the picture>
   > "<exact words copied from a repository file>" (<that file's path>)
   > "<another exact quote>" (<path>)
   ```

   Give two to four quotes. Each is a reason for a choice: a line of the README that sets the mood, a line of a doc or source file that sets the pace. Quote files only, because the check reads the file named in the brackets. Copy the words character for character. Do not paraphrase.
3. **Make the sound.** Music models are paid-only, so pick the path from what the user can spend:
   - **Music** (the user has paid Pollen, check with `polli usage` and `polli models --type audio --json`): compose the prompt from the brief's mood, tempo and instruments, say it is instrumental, and run

     ```bash
     polli gen audio "<prompt>" --model elevenmusic --duration 30 --instrumental --output anthem/anthem.mp3
     ```

     Music is billed per second of output, so keep `--duration` at 30 or less unless the user asks for more.
   - **Spoken** (free, for accounts with only free Pollen, or when `polli` answers 402 or says the model needs paid Pollen): drop `tempo` and `instruments` from the brief, add the `words:` line (two to four short lines about the project that use its own words), and run

     ```bash
     polli gen audio "<the words>" --model openai/tts-1 --voice alloy --output anthem/anthem.mp3
     ```

     `openai/tts-1` is free for every account (`paid_only` is false on `/v1/models`). The check wants 10 seconds or more, so write at least four lines if the first reading is shorter.
4. **Make the cover.** Run:

   ```bash
   polli gen image "<cover line from the brief>, album cover, no text" --width 1024 --height 1024 --output anthem/cover.png
   ```
5. **Pack and check.** Run `node <this skill's folder>/scripts/pack.mjs anthem`. It fails with a reason if a quote is not in the file it names, if the mp3 or the picture is missing or not a real file (an image model may return a jpeg: the check renames `cover.png` to `cover.jpg` then), or if the song is shorter than 10 seconds or longer than 60. When it passes it writes `anthem/index.html`, one page with the cover, a player, the brief and the quotes.
6. **Report.** Tell the user the title, the real length printed by the check, the files, and what it cost (`polli usage` before and after).

## When something fails

- A quote that is not found: open the file, copy the real words and run the check again. Never edit the check.
- `polli` says the key is missing or out of Pollen: stop and tell the user to run `polli auth login` or top up. Do not retry in a loop.
- The model returned something that is not an mp3: say so, and do not pack it.
- Music needs paid Pollen and the user has none: use the spoken path, and say that is what you did.

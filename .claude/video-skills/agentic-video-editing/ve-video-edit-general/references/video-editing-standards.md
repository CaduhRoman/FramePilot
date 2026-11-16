# Video editing standards

Paid social (Meta, TikTok) performance creative. Read fully before cutting anything. This is the one rulebook for video edits: `/ve-video-edit-general` follows it while cutting, `/apply-notes` follows it for anything a note leaves open (and writes new general rules back into it), and `/video-qa` checks finished renders against it.

Where a rule has a number, the number is the default, not a suggestion. Your reviewer's feedback beats this document; log what changed in section 12.

These rules started as the house standards of a performance creative agency, built from review notes on real ad edits. Make them yours: change any rule your team disagrees with, and let `/apply-notes` add new ones as you review.

**Tags.** Every rule says who handles it:
- `cut`: do it while editing.
- `script`: checked by code (a number or an exact match). *Built* means a script enforces it today; `video-qa` re-checks the finished MP4 after every render.
- `eye`: checked by looking at frames or listening.

---

## 1. What a performance edit is for

An ad has one job per second. The first second earns the second, the first three seconds earn the next ten, and everything after that earns the click. Edit backwards from that:

- The hook (0 to 3s) stops the thumb. It is judged on hold rate.
- The body (3s to about 25s) builds belief. It is judged on 50% and 75% completion.
- The close (last few seconds) names the action. It is judged on click-through.

If a cut does not serve one of those three, it is decoration. Remove it.

## 2. Default style: organic

1. **Default to organic** unless the brief says produced: no background music, no end card, no transitions, whooshes or sound effects, no stock footage, a platform-native font (TikTok's text tool uses Proxima Nova; Instagram's uses SF; never a display font like Montserrat Black), and lowercase on-screen copy. `cut`
2. **Never mix organic and produced elements in one ad.** For example: organic text with polished branded before-and-afters, or a single lone greenscreen. `eye`

Sections 9 and 10 (music, end card) apply only when the brief asks for a produced ad.

3. **Style skills may override named defaults, never the safe zone or the hook overlay.** For example, an "ugly organic" style skill might turn captions off (overrides 7.6), keep pauses up to about 1.5s (overrides the 0.25s cap in section 4), use no grade and no punch-ins (overrides 5.6) and let length follow the content. A skill that does this says so at the top of its SKILL.md and lists the sections it overrides. `cut`

## 3. Hook text overlay (highest priority, every video)

1. **Every video gets a text overlay on the hook that is not the captions.** Captions alone on the hook are never acceptable. The overlay says something the voice isn't saying: the premise, the category, the tension or the POV. This is how organic ads are run now. `cut` · `script` (built: `validate_plan.py` requires a `"hook": true` callout on the first line)
2. **While the hook overlay is on screen, hide the captions.** Captions start when it leaves. Show one text element at a time: no headline plus captions plus badge. `cut` · `script` (built: `render.py` drops captions under a hook callout)
3. **Hook overlay wording is plain, specific and readable at a glance.** Break anything long onto two lines and make the key word biggest. Split a two-part headline into two bubbles (white-on-black, then black-on-white) so the second part pops. Never use internal abbreviations. `cut` · `eye`
4. **Decide the headline's duration per concept, and say which in the hand-off.** A POV or premise headline stays for the whole opener or the whole video; a plain hook headline comes off after the hook. `cut`
5. **The hook has to work muted** and be understood on first read. If the voice doesn't name the category in the first line, the overlay must. `eye`
6. **No logo, no brand name, no "hey guys" in the first three seconds.** `cut`
7. **A hook that is a claim beats a hook that is a question.** "This is why your skin still breaks out after a new routine" beats "Why does my skin keep breaking out?" `cut`

## 4. Pacing

- **Target length.** Talking-head UGC: 25 to 45 seconds. B-roll plus voiceover: 20 to 35 seconds. Anything over 60 seconds needs a reason written in the brief. `script` (built: `video-qa`)
- **Gap between sentences: about 0.15s.** Gap between clauses inside a sentence: about 0.10s. Longer reads as hesitation; shorter sounds like a glitch. `cut` · `script` (built: `build_vo.py` tightens and reports)
- **No pause longer than 0.25s anywhere in the voice track**, except one deliberate beat before the close, which may run to 0.4s. `script` (built: `build_vo.py` prints `LOOSE PAUSES`)
- **A visual change every 2 to 3 seconds** in the body: a cut, a punch-in, a b-roll insert, a caption appearing, or a callout. `cut`
- **Don't hold a shot too long: about 4s maximum**, shorter on low-motion b-roll, or return to the talking head. `cut` · `script` (built: `validate_plan.py` warns above 4s)
- **Front-load.** The strongest proof or most surprising claim goes before the 8-second mark. Most of the audience never sees the end. `cut`
- **Trim room tone off every piece.** About 0.04s lead-in before the first word and about 0.06s tail after the last. Clipping a word's tail ("use", "pool", "free") is the most common audible mistake; when in doubt leave 0.15s of tail. `cut`

## 5. Cutting and structure

1. **Cut filler and throat-clearing:** leading "basically", "like", "okay so", "well", "hey everyone", "yeah", "if you don't know me", "that's it". Keep one only if the join sounds worse without it. "And", "so", "but" and "then" at a sentence start are judged in context: keep them when they carry the story (a contrast, a consequence, the next step), cut them when they are just a verbal run-up and the line reads the same without them. `video-qa` does not flag these four, so the cut is the editor's call. `cut` · `script` (built: `video-qa` flags filler at sentence starts)
2. **Cut repetition:** any claim, adjective or beat said twice, including the same word stacked across joins. `cut` · `script` (built: `video-qa` flags doubled words and repeated phrases)
3. **Start later than the creator did.** The first few seconds of a take are usually warm-up, so open on the first line that carries the premise. `cut`
4. **When building hooks or hook variants, scan the whole take** for the strongest 3–4 seconds (a reaction, a line, a moment), not only the scripted hooks. A great moment buried at the end is wasted. `cut`
5. **Cut on silence, not on timecode.** Find the gap in the waveform and cut there. Transcript word timings are a guide, not a cut point; they drift on restarts and repeated words. `cut`
6. **Jump cuts are the default** for talking head. Each one gets an alternating punch-in (about 1.0x then about 1.12x) so the frame changes with the audio. `cut`
7. **Minimum shot length is 0.3s.** Fold anything shorter into its neighbour; slivers of 1 to 7 frames flash like errors. `script` (built: `render.py` folds them and lists `CHECK FLASH CUTS`)
8. **Take selection:** energy and clarity first, then eye line, then background. Never splice two takes mid-word. `cut`
9. **Remove stumbles, restarts and fillers, then listen to the splice on its own.** A repair that produces "now we, now we" or a half "and" is worse than the original stumble. Never clip the first or last word of a line. `cut` · `script` (built: `build_vo.py` re-transcribes and diffs against the script)
10. **Never cut away during the number.** If the creator says "47%" or "three weeks", the face or the proof stays on screen while they say it. `cut`

## 6. Footage and b-roll

1. **B-roll answers "show me".** Insert it when the voice makes a claim that can be seen: texture, before and after, mechanism, unboxing, size in hand. The footage must literally show what the line says. `cut` · `script` (built: `validate_plan.py` requires `illustrates` and `shows`)
2. **Use the best clip available, not the first one that fits.** Reject dark, blurry, crooked, over-exposed or dull clips. `eye`
3. **Flip mirrored footage.** Front-camera clips show text backwards on phones, boxes and bags, so check any clip containing text. `eye`
4. **Check the background and edges of every shot** for clutter and distractions (socks, studio lights, a TV, a shower caddy over the brand name). Crop, reframe or swap. `eye`
5. **The person on screen matches the persona in the script** (age, gender, situation). Keep the same creator on "I" lines. `eye`
6. **Order of preference:** product in use by the creator > product in use by anyone > product close-up > lifestyle context > screen recording. No stock in organic ads (section 2). `cut`
7. **Ratio and holds.** Talking-head body: 30 to 50% b-roll coverage. B-roll holds 1.5 to 3 seconds. `cut`
8. **Cut b-roll on motion.** Enter a clip while something is moving (a pour, a hand reaching). Entering on a still frame looks like a slideshow. `cut`
9. **Picture-in-picture** is for keeping the creator visible while a demo plays: rounded corners, bottom-left or bottom-right, never covering a caption. `cut`
10. **Verify in-points at quarter-second resolution.** Contact sheets at two-second steps misplace shot changes by about a second. `cut`
11. **B-roll enters between lines, not mid-sentence.** Start an insert on the line's first word (or in the gap before it); switching halfway through a sentence feels like a harsh cut. Exceptions are fine when they're deliberate, e.g. a list where each item gets its own shot, or the product shown as it's named. When a line is meant to be covered, cover it from its start so the A-roll isn't seen for it. Don't leave a flash of A-roll (under about 0.5s) between two inserts; it reads as a glitch. `cut`
12. **Don't reuse a clip, or a near-identical one, in the same ad.** Two takes of the same prop in the same style (e.g. two handheld shots of the same old product) count as the same clip. If nothing else fits, stay on the creator. `cut` · `eye`

## 7. Captions

1. **Captions match the spoken words exactly.** After rendering, check the caption words against a transcription of the final audio, separately from the voice-track check. Catch ghost words that survive a cut and doubled words ("every every"). `script` (built: `video-qa` compares captions with a transcript of the final audio)
2. **Brand, product and URL names always appear in their exact house form, every time.** Run a find-and-replace from the brand's name list in `brand-house-style.md` before export (`fix_words` in the plan). `script` (built: `fix_words` while cutting; `video-qa` checks every caption and overlay against the list)
3. **Spelling follows the brand's market (US or UK), not the creator's accent.** The market is in `brand-house-style.md`. `script` (built: `video-qa`)
4. **House style for numbers and units:** digits with units (45 lbs, 100+, 12 MINUTES, 500 LEDs) and $ on dollar amounts; hyphenated compound modifiers (2-in-1, 90-day money-back guarantee, follow-up, walk-in); "drugstore" as one word. `script` (built: `video-qa`)
5. **Casing follows the sentence, not the cut.** A caption that continues a sentence starts lowercase; a new sentence after a cut starts with a capital. Organic ads lean lowercase. **Default is sentence case, not ALL CAPS.** `script` (built: `render.py` `caption_case`, default `sentence`)
6. **Captions on every spoken word after the hook overlay leaves,** in sync, 1 to 3 words per chunk, one fixed position (around y 1200), single line for organic talking head. Active-word highlight in one accent colour. No emoji in captions. `cut`
7. **Don't switch caption colour mid-video** without a reason (e.g. a second speaker, applied throughout). `eye`

## 8. On-screen text

1. **All text and graphics stay inside the Meta safe zone.** At 1080x1920: x 65 to 1015, y 270 to 1248. Top 14% and bottom 35% are covered by platform UI. This covers headlines, comment boxes, arrows and pop-ups, not only captions. When a 4:5 export is expected, check it inside the 4:5 frame as well. `script` (built: `render.py` refuses to export; `video-qa` checks every caption, overlay and end-card line on the MP4, and the 4:5 crop with `--four-five`)
2. **Text legibility:** add a background box, shadow or border when text sits on busy footage. Never let the text colour disappear against the background. Keep text size consistent across the video and its variations. `eye`
3. **On-screen lists are complete and consistent.** "3 signs" means three are shown. No "#1" without a "#2". Same number format on every item. If the voice says "first, second", the screen matches, or neither does. `eye`
4. **Callouts** sit at y 300 or lower, wrap at 160px side margins (break lines over about 26 characters), and stay up for the full duration of the claim they support. `script` (built: `validate_plan.py` warns on long lines)
5. **Numbers on screen match the voice and the brief.** If the script says 30 days and the creator says a month, the screen says a month and the brief gets flagged. `eye`
6. **Font sizing at 1080 width:** captions 56 to 64px, hook overlay 72 to 96px, callouts 48 to 56px. `cut`

## 9. Audio

- **Voice is the priority.** Normalise dialogue to about -16 LUFS integrated, peaks under -1 dBTP. Both channels, every variation at the same level. `script` (built: `video-qa`)
- **Organic: no music, no sound effects** (section 2).
- **Produced only:** a music bed at -22 to -26 LUFS under the voice, sidechain-ducked; the track's drop lands on the end card, not mid-sentence. Sound effects land on the word or not at all. `cut`

## 10. End card and CTA

- **Organic: no end card.** End on the last spoken line, holding about half a second on the final shot. `cut`
- **Produced only, when the brief asks:** 3 to 5 seconds, product shot, one-line offer, one-line CTA ("Shop the bundle, 30% off this week", not "Learn more"), inside the safe zone. The voice carries over it. `cut`

## 11. Variations, delivery and QC

1. **Every concept ships with four hooks:** A is the scripted one; B, C and D are variations with different opening visuals (Meta groups visually similar ads under one Entity ID). **Build variation A first and only A:** v1 of A goes to review, notes are applied to A alone, and B, C and D are built from the approved A cut once A is approved, differing from it only in the hook. Never revise several variations in parallel before A is approved. `cut`
2. **A fix on one variation is applied to every variation.** The hand-off includes a per-variation checklist confirming each requested change on A, B, C and so on. `cut`
3. **Flag any competitor branding visible in the footage** (logos, labels, shop signs, clothing). Don't use the clip, or blur the branding. `eye`
4. **Formats:** 9:16 at 1080x1920, 30fps, H.264 about 12 Mbps, AAC 192kbps; 4:5 at 1080x1350 when asked. Name files `<CODE>_Hook<X>_v<N>.mp4`, e.g. `ACM08_HookB_v3.mp4` (or your own ad naming convention).
5. **Every delivery includes** the hook cuts, the gap report on the voice track, the safe-zone result, a frame-by-frame look at any shot under 0.4s, the headline-duration choice (3.4) and the per-variation checklist (11.2).

**Review checklist before anything ships**

1. Watch it muted. Does the hook overlay stop you, and does the story still make sense?
2. Listen with eyes closed. Any stumble, filler, repetition, clipped word or gap over 0.25s?
3. Captions: exact words, house brand names, market spelling, number style, sentence casing, hidden under the hook overlay.
4. Scrub for slivers and zoom flicker. Any shot under 0.3s, or over 4s?
5. Every clip: relevant, best available, not mirrored, clean background, persona matches, no competitor branding.
6. Text bounds inside the safe zone (and the 4:5 frame if delivering 4:5); one text element at a time.
7. Organic stayed organic: no music, end card, transitions, SFX or stock.
8. Every requested fix is on every variation.

## 12. Revision log

Feedback from your reviewer beats this document. When a reviewer says "too loose" or "too fast", the fix is in section 4; "glitchy", section 5; "boring", section 6; "too much text", section 8. Log here what changed and why, so the next edit starts from the corrected default. `/apply-notes` adds an entry whenever a review note turns into a general rule.

- 2026-10-13: Published. Starting point: organic by default, a mandatory hook overlay with captions hidden under it, sentence-case captions, 0.15s / 0.10s pause targets, 0.3s minimum shot, 4s maximum hold, Meta safe zone, variation A first.

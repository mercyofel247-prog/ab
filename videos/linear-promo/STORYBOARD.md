---
format: 1920x1080
duration: 45s
message: "Linear replaces slow, scattered issue tracking with one fast, focused tool built for software teams."
arc: PAS (compressed) — hook/pain → product intro (solution) → 2× feature-benefit → CTA
audience: software teams and PMs evaluating project-management tools
mode: collaborative
music: subtle confident electronic underscore, minimal/tech, mixed low (~-18dB under narration — never competes with the VO)
---

## Video direction

- **Palette system** (from `frame.md`, hand-corrected for the dark brand — see file header note): canvas `#08090A` on every frame's full-bleed background clip; ink `#F7F8F8` for all headline/label text; the single accent `#5E6AD2` carries every focal moment (cursor, status pill, progress ring, chart line, CTA pill) — never a second brand color. Tinted violet cards (`rgba(94,106,210,0.08)` fill / `rgba(94,106,210,0.28)` border) are the only "surface" treatment; no drop shadows anywhere (the preset's no-shadow discipline holds).
- **Motion grammar + reveal model**: long-tail `power3`-style eases throughout (smooth, never bouncy, except the CTA pill's one intentional spring-settle). Every frame reveals its pieces on the spoken cue named in its Scene sequence below — nothing sits fully assembled before the VO reaches it. During any hold, at most a very subtle breathing/drift (per `sine-wave-loop`, low-amplitude) keeps the frame alive — no idle wobble beyond that.
- **Duration note**: real Kokoro narration totals ~32s across the 5 lines; each frame's synced duration was deliberately padded 1.5–3s beyond its exact voice length (Frame 1 +2.0s, Frame 2 +2.0s, Frame 3 +1.5s, Frame 4 +1.5s, Frame 5 +3.0s) as an allocated post-VO hold — never a mid-speech stretch — landing the cut at ~42s against the 45s brief. Each Scene sequence below plants its final "hold" phase inside that padded tail.
- **On-screen captions**: the root karaoke caption track is skipped for this project (Kokoro's local model returns no word-level timestamps, so `captions.mjs` has nothing to sync to — a legal, explicit skip, not an error). To still satisfy the brief's "one-line captions" on the 3 feature beats, each of Frames 2–4 authors its own short, static one-line label (NOT a repeat of the VO sentence — a compressed title, per the frame-worker's "short motion-graphics copy" allowance) docked in the reserved caption band (bottom ~17%, `y ≥ 906px`). Frame 1 and 5 don't need one — Frame 1 is wordless-on-purpose (pure clutter/VO), Frame 5's own CTA text already serves that role.
- **Rhythm / held-frame allocation**: every frame ends on a deliberate hold (the padded tail above) — none is a held BREATHER frame in the sense of "less busy than its neighbors" (all 5 have real content development), so energy stays roughly level across the piece, which fits "energetic but minimal." Frame 5 holds longest (~3s) as the calm closing beat.
- **Negative list**: no nav bars / browser chrome / real OS cursors (only the stylized brand-violet cursor dot); no floating bokeh or generic "AI" gradients; no second accent color anywhere; no front-loaded-then-frozen frames (every frame's content arrives across its duration, paced in the Scene sequences below); no screensaver-style independently-floating elements — every moving piece is caused by either the cursor, a data reveal, or the frame's one camera move.

## Frame 1 — The pain of scattered tools

- scene: A cluttered wall of sticky notes, spreadsheet cells, and mismatched tool windows crowd in on the frame
- voiceover: "Sticky notes on the monitor. A spreadsheet nobody fully trusts. Six different tools — and somehow, none of them talk to each other."
- duration: 9.744s
- transition_in: cut
- status: built
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Pain agitation
- beat: overwhelm
- blueprint: overwhelm-surround (Adapt)
- focal: the center "SIX TOOLS THAT DON'T TALK" card — the pain statement itself, not any single tool
- roles: sticky-note / spreadsheet / tool-A / tool-B blocks = density markers (cutout); center pain-card = focal; dark canvas = background
- sfx: none
- asset_candidates:

Adapt: keep the signature close-in-from-all-sides crowd move; drop the avatar morph (no personification needed for a B2B pain beat) and drop the written "question" text (this beat's payoff is entirely spoken, not typed).

Scene 1 (0.0–2.0s): as the VO says "Sticky notes on the monitor," the STICKY NOTES card staggers/scales in top-left, low-amplitude float. Rule-of-thirds, background dark and otherwise empty.
Scene 2 (2.0–4.2s): as the VO says "a spreadsheet nobody fully trusts," the SPREADSHEET card scales in top-right (mirrored float). Two density markers now visible, asymmetric composition.
Scene 3 (4.2–7.0s): as the VO lists "six different tools," TOOL A and TOOL B cards scale in lower-left/lower-right (staggered), each with its own low float — four markers now ring the center.
Scene 4 (7.0–9.744s): on "none of them talk to each other," the center pain-card scales in and the four markers drift inward slightly (radial close-in, camera static — the crowd surrounds, it never zooms) — hold on the crowded state through the padded tail into the cut.

narrativeRole: Opens on the viewer's actual daily frustration in outcome language, no product named yet — earns the right to the solution beat that follows.
keyMessage: Your current tools are the problem, and it's not your fault.

## Frame 2 — Linear, fast and focused

- scene: The clutter clears; one clean dark Issues list assembles under a cursor, an issue is triaged and moves state in one click
- voiceover: "This is Linear — fast, and built to stay out of your way. Every issue gets triaged and moving, so the busywork disappears."
- duration: 9.189s
- transition_in: zoom-through
- status: built
- src: compositions/frames/02-product-intro.html
- type: product_intro
- persuasion: Negative contrast
- beat: relief + clarity
- blueprint: cursor-ui-demo (Reproduce)
- focal: the "Cache invalidation on deploy" row transitioning Todo → Triaged
- roles: Issues panel = background surface; the 4 list rows = supporting; the transitioning row + cursor = cutout/focal
- sfx: none
- caption (one-line, docked bottom band): "One tool. Every issue."
- asset_candidates:

Reproduce (Product_Intro variant): the clutter from Frame 1 clears (crossmatched by the zoom-through transition) straight into the Issues panel — surface establishes, cursor enters, first light touch, settle on the payoff row.

Scene 1 (0.0–1.5s): the wordmark and the Issues panel scale/fade in together (frame.md's card-tinted treatment) as the VO says "This is Linear" — panel arrives centered, no rows populated yet.
Scene 2 (1.5–3.5s): as the VO continues "fast, and built to stay out of your way," the 4 issue rows waterfall in top-to-bottom, each with its Todo/In Progress pill.
Scene 3 (3.5–6.0s): the cursor enters from off-frame and glides to the "Cache invalidation on deploy" row as the VO says "every issue gets triaged and moving" — on arrival the row's pill flips Todo→Triaged with a small spring-pop, row background brightens slightly (the one accent moment).
Scene 4 (6.0–9.189s): hold on the triaged row + resting cursor as the VO finishes "so the busywork disappears"; the one-line caption fades in bottom-band on this same beat. Static camera, subtle row-glow breathing through the padded tail.

narrativeRole: Lands the video's one value claim (message) by beat 2 — names the brand and resolves the hook's pain in the same breath. Everything after this is evidence.
keyMessage: One fast, focused tool replaces the six that don't talk to each other.

## Frame 3 — Plan the cycle

- scene: A cycle (sprint) board where an issue card is dragged into the active cycle; a small progress ring fills in response
- voiceover: "Plan the cycle in seconds. Drag an issue into place, and watch the whole sprint shift to match it."
- duration: 6.983s
- transition_in: push-slide LEFT
- status: built
- src: compositions/frames/03-feature-cycles.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: control
- blueprint: cursor-ui-demo (Reproduce)
- focal: the "Onboarding redirect fix" card mid-drag from Backlog into This Cycle
- roles: 3 board columns = background surface; the dragged card + cursor = focal/cutout; progress ring = supporting payoff
- sfx: none
- caption (one-line, docked bottom band): "Plan a cycle in seconds."
- asset_candidates:

Reproduce (Key_Feature variant): pushed in via push-slide LEFT from Frame 2. Cursor performs one concrete edit (drag), camera stays locked (the drag itself is the "chase"), lands on the outcome (ring).

Scene 1 (0.0–1.8s): the 3-column board is already present (push-slide carries it in); the cursor enters and grips the "Onboarding redirect fix" card in Backlog as the VO says "Plan the cycle in seconds" — card lifts slightly (cursor-drag start).
Scene 2 (1.8–4.2s): as the VO says "drag an issue into place," the cursor drags the ghosted card rightward from Backlog into This Cycle, other cards in that column making room (reflow); card drop-snaps into its new slot with a small spring-pop.
Scene 3 (4.2–6.983s): as the VO finishes "watch the whole sprint shift to match it," the progress ring lower-right sweeps from empty to partial fill in sync with the drop; hold on the settled board + filled ring through the padded tail; the one-line caption fades in bottom-band.

narrativeRole: First proof beat — a concrete workflow moment that makes "fast and focused" tangible.
keyMessage: Planning work is a drag-and-drop, not a meeting.

## Frame 4 — See where work stands

- scene: A minimal insights panel resolves — a velocity chart line draws itself and a status breakdown settles into place
- voiceover: "Zoom out, and see exactly where every project really stands — velocity, blockers, progress, all at a glance."
- duration: 8.327s
- transition_in: push-slide LEFT
- status: built
- src: compositions/frames/04-feature-insights.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: clarity
- blueprint: dataviz-countup (Adapt)
- focal: the velocity line chart drawing left→right
- roles: insights panel = background surface; velocity chart = focal; 3 status bars = supporting
- sfx: none
- caption (one-line, docked bottom band): "See where work stands."
- asset_candidates:

Adapt (single-instrument, not the multi-card push-through): keep the signature draw-then-glow-hero move, but ONE instrument only (no multi-card push-through — the frame is too short and the beat is calm, not a montage); no fabricated numbers anywhere (bars use relative widths only, chart has no axis labels).

Scene 1 (0.0–2.0s): the insights panel scales/fades in (frame.md card-tinted) as the VO says "Zoom out" — panel present, chart and bars not yet drawn. A very slow continuous zoom-in begins underneath (barely perceptible).
Scene 2 (2.0–4.5s): as the VO says "see exactly where every project really stands," the velocity line DRAWS left-to-right along its polyline path.
Scene 3 (4.5–6.5s): as the VO lists "velocity, blockers, progress," the 3 status bars fill in sequence (Done → In progress → Todo), each bar's accent fill growing left-to-right.
Scene 4 (6.5–8.327s): on "all at a glance," a soft accent glow blooms behind the panel; camera settles; hold through the padded tail; the one-line caption fades in bottom-band.

narrativeRole: Second proof beat — breadth of value (visibility, not just speed) before the close.
keyMessage: No more guessing where a project really stands.

## Frame 5 — Try it free

- scene: The UI clears to a calm, centered end card: the Linear wordmark, then "Try it free" as a solid pill CTA
- voiceover: "Try it free. No credit card, no setup call — just Linear, ready when you are."
- duration: 7.843s
- transition_in: crossfade
- status: built
- src: compositions/frames/05-cta.html
- type: cta
- persuasion: Risk reversal
- beat: confidence
- blueprint: titlecard-reveal (Reproduce)
- focal: the "Try it free" solid pill
- roles: wordmark card = card 1 (focal); CTA pill + url card = card 2 (focal); dark canvas = background
- sfx: none
- asset_candidates:

Reproduce (CTA card-chain variant): two-card chain, instant hard cut between them (no crossfade), terminating on the held lockup — this is the final frame, so (uniquely in this video) it's allowed a real settle/exit-free hold to the last authored frame.

Scene 1 (0.0–2.2s): Card 1 — the Linear wordmark spring-pops into center as the VO says "Try it free," slight overshoot then settle. Holds alone, nothing else on screen.
Scene 2 (2.2s, hard cut): Card 2 — instant cut (full opacity, no fade) to the wordmark now docked smaller above, with the "Try it free" pill spring-settling into center as the VO continues "no credit card, no setup call."
Scene 3 (2.2–4.8s): the "linear.app" url line fades up beneath the pill as the VO finishes "just Linear, ready when you are."
Scene 4 (4.8–7.843s): full lockup (wordmark + pill + url) holds static to the end — at most a barely-perceptible slow scale-up across the hold; this is the video's last frame, full opacity throughout, no fade to black.

narrativeRole: Closes on the single action, reversing any remaining risk ("free", "no credit card") — calm, not hyped.
keyMessage: Nothing to lose — try it now.

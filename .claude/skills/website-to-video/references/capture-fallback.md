# When `hyperframes capture` is blocked or unavailable

Sandboxed sessions commonly block outbound access to arbitrary third-party
domains at the network egress policy level (this is a deliberate
organizational restriction, not a bug) — `hyperframes capture` will fail
with something like `net::ERR_TUNNEL_CONNECTION_FAILED` or an
`EGRESS_BLOCKED` error. Check `curl -sS
http://127.0.0.1:<proxy-port>/__agentproxy/status` (port from the
`HTTPS_PROXY` env var) if you want to confirm — `recentRelayFailures` will
show `connect_rejected` for the target host if it's a policy block.

**This is not fixable by retrying, using a different tool, or a different
capture method that also opens a network connection** — `WebFetch` hits the
identical block for the identical reason, since it's the same underlying
domain-level policy. Don't loop through multiple automated fetch attempts
hoping one works; check once, understand which failure mode it is, and move
to the appropriate fallback below.

## Fallback 1: WebFetch for copy only

Even when full visual capture is blocked, `WebFetch` sometimes succeeds
where a browser-based capture doesn't (different fetch path) — worth trying
once for the actual headline/subheadline copy, benefit descriptions, and CTA
text, even if you can't get a screenshot or exact colors from it. If it also
fails with the same egress error, don't retry it either — move to fallback 2.

## Fallback 2: User-supplied screenshots

Ask for 2-4 screenshots: the hero/above-the-fold section, one feature or
benefit section, and the pricing/CTA area. Read them directly (the model can
see images) and extract:

- **Background color(s)**: sample what you see — is it a flat color, a
  subtle gradient, dark or light? Describe the actual hex-ish tone (e.g.
  "near-black with a very faint warm undertone, roughly #0a0a0c" is a
  legitimate read from a screenshot, not a guess — you're reading the
  pixels, not inventing them).
- **Accent/brand color**: usually the button/CTA color and/or a highlight
  used on key headlines — this is almost always the single most important
  color to get right, since it's what makes the video unmistakably *that*
  brand's.
- **Text colors**: heading vs. body, and whether there's a secondary/muted
  tone for taglines or fine print.
- **Typography**: match the letterforms against known typeface families if
  you can (a geometric sans like Inter/Söhne/Suisse reads differently from a
  humanist sans like Circular/Graphik, which reads differently from a serif
  or a monospace-leaning technical face) — note weight (the site's heading
  weight is rarely the same as its body weight) and whether tracking
  (letter-spacing) reads tight/normal/wide.
- **UI density and shape language**: corner radius on buttons/cards (sharp
  vs. rounded vs. pill), whether shadows are present and how soft/hard,
  whether the layout breathes (generous whitespace) or is dense
  (dashboard-like).
- **Exact copy**: transcribe headlines/benefit text verbatim from what's
  visible in the screenshot — don't paraphrase.

## Fallback 3: user-provided brand description

If there are no screenshots either, ask the user to describe the site in
their own words (or paste the copy) rather than guessing. A short
description ("dark background, electric blue accent, geometric sans-serif,
feels technical/precise not playful") is still real signal to build from —
very different from silently substituting a generic placeholder palette.

## If none of the above is available

Stop and ask the user directly how they want to proceed — don't silently
fall through to invented/placeholder branding while still claiming to
capture "the real site." If the user explicitly says to proceed with a
placeholder look, that's fine — just say plainly in the summary that the
final video's branding is a placeholder, not the site's actual design, so
they know to re-skin it once real assets are available.

## Always disclose which path was used

Whichever of the above actually produced the design system you built from,
say so plainly to the user before or alongside presenting any video preview
— "capture was blocked by network policy, so this is built from the
screenshots you sent" vs. "this is the site's actual captured palette/type"
are very different claims, and the user needs to know which one they're
looking at.

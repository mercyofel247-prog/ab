# Asset inventory — no-capture path

No real assets were captured. `linear.app` is blocked by this sandbox's
network egress policy (confirmed via both `hyperframes capture` — 403 policy
denial at the proxy — and `WebFetch` — `EGRESS_BLOCKED`). The user was told
capture failed and explicitly chose to proceed from general public knowledge
of the brand rather than upload real screenshots or widen network access.

Consequence: the three feature-beat "UI captures" in this video will be
**stylized recreations** built in HTML/CSS from the brand tokens in
`tokens.json` (dark canvas, violet accent, Inter type) — not pixel-exact
screenshots of the real product. The end-card mark is a clean wordmark
("Linear" set in the brand accent) rather than a traced reproduction of the
official logomark, since the exact vector geometry isn't available without
capture.

No files exist in `capture/assets/` as a result.

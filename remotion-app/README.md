# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Commands

**Install Dependencies**

```console
npm i
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Compositions

### `MetalNumeral` — Route B valuation-beat hero

`src/MetalNumeral.tsx` exports a parametric `<MetalNumeral value label />` — a
machined, brushed dark-metal numeral on near-black in the Track-2 oxblood look
(dimensional lit editorial: single studio key, extruded metal thickness, soft
contact shadow, bone specular, layered parallax depth planes). It is **reusable
across every valuation beat** — the value and label are pure props.

- Canvas 1920×1080 @30fps, 3s (90 frames), strict 16:9, silent.
- `spring({ config: { damping: 200 } })` drives `cameraX`; depth planes read it
  at different parallax rates so the frame settles with dimensional depth.
- Rim glow (the sole oxblood accent, emissive edge only) pulses via
  `interpolate(frame, [0, 20, 50], [0, 1, 0])`.
- No grain / vignette / chromatic aberration is baked — the shared master grade
  LUT is applied later in DaVinci.

Reuse on another beat by overriding the props, e.g.:

```tsx
<MetalNumeral value="$12.0B" label="TOTAL VALUATION" />
```

Render (silent MP4):

```console
npx remotion render MetalNumeral out/metal-numeral.mp4 --muted
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).

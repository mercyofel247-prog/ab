#!/usr/bin/env python3
"""Deterministic driving-electronic bed for the HyperFrames promo.
Synthesized locally (the HeyGen catalog CLI is unreachable in this environment).
Four-on-the-floor kick + 8th-note sub bass + offbeat hats + a filtered pad that
opens as the track builds. 124 BPM so the beat grid is clean for `hyperframes beats`."""
import numpy as np, soundfile as sf, sys

SR = 44100
BPM = 124.0
BEAT = 60.0 / BPM          # 0.4839s
DUR = 61.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(42)

def env(times, atk, dec):
    """exp decay envelope retriggered at each event time"""
    e = np.zeros(N)
    for tt in times:
        i0 = int(tt * SR)
        if i0 >= N: continue
        L = int(dec * SR)
        idx = np.arange(min(L, N - i0))
        seg = np.exp(-idx / (atk * SR))
        e[i0:i0 + len(idx)] = np.maximum(e[i0:i0 + len(idx)], seg)
    return e

beats = np.arange(0, DUR, BEAT)
eighths = np.arange(0, DUR, BEAT / 2)
offbeats = np.arange(BEAT / 2, DUR, BEAT)

# --- kick: pitch-dropping sine thump on every beat ---
kick = np.zeros(N)
for tb in beats:
    i0 = int(tb * SR)
    if i0 >= N: continue
    L = int(0.32 * SR)
    idx = np.arange(min(L, N - i0))
    lt = idx / SR
    pitch = 120 * np.exp(-lt * 26) + 46
    body = np.sin(2 * np.pi * pitch * lt) * np.exp(-lt * 10)
    click = np.exp(-lt * 320) * 0.6
    kick[i0:i0 + len(idx)] += (body + click)

# --- sub bass: 8th-note root with a 2-bar note movement ---
notes = [55.00, 55.00, 61.74, 51.91]  # A1 A1 B1 G#1 (per bar)
bass = np.zeros(N)
be = env(eighths, 0.09, 0.24)
barlen = BEAT * 4
freqs = np.zeros(N)
for i, tt in enumerate(t):
    bar = int(tt / barlen) % len(notes)
    freqs[i] = notes[bar]
phase = 2 * np.pi * np.cumsum(freqs) / SR
bass = (np.sign(np.sin(phase)) * 0.35 + np.sin(phase) * 0.65) * be * 0.5

# --- hats: filtered noise on offbeats, brighter after the build ---
hn = rng.standard_normal(N)
# simple 1-pole high-pass
hp = np.copy(hn)
a = 0.92
hp[1:] = hn[1:] - hn[:-1] + a * hp[:-1]
he = env(offbeats, 0.006, 0.06)
hats = hp * he * 0.22

# --- pad: two detuned saws through an opening low-pass (the "build") ---
def saw(f):
    ph = (f * t) % 1.0
    return 2 * ph - 1
pad_raw = (saw(110) + saw(110 * 1.006) + saw(164.81)) / 3.0
# opening filter: lerp cutoff via a moving average whose window shrinks
build = np.clip((t - 6) / 40.0, 0.05, 1.0)
# cheap tone-open: mix dark (heavy smoothing) -> bright (raw)
k = 200
kernel = np.ones(k) / k
dark = np.convolve(pad_raw, kernel, mode="same")
pad = (dark * (1 - build) + pad_raw * build) * 0.10

# --- arrange: intro (kick+bass), full at 45s region gets hats emphasis ---
gate_hats = np.clip((t - 10) / 4.0, 0.0, 1.0)
# lift energy through the Rhythm region (45-52s)
rhythm_lift = 1.0 + 0.5 * np.clip((t - 44) / 2.0, 0, 1) * np.clip((52 - t) / 2.0, 0, 1)

mix = kick * 0.95 + bass * 0.9 + hats * gate_hats * rhythm_lift + pad * 0.9

# fade in/out
fi = int(1.0 * SR); fo = int(2.5 * SR)
mix[:fi] *= np.linspace(0, 1, fi)
mix[-fo:] *= np.linspace(1, 0, fo)

# soft limit / normalize to ~-1 dBFS peak
mix = np.tanh(mix * 1.1)
peak = np.max(np.abs(mix)) or 1.0
mix = mix / peak * 0.89

sf.write("assets/audio/bgm.wav", mix.astype(np.float32), SR)
print(f"wrote assets/audio/bgm.wav  {DUR:.1f}s  {BPM:.0f}bpm  beat={BEAT:.4f}s")

#!/usr/bin/env python3
"""Generate a 25s / 120 BPM placeholder music bed for the kinetic intro.

Swap public/music.mp3 for the real bed later; this exists so the
composition renders with an audible downbeat to check sync against.
"""
import os
import wave

import numpy as np

SR = 44100
BPM = 120.0
BEAT = 60.0 / BPM
DUR = 25.0
N = int(DUR * SR)
rng = np.random.default_rng(3)

drums = np.zeros(N)
bass = np.zeros(N)
pad = np.zeros(N)


def place(buf, t0, sig):
    s = int(t0 * SR)
    e = min(s + len(sig), len(buf))
    if s < len(buf):
        buf[s:e] += sig[: e - s]


def kick():
    n = int(0.4 * SR)
    tt = np.arange(n) / SR
    f = 120 * np.exp(-tt / 0.03) + 46
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.13)
    click = np.sin(2 * np.pi * 1500 * tt) * np.exp(-tt / 0.004) * 0.5
    return body + click


def hat():
    n = int(0.05 * SR)
    tt = np.arange(n) / SR
    return np.diff(rng.standard_normal(n), prepend=0) * np.exp(-tt / 0.015) * 0.4


def note(freq, length):
    n = int(length * SR)
    tt = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * tt) + 0.4 * np.sin(2 * np.pi * 2 * freq * tt)
    return sig * np.exp(-tt / (length * 0.5))


# A minor vamp, one chord root per bar.
roots = [55.0, 43.65, 65.41, 49.0]  # A F C G
beats = int(DUR / BEAT)
for b in range(beats):
    t0 = b * BEAT
    place(drums, t0, kick())
    place(drums, t0 + BEAT * 0.5, hat())
    root = roots[(b // 4) % 4]
    place(bass, t0, note(root, BEAT * 0.9) * 0.8)
    if b % 4 == 0:
        for mult in (2, 2.5, 3):  # simple triad-ish pad
            place(pad, t0, note(root * mult, BEAT * 4) * 0.25)

mix = drums + 0.8 * bass + 0.5 * pad
mix = np.tanh(mix * 0.8)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.9
fi, fo = int(0.05 * SR), int(0.5 * SR)
mix[:fi] *= np.linspace(0, 1, fi)
mix[-fo:] *= np.linspace(1, 0, fo)

stereo = np.stack([mix, mix], axis=1)
pcm = (stereo * 32767).astype(np.int16)

out = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "remotion-app", "public", "music.wav")
)
with wave.open(out, "w") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out)

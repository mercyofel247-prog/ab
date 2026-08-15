#!/usr/bin/env python3
"""Deterministic melodic score for SPECTRA (30.0s, 44.1k stereo).

A warm D-major arrangement: strings pad, sub bass, a music-box/piano lead
melody, arpeggios, gentle percussion, shimmer, reverb, resolving to D major.
Regenerate:  python3 tools/synth-bgm.py assets/bgm.wav
"""
import numpy as np, wave, sys

SR = 44100
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(23)
Lb = np.zeros(N)
Rb = np.zeros(N)

# ---- note name -> frequency (equal temperament, A4=440) ----
_STEP = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
def nf(name):
    i = 1
    acc = 0
    while i < len(name) and name[i] in "#b":
        acc += 1 if name[i] == "#" else -1
        i += 1
    semis = _STEP[name[0]] + acc
    octave = int(name[i:])
    semis += (octave - 4) * 12
    return 440.0 * (2 ** (semis / 12.0))


def pan_gains(pan):
    a = (pan + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def osc(ph, kind):
    if kind == "sine": return np.sin(ph)
    if kind == "tri":  return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == "saw":
        s = np.zeros_like(ph)
        for k in range(1, 10):
            s += ((-1) ** (k + 1)) / k * np.sin(k * ph)
        return 0.5 * s
    return np.sin(ph)


def add(freq, start, length, amp, kind="sine", pan=0.0, attack=0.05, release=0.4, vib=0.0):
    i0 = int(start * SR); i1 = min(int((start + length + release) * SR), N)
    if i0 >= N or i1 <= i0: return
    idx = np.arange(i0, i1); lt = (idx - i0) / SR
    env = np.ones(len(idx))
    am = lt < attack; env[am] = (lt[am] / attack) ** 1.4
    rm = lt >= length; env[rm] = np.exp(-(lt[rm] - length) / (release / 3 + 1e-9))
    env[lt > length + release] = 0.0
    ph = 2 * np.pi * freq * lt
    if vib: ph += vib * np.sin(2 * np.pi * 5.2 * lt)
    sig = osc(ph, kind) * env * amp
    gl, gr = pan_gains(pan)
    Lb[i0:i1] += sig * gl; Rb[i0:i1] += sig * gr


def pluck(freq, start, amp, dur=1.2, pan=0.0):
    """Struck music-box / piano tone: fast attack, exp decay, few partials."""
    i0 = int(start * SR); i1 = min(int((start + dur) * SR), N)
    if i0 >= N or i1 <= i0: return
    lt = (np.arange(i0, i1) - i0) / SR
    sig = np.zeros(len(lt))
    for k, (mul, a, dec) in enumerate([(1.0, 1.0, 0.9), (2.0, 0.4, 0.6), (3.01, 0.18, 0.4), (4.02, 0.08, 0.3)]):
        sig += a * np.sin(2 * np.pi * freq * mul * lt) * np.exp(-lt / dec)
    atk = np.clip(lt / 0.006, 0, 1)
    sig *= atk * amp
    gl, gr = pan_gains(pan)
    Lb[i0:i1] += sig * gl; Rb[i0:i1] += sig * gr


# ---- chord progression: Bm G D A loop, 3s/chord, resolving to D ----
prog = [
    (0.0, "Bm", ["B2", "F#3", "B3", "D4"], "B1"),
    (3.0, "G",  ["G2", "D3", "G3", "B3"], "G1"),
    (6.0, "D",  ["D3", "A3", "D4", "F#4"], "D2"),
    (9.0, "A",  ["A2", "E3", "A3", "C#4"], "A1"),
    (12.0, "Bm", ["B2", "F#3", "B3", "D4"], "B1"),
    (15.0, "G",  ["G2", "D3", "G3", "B3"], "G1"),
    (18.0, "D",  ["D3", "A3", "D4", "F#4"], "D2"),
    (21.0, "A",  ["A2", "E3", "A3", "C#4"], "A1"),
    (24.0, "G",  ["G2", "D3", "G3", "B3"], "G1"),
    (27.0, "D",  ["D3", "A3", "D4", "F#4"], "D2"),
]

# ---- strings pad (detuned saw stack) + sub bass ----
for start, name, voices, bassnote in prog:
    seglen = 3.2 if start < 27 else 3.0
    for vi, vn in enumerate(voices):
        f = nf(vn)
        pan = -0.42 + 0.84 * (vi / (len(voices) - 1))
        amp = 0.058 if vi else 0.072
        add(f * 0.996, start, seglen, amp, "saw", pan - 0.07, attack=0.7, release=1.5)
        add(f * 1.004, start, seglen, amp, "saw", pan + 0.07, attack=0.7, release=1.5)
    fb = nf(bassnote)
    add(fb, start, seglen, 0.26, "sine", 0.0, attack=0.32, release=1.0)
    add(fb * 2, start, seglen, 0.04, "tri", 0.0, attack=0.35, release=0.8)

# ---- LEAD melody (music-box), enters at movement B (~6s), climax at the end ----
melody = [
    (6.0, "F#5", 1.0), (7.0, "A5", 1.0), (8.0, "D6", 1.2),
    (9.0, "C#6", 1.0), (10.0, "A5", 0.8), (10.8, "E5", 1.2),
    (12.0, "D6", 1.0), (13.0, "B5", 1.0), (14.0, "F#5", 1.0),
    (15.0, "G5", 1.0), (16.0, "B5", 1.0), (17.0, "D6", 1.2),
    (18.0, "A5", 1.2), (19.2, "F#5", 0.8), (20.0, "D5", 1.0),
    (21.0, "E5", 1.0), (22.0, "C#6", 1.0), (23.0, "A5", 1.0),
    (24.0, "B5", 1.0), (25.0, "D6", 1.0), (26.0, "G6", 1.4),
    (27.0, "F#6", 1.4), (28.3, "D6", 1.7),
]
for i, (tt, nn, dur) in enumerate(melody):
    amp = 0.30 if tt < 24 else 0.38
    pan = -0.12 if i % 2 else 0.12
    pluck(nf(nn), tt, amp, dur=dur + 0.4, pan=pan)
    # soft harmony a third below on climax phrase
    if tt >= 24:
        harm = {"B5": "G5", "D6": "B5", "G6": "D6", "F#6": "D6"}.get(nn)
        if harm:
            pluck(nf(harm), tt, amp * 0.5, dur=dur + 0.4, pan=-pan)

# ---- arpeggio (movements C/D), 8th notes @ 80 bpm ----
eighth = 60.0 / 80 / 2
arp_by_start = {p[0]: p[3] and p[2] for p in prog}
seg_starts = [p[0] for p in prog]
def chord_at(t):
    s = max(x for x in seg_starts if x <= t + 1e-6)
    return dict((p[0], p[2]) for p in prog)[s]
t = 12.0; k = 0
while t < 26.5:
    notes = chord_at(t)
    # arpeggiate upper octave
    seq = [nf(notes[1]) * 2, nf(notes[2]) * 2, nf(notes[3]) * 2, nf(notes[2]) * 2]
    f = seq[k % len(seq)]
    amp = 0.05 if t < 18 else 0.062
    add(f, t, eighth * 0.9, amp, "tri", -0.5 + (k % 4) / 3.0, attack=0.004, release=0.3, vib=1.2)
    k += 1; t += eighth

# ---- gentle percussion: soft kick (movements C/D) + airy hat ----
beat = 60.0 / 80
t = 12.0
while t < 24.0:
    i0 = int(t * SR); i1 = min(int((t + 0.16) * SR), N)
    lt = (np.arange(i0, i1) - i0) / SR
    pitch = 95 * np.exp(-lt * 20) + 46
    kick = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-lt / 0.045) * 0.42
    Lb[i0:i1] += kick; Rb[i0:i1] += kick
    # offbeat hat
    ht = t + beat / 2
    j0 = int(ht * SR); j1 = min(int((ht + 0.05) * SR), N)
    hl = (np.arange(j0, j1) - j0) / SR
    hat = rng.standard_normal(len(hl)) * np.exp(-hl / 0.014) * 0.05
    Lb[j0:j1] += hat * 0.9; Rb[j0:j1] += hat
    t += beat

# ---- shimmer bells (movements A & E) ----
for w0, w1, amp in [(0.6, 6.0, 0.05), (24.5, 29.5, 0.06)]:
    tt = w0 + rng.uniform(0.2, 0.7)
    tones = [nf("D6"), nf("F#6"), nf("A6"), nf("D7")]
    while tt < w1:
        add(tones[rng.integers(0, 4)], tt, 0.02, rng.uniform(amp * 0.6, amp), "sine",
            rng.uniform(-0.8, 0.8), attack=0.004, release=1.4)
        tt += rng.uniform(0.6, 1.4)

# ---- riser into the finale (movement E) ----
r0, r1 = 22.4, 24.0
i0 = int(r0 * SR); i1 = int(r1 * SR)
lt = (np.arange(i0, i1) - i0) / SR
ramp = (lt / (r1 - r0)) ** 2.2
noise = rng.standard_normal(len(lt))
hp = np.concatenate([[0], np.diff(noise)])
Lb[i0:i1] += hp * ramp * 0.08; Rb[i0:i1] += hp * ramp * 0.075

# ---- macro dynamics ----
t = np.arange(N) / SR
macro = np.interp(
    t,
    [0.0, 1.6, 6.0, 12.0, 18.0, 24.0, 27.0, 28.5, 30.0],
    [0.0, 0.48, 0.66, 0.8, 0.82, 0.96, 1.0, 0.88, 0.0],
)
Lb *= macro; Rb *= macro

# ---- reverb (FFT convolution, decorrelated stereo) ----
def fftconv(a, b):
    Ln = len(a) + len(b) - 1
    Nf = 1 << int(np.ceil(np.log2(Ln)))
    return np.fft.irfft(np.fft.rfft(a, Nf) * np.fft.rfft(b, Nf), Nf)[:Ln]

ir_len = int(1.5 * SR)
decay = np.exp(-np.arange(ir_len) / (0.5 * SR))
irL = rng.standard_normal(ir_len) * decay; irL[0] = 1.0
irR = rng.standard_normal(ir_len) * decay; irR[0] = 1.0
wet = 0.24
Lb = Lb * (1 - wet) + fftconv(Lb, irL)[:N] * wet
Rb = Rb * (1 - wet) + fftconv(Rb, irR)[:N] * wet

# ---- soft-clip + normalize to -1.5 dBFS + edge fades ----
Lb = np.tanh(Lb * 1.15) / 1.15
Rb = np.tanh(Rb * 1.15) / 1.15
peak = max(np.max(np.abs(Lb)), np.max(np.abs(Rb)), 1e-9)
g = (10 ** (-1.5 / 20)) / peak
Lb *= g; Rb *= g
fi = int(0.35 * SR); fo = int(1.9 * SR)
Lb[:fi] *= np.linspace(0, 1, fi); Rb[:fi] *= np.linspace(0, 1, fi)
Lb[-fo:] *= np.linspace(1, 0, fo); Rb[-fo:] *= np.linspace(1, 0, fo)

# ---- write ----
inter = np.empty(N * 2, dtype=np.int16)
inter[0::2] = np.clip(Lb, -1, 1) * 32767
inter[1::2] = np.clip(Rb, -1, 1) * 32767
out = sys.argv[1] if len(sys.argv) > 1 else "bgm.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(inter.tobytes())
print("wrote", out, "peak", round(float(peak), 3), "len", round(N / SR, 3))

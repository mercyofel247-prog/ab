#!/usr/bin/env python3
"""Deterministic cinematic score for the AURORA sequence (30.0s, 44.1k stereo)."""
import numpy as np
import wave, struct, sys

SR = 44100
DUR = 30.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

Lb = np.zeros(N)
Rb = np.zeros(N)


def pan_gains(pan):  # equal-power pan, pan in [-1,1]
    a = (pan + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def osc(phase, kind):
    if kind == "sine":
        return np.sin(phase)
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(phase))
    if kind == "saw":  # richer, softened partial stack
        s = np.zeros_like(phase)
        for k in range(1, 9):
            s += ((-1) ** (k + 1)) / k * np.sin(k * phase)
        return 0.5 * s
    return np.sin(phase)


def add_note(freq, start, length, amp, kind="sine", pan=0.0,
             attack=0.05, release=0.4, vib=0.0):
    i0 = int(start * SR)
    i1 = min(int((start + length + release) * SR), N)
    if i0 >= N or i1 <= i0:
        return
    idx = np.arange(i0, i1)
    lt = (idx - i0) / SR
    env = np.ones(len(idx))
    am = lt < attack
    env[am] = (lt[am] / attack) ** 1.5
    rm = lt >= length
    env[rm] = np.exp(-(lt[rm] - length) / (release / 3.0 + 1e-9))
    env[lt > length + release] = 0.0
    ph = 2 * np.pi * freq * lt
    if vib:
        ph += vib * np.sin(2 * np.pi * 5.0 * lt)
    sig = osc(ph, kind) * env * amp
    gl, gr = pan_gains(pan)
    Lb[i0:i1] += sig * gl
    Rb[i0:i1] += sig * gr


# ---- chord progression: Am - F - C - G (7.5s each, overlapping) ----
segments = [
    (0.0, [110.0, 164.81, 220.0, 261.63, 329.63], 55.0),      # Am
    (7.5, [87.31, 130.81, 220.0, 261.63, 349.23], 87.31),     # F
    (15.0, [130.81, 196.0, 261.63, 329.63, 392.0], 65.41),    # C
    (22.5, [98.0, 146.83, 196.0, 246.94, 293.66], 98.0),      # G
]

# ---- PADS: detuned dual-osc per voice, slow attack, wide ----
for si, (start, voices, root) in enumerate(segments):
    seglen = 7.7 if si < 3 else 7.5
    for vi, f in enumerate(voices):
        pan = -0.4 + 0.8 * (vi / (len(voices) - 1))
        amp = 0.11 if vi == 0 else 0.085
        add_note(f * 0.997, start, seglen, amp, "saw", pan - 0.08, attack=0.9, release=1.8)
        add_note(f * 1.003, start, seglen, amp, "saw", pan + 0.08, attack=0.9, release=1.8)
    # sub bass
    add_note(root, start, seglen, 0.34, "sine", 0.0, attack=0.4, release=1.2)
    add_note(root * 2, start, seglen, 0.06, "tri", 0.0, attack=0.5, release=1.0)

# ---- ARPEGGIO: enters at scene B (6s), 8th notes @ 84 BPM ----
bpm = 84.0
eighth = 60.0 / bpm / 2.0
arp_chords = {
    0: [261.63, 329.63, 392.0, 523.25],
    7.5: [349.23, 440.0, 523.25, 698.46],
    15: [392.0, 523.25, 659.25, 783.99],
    22.5: [293.66, 392.0, 493.88, 587.33],
}
seg_starts = [0.0, 7.5, 15.0, 22.5]
arp_start, arp_end = 6.0, 27.0
k = 0
t_arp = arp_start
while t_arp < arp_end:
    seg = max(s for s in seg_starts if s <= t_arp + 1e-6)
    notes = arp_chords[seg if seg in arp_chords else 0]
    f = notes[k % len(notes)]
    # dynamic shaping across scenes
    if t_arp < 13:       amp = 0.05
    elif t_arp < 20.5:   amp = 0.075
    elif t_arp < 26:     amp = 0.055
    else:                amp = 0.04
    pan = -0.5 + (k % 4) / 3.0
    add_note(f, t_arp, eighth * 0.9, amp, "tri", pan, attack=0.004, release=0.35, vib=1.5)
    k += 1
    t_arp += eighth

# ---- SHIMMER BELLS: sparse seeded sparkles (scenes A & D) ----
bell_windows = [(0.6, 6.0), (20.2, 27.5)]
bell_tones = [1046.5, 1318.5, 1567.98, 2093.0]
for w0, w1 in bell_windows:
    tt = w0 + rng.uniform(0.2, 0.8)
    while tt < w1:
        f = bell_tones[rng.integers(0, len(bell_tones))]
        add_note(f, tt, 0.02, rng.uniform(0.03, 0.06), "sine",
                 rng.uniform(-0.8, 0.8), attack=0.004, release=1.4)
        tt += rng.uniform(0.7, 1.6)

# ---- PULSE: soft heartbeat kick under scene C (13 -> 20.5) ----
beat = 60.0 / bpm
tb = 13.0
while tb < 20.5:
    i0 = int(tb * SR); i1 = min(int((tb + 0.18) * SR), N)
    lt = (np.arange(i0, i1) - i0) / SR
    pitch = 90.0 * np.exp(-lt * 22) + 45.0
    ph = 2 * np.pi * np.cumsum(pitch) / SR
    env = np.exp(-lt / 0.05)
    thump = np.sin(ph) * env * 0.5
    Lb[i0:i1] += thump; Rb[i0:i1] += thump
    tb += beat

# ---- RISERS: noise sweeps into scene B (6.6) and scene E (26.5) ----
for downbeat in (6.6, 26.5):
    r0, r1 = downbeat - 1.7, downbeat
    i0 = int(r0 * SR); i1 = int(r1 * SR)
    seg = np.arange(i0, i1)
    lt = (seg - i0) / SR
    ramp = (lt / (r1 - r0)) ** 2.2
    noise = rng.standard_normal(len(seg))
    # simple one-pole highpass that opens up over time
    hp = np.copy(noise)
    hp[1:] = noise[1:] - noise[:-1]
    swell = hp * ramp * 0.09
    Lb[i0:i1] += swell; Rb[i0:i1] += swell * 0.9

# ---- macro dynamics: gentle scene swells + climax at lockup ----
macro = np.interp(
    t,
    [0.0, 1.5, 6.0, 13.0, 20.0, 24.0, 26.6, 28.0, 30.0],
    [0.0, 0.7, 0.85, 0.92, 0.86, 0.9, 1.0, 0.85, 0.0],
)
Lb *= macro
Rb *= macro

# ---- reverb: FFT convolution with a decaying stereo impulse ----
def fftconv(a, b):
    Ln = len(a) + len(b) - 1
    Nf = 1 << int(np.ceil(np.log2(Ln)))
    return np.fft.irfft(np.fft.rfft(a, Nf) * np.fft.rfft(b, Nf), Nf)[:Ln]

ir_len = int(1.3 * SR)
decay = np.exp(-np.arange(ir_len) / (0.42 * SR))
irL = rng.standard_normal(ir_len) * decay
irR = rng.standard_normal(ir_len) * decay
irL[0] = irR[0] = 1.0  # keep a dry spike so mix stays present
wetL = fftconv(Lb, irL)[:N]
wetR = fftconv(Rb, irR)[:N]
wet_mix = 0.22
Lb = Lb * (1 - wet_mix) + wetL * wet_mix
Rb = Rb * (1 - wet_mix) + wetR * wet_mix

# ---- soft-clip + normalize to -1.5 dBFS ----
def softclip(x):
    return np.tanh(x * 1.2) / 1.2

Lb = softclip(Lb); Rb = softclip(Rb)
peak = max(np.max(np.abs(Lb)), np.max(np.abs(Rb)), 1e-9)
target = 10 ** (-1.5 / 20)
Lb *= target / peak; Rb *= target / peak

# hard master fade to guarantee silence at the edges
fade_in = int(0.4 * SR)
fade_out = int(1.8 * SR)
Lb[:fade_in] *= np.linspace(0, 1, fade_in)
Rb[:fade_in] *= np.linspace(0, 1, fade_in)
Lb[-fade_out:] *= np.linspace(1, 0, fade_out)
Rb[-fade_out:] *= np.linspace(1, 0, fade_out)

# ---- write 16-bit stereo WAV ----
inter = np.empty(N * 2, dtype=np.int16)
inter[0::2] = np.clip(Lb, -1, 1) * 32767
inter[1::2] = np.clip(Rb, -1, 1) * 32767
out = sys.argv[1] if len(sys.argv) > 1 else "bgm.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(inter.tobytes())
print("wrote", out, "peak", peak, "len", N / SR)

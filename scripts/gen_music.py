#!/usr/bin/env python3
"""Synthesize a 30s, 120 BPM electronic track and emit a beat manifest.

Because the track is generated from a known grid, every kick, section and
downbeat lands on an exact frame — the manifest lets the Remotion
composition choreograph visuals against the audio with sample accuracy.
"""
import json
import math
import os
import struct
import wave

import numpy as np

SR = 44100
BPM = 120.0
FPS = 30
BEAT = 60.0 / BPM          # 0.5s
BAR = BEAT * 4             # 2.0s
BARS = 15                  # 30s
DUR = BARS * BAR           # 30.0s
N = int(DUR * SR)
t = np.arange(N) / SR

rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12.0)


# Note names -> midi
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note(name, octave):
    return midi(12 * (octave + 1) + NOTE[name])


def env_exp(length, decay):
    n = int(length * SR)
    return np.exp(-np.arange(n) / (decay * SR))


def place(buf, start_t, sig):
    s = int(start_t * SR)
    e = min(s + len(sig), len(buf))
    if s >= len(buf):
        return
    buf[s:e] += sig[: e - s]


# --- Instrument voices -----------------------------------------------------

def kick(vel=1.0):
    length = 0.42
    n = int(length * SR)
    tt = np.arange(n) / SR
    f = 130.0 * np.exp(-tt / 0.03) + 46.0
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-tt / 0.14)
    click = np.sin(2 * np.pi * 1600 * tt) * np.exp(-tt / 0.004) * 0.6
    return (body + click) * vel


def bass(freq, length, vel=1.0):
    n = int(length * SR)
    tt = np.arange(n) / SR
    sub = np.sin(2 * np.pi * freq * tt)
    saw = 2 * (tt * freq - np.floor(0.5 + tt * freq))
    # gentle lowpass on the saw via one-pole
    a = 0.15
    lp = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc += a * (saw[i] - acc)
        lp[i] = acc
    amp = np.exp(-tt / (length * 0.5))
    return (0.7 * sub + 0.5 * lp) * amp * vel


def hat(vel=1.0):
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # crude highpass: differentiate
    hp = np.diff(noise, prepend=0.0)
    amp = np.exp(-tt / 0.02)
    return hp * amp * vel * 0.5


def pluck(freq, length, vel=1.0, harm=(1.0, 0.5, 0.28, 0.14)):
    n = int(length * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for i, h in enumerate(harm, start=1):
        sig += h * np.sin(2 * np.pi * freq * i * tt)
    amp = np.exp(-tt / (length * 0.4))
    return sig / sum(harm) * amp * vel


def pad(freqs, length, vel=1.0):
    n = int(length * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for f in freqs:
        detune = 1.0 + 0.004 * math.sin(f)
        sig += np.sin(2 * np.pi * f * tt)
        sig += 0.6 * np.sin(2 * np.pi * f * detune * tt)
    # slow attack + release
    atk = np.clip(tt / 0.25, 0, 1)
    rel = np.clip((length - tt) / 0.4, 0, 1)
    return sig / (len(freqs) * 1.6) * atk * rel * vel


# --- Arrangement -----------------------------------------------------------

# One chord per bar: Am - F - C - G, looping.
prog = [
    ("A", [note("A", 3), note("C", 4), note("E", 4)], note("A", 1)),
    ("F", [note("F", 3), note("A", 3), note("C", 4)], note("F", 1)),
    ("C", [note("C", 4), note("E", 4), note("G", 4)], note("C", 2)),
    ("G", [note("G", 3), note("B", 3), note("D", 4)], note("G", 1)),
]

# Section plan (by bar): 0-1 intro, 2-7 main, 8-9 break, 10-14 climax
def section_of(bar):
    if bar < 2:
        return "intro"
    if bar < 8:
        return "main"
    if bar < 10:
        return "break"
    return "climax"


drums = np.zeros(N)
bassbuf = np.zeros(N)
harmony = np.zeros(N)
lead = np.zeros(N)

kick_frames = []
section_events = []
last_section = None

for bar in range(BARS):
    bar_t = bar * BAR
    name, triad, root = prog[bar % 4]
    sec = section_of(bar)
    if sec != last_section:
        section_events.append({"section": sec, "frame": round(bar_t * FPS)})
        last_section = sec

    full = sec in ("main", "climax")
    arp_octave = triad + [f * 2 for f in triad]

    # Pad on downbeat (all sections except full-energy get lush pad)
    pad_vel = 0.9 if sec in ("intro", "break") else 0.5
    place(harmony, bar_t, pad(triad, BAR, vel=pad_vel))

    for beat in range(4):
        b_t = bar_t + beat * BEAT
        # Kick: four-on-the-floor in main/climax; downbeat only in break-out
        if full:
            place(drums, b_t, kick(vel=1.0 if beat == 0 else 0.9))
            kick_frames.append(round(b_t * FPS))
            # Bass follows kick
            place(bassbuf, b_t, bass(root, BEAT * 0.95,
                                     vel=1.0 if beat == 0 else 0.85))
        elif sec == "climax":
            pass
        # Offbeat hats (all energetic sections)
        if full:
            place(drums, b_t + BEAT * 0.5, hat(vel=0.8))
        # Climax: extra chord stab on each beat
        if sec == "climax":
            for f in triad:
                place(harmony, b_t, pluck(f, BEAT * 0.5, vel=0.28))

    # Arp: 16th notes cycling the chord, all sections
    arp_vel = 0.5 if sec == "intro" else (0.35 if sec == "break" else 0.4)
    for step in range(16):
        s_t = bar_t + step * (BEAT / 4)
        f = arp_octave[step % len(arp_octave)]
        place(lead, s_t, pluck(f, BEAT / 4 * 1.6, vel=arp_vel))

# Riser sweeping into the climax (last bar of the break)
riser_start = 9 * BAR
rn = int(BAR * SR)
rt = np.arange(rn) / SR
sweep = np.sin(2 * np.pi * np.cumsum(200 + 3000 * (rt / BAR) ** 2) / SR)
sweep *= (rt / BAR) ** 2 * 0.4
place(lead, riser_start, sweep)

# --- Mix -------------------------------------------------------------------

mix = (1.0 * drums + 0.85 * bassbuf + 0.5 * harmony + 0.42 * lead)

# Sidechain-style duck of harmony/lead under each kick for punch
duck = np.ones(N)
for kf in kick_frames:
    s = int(kf / FPS * SR)
    dn = int(0.18 * SR)
    e = min(s + dn, N)
    shape = 0.35 + 0.65 * (np.arange(e - s) / dn)
    duck[s:e] = np.minimum(duck[s:e], shape)
mix = drums + 0.85 * bassbuf + duck * (0.5 * harmony + 0.42 * lead)

# Soft clip / normalize
mix = np.tanh(mix * 0.8)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.94

# Fade in/out
fi = int(0.05 * SR)
fo = int(0.6 * SR)
mix[:fi] *= np.linspace(0, 1, fi)
mix[-fo:] *= np.linspace(1, 0, fo)

# Slight stereo widening on lead/harmony
left = mix.copy()
right = mix.copy()
delay = int(0.008 * SR)
right[delay:] += 0.06 * lead[:-delay] * duck[:-delay]
left[delay:] += 0.06 * harmony[:-delay] * duck[:-delay]
for ch in (left, right):
    m = np.max(np.abs(ch)) + 1e-9
    ch *= 0.96 / m

stereo = np.stack([left, right], axis=1)
pcm = (stereo * 32767).astype(np.int16)

out_wav = os.path.join(os.path.dirname(__file__), "..",
                       "remotion-app", "public", "audio", "beat-track.wav")
out_wav = os.path.abspath(out_wav)
with wave.open(out_wav, "w") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

manifest = {
    "bpm": BPM,
    "fps": FPS,
    "durationInFrames": round(DUR * FPS),
    "beatFrames": kick_frames,
    "barFrames": [round(b * BAR * FPS) for b in range(BARS)],
    "sections": section_events,
}
out_json = os.path.join(os.path.dirname(out_wav), "beat-manifest.json")
with open(out_json, "w") as f:
    json.dump(manifest, f, indent=2)

print("wrote", out_wav)
print("wrote", out_json)
print("kicks:", len(kick_frames), "duration frames:", manifest["durationInFrames"])
print("sections:", section_events)

"""Offline binaural approximation used for WAV export: equal-power panning, interaural delay,
seat distance and focus.

This is not a measured HRTF renderer and has no front/back cue. The live studio in the browser
(static/live.js) uses the Web Audio HRTF panner, room reflections and reverb instead.
Real-time streaming, codec integration, and latency measurement are future work.
"""
import io
import wave

import numpy as np

SAMPLE_RATE = 48_000
MAX_SECONDS = 15
REFERENCE_DISTANCE = 1.5     # metres: a voice this far away is neither boosted nor reduced
FOCUS_GAIN, OTHERS_GAIN = 1.8, .55   # same levels as the live studio's Focus button


def read_wav(stream):
    """Decode up to 15 seconds of 48 kHz, 16-bit PCM mono/stereo WAV."""
    with wave.open(stream, "rb") as source:
        if source.getsampwidth() != 2 or source.getframerate() != SAMPLE_RATE:
            raise ValueError("Use a 48 kHz, 16-bit PCM WAV file.")
        if source.getnchannels() not in (1, 2):
            raise ValueError("WAV files must have one or two channels.")
        if source.getnframes() == 0 or source.getnframes() > SAMPLE_RATE * MAX_SECONDS:
            raise ValueError("WAV clips must contain audio and be at most 15 seconds long.")
        raw = source.readframes(source.getnframes())
        if len(raw) != source.getnframes() * source.getnchannels() * 2:
            raise ValueError("WAV data is incomplete.")
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
        return samples.reshape(-1, source.getnchannels()).mean(axis=1)


def test_tone(index, seconds=5):
    """Distinct pulsed musical tones for a demo without microphone access."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    frequency = [220, 277.18, 329.63, 440, 523.25, 659.25, 783.99, 880][index % 8]
    phase = (t - index * 0.55) % 2.5
    envelope = np.where(phase < .8, np.sin(np.pi * np.minimum(phase / .8, 1)) ** 2, 0)
    return .28 * envelope * (np.sin(2 * np.pi * frequency * t) + .2 * np.sin(4 * np.pi * frequency * t))


def mix(sources, spatial=True, focus=None):
    """Seat angles are relative to a listener at the table center, facing 0°.

    Positive angles are right. At ±90° the opposite ear is delayed by 0.6 ms.
    Distance scales loudness (1.5 m is the reference; nearer is louder). With `focus` set to a
    participant ID that voice is boosted and the others lowered.
    Mono comparison uses equal gain at both ears and ignores distance. Sum then peak-limit the mix.
    """
    count = max((len(samples) for _, samples in sources), default=0)
    if not count:
        raise ValueError("Provide at least one non-empty audio source.")
    result = np.zeros((count + 29, 2), dtype=np.float64)
    for person, samples in sources:
        if person.muted:
            continue
        pan = np.sin(np.radians(person.angle)) if spatial else 0
        gains = np.sqrt([(1 - .85 * pan) / 2, (1 + .85 * pan) / 2])
        delay = int(round(abs(pan) * .0006 * SAMPLE_RATE))
        delays = [delay, 0] if pan > 0 else [0, delay]
        level = person.volume * (REFERENCE_DISTANCE / person.distance if spatial else 1)
        if focus is not None:
            level *= FOCUS_GAIN if person.id == focus else OTHERS_GAIN
        for channel in (0, 1):
            offset = delays[channel]
            result[offset:offset + len(samples), channel] += samples * level * gains[channel]
    peak = np.max(np.abs(result))
    if peak > .95:
        result *= .95 / peak
    return result


def write_wav(samples):
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(2)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        target.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return output.getvalue()

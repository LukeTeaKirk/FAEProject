"""Generate the speech assets used by the live studio and the listening test.

Preferred engine: the open-source Kokoro neural voice (Apache 2.0), which sounds like a real person and runs
entirely on this computer. Set it up once (about 340 MB):  see "Kokoro" below.  If Kokoro is not found, the
macOS `say` voices are used instead (clearly more robotic).

  chat_<id>.wav                 ~7 s monologue per participant, 48 kHz mono (demo conversation)
  crm_<id>_<color>_<number>.wav "<Name>, go to <color> <number>", 24 kHz mono (listening test)
All clips are trimmed and scaled to the same RMS so voices have equal loudness.

Kokoro: the model files live in KOKORO_DIR (default ~/.hearth-tts: kokoro-v1.0.onnx + voices-v1.0.bin) and the
script must be run with a Python that has `kokoro-onnx` and `soundfile`, plus `brew install espeak-ng`:
    ~/.hearth-tts/venv/bin/python tools/make_voices.py
Change VOICES below to pick different voices (try them with the clips in voice_samples/).
"""
import json, os, subprocess, tempfile, wave
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parent.parent / "spatial_audio" / "static" / "voices"
# id: (name shown in the app, Kokoro voice, Kokoro language, macOS fallback voice)
VOICES = {
    "aarav": ("Aarav", "am_michael", "en-us", "Rishi"),    # US male
    "diya":  ("Diya",  "af_heart",   "en-us", "Samantha"),  # US female
    "kabir": ("Kabir", "bm_george",  "en-gb", "Daniel"),    # British male
    "meera": ("Meera", "bf_emma",    "en-gb", "Karen"),     # British female
}
COLORS = ["red", "blue", "green", "white"]
NUMBERS = {"one": "one", "three": "three", "five": "five", "seven": "seven"}
CHAT = {
    "aarav": "Hi everyone, this is Aarav. I just finished the audio lab, and the spectrum plots look great. The harmonics line up exactly as we expected.",
    "diya": "Hello, Diya here. Can someone send me the slides for tomorrow? I want to check the timeline before the evening meeting starts.",
    "kabir": "Kabir speaking. The mess is serving paneer tonight, so I am going to eat early, and then head to the library to finish my report.",
    "meera": "This is Meera. I have recorded three clips for the project, and I will upload them to the shared folder right after dinner.",
}
TARGET_RMS = 0.05  # about -26 dBFS

KOKORO_DIR = Path(os.environ.get("KOKORO_DIR", Path.home() / ".hearth-tts"))
try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import EspeakConfig
    _kokoro = Kokoro(str(KOKORO_DIR / "kokoro-v1.0.onnx"), str(KOKORO_DIR / "voices-v1.0.bin"),
                     espeak_config=EspeakConfig(lib_path=os.environ.get("ESPEAK_LIB", "/opt/homebrew/lib/libespeak-ng.dylib"),
                                                data_path=os.environ.get("ESPEAK_DATA", "/opt/homebrew/share/espeak-ng-data")))
except Exception as error:  # Kokoro missing: fall back to the macOS voices
    _kokoro = None
    print("Kokoro not available (%s); using the macOS 'say' voices." % type(error).__name__)


def _convert(samples, src_rate, dst_rate):
    if src_rate == dst_rate:
        return samples
    with tempfile.TemporaryDirectory() as tmp:
        a, b = Path(tmp, "a.wav"), Path(tmp, "b.wav")
        save(a, samples, src_rate)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{dst_rate}", "-c", "1", str(a), str(b)], check=True)
        with wave.open(str(b)) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768


def synth(person, text, rate):
    name, kvoice, lang, say_voice = VOICES[person]
    if _kokoro is not None:
        samples, kokoro_rate = _kokoro.create(text, voice=kvoice, speed=1.0, lang=lang)
        return _convert(np.asarray(samples, dtype=np.float64), kokoro_rate, rate)
    with tempfile.TemporaryDirectory() as tmp:
        aiff, wav = Path(tmp, "a.aiff"), Path(tmp, "a.wav")
        subprocess.run(["say", "-v", say_voice, "-o", str(aiff), text], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", str(aiff), str(wav)], check=True)
        with wave.open(str(wav)) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768


def finish(x, rate):
    active = np.where(np.abs(x) > 0.01)[0]
    x = x[max(active[0] - int(.03 * rate), 0): active[-1] + int(.05 * rate)]
    x = x * (TARGET_RMS / np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)))
    return x * min(1.0, 0.9 / np.max(np.abs(x)))


def save(path, x, rate):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    engine = "Kokoro (neural)" if _kokoro is not None else "macOS say (robotic fallback)"
    print("Engine:", engine)
    for pid, (name, kvoice, lang, say_voice) in VOICES.items():
        save(OUT / f"chat_{pid}.wav", finish(synth(pid, CHAT[pid], 48000), 48000), 48000)
        for color in COLORS:
            for number in NUMBERS:
                save(OUT / f"crm_{pid}_{color}_{number}.wav", finish(synth(pid, f"{name}, go to {color} {number}.", 24000), 24000), 24000)
        print("done", pid, kvoice if _kokoro is not None else say_voice)
    (OUT / "manifest.json").write_text(json.dumps({
        "engine": engine,
        "people": {k: {"name": v[0], "voice": v[1] if _kokoro is not None else v[3]} for k, v in VOICES.items()},
        "chat": CHAT, "colors": COLORS, "numbers": list(NUMBERS), "crm_rate": 24000, "chat_rate": 48000}, indent=1))

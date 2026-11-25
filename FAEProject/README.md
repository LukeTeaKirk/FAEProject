# Roundtable — Spatial Audio Conferencing

A local web prototype for the FAE Monsoon 2026 project by Manan Gupta and Anshul Jain. Several people talk at once; each voice is placed at its own seat around "You", so it is easier to tell them apart and follow one.

## Run

Python 3.9 or later. From this folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5001 and wear headphones. Everything runs on your computer (no account, no cloud, no external CDN). The webcam tracker is bundled in `spatial_audio/vendor/`; keep that folder when copying the project. Stop with Ctrl+C.

## How the pieces connect

| Part | Role |
|---|---|
| `spatial_audio/static/live.js` | The live engine (Web Audio): HRTF panner per voice, distance loudness, four wall reflections, reverb, duller sound from behind, head turn, meters, self-test |
| `static/app.js` | The table: drag people by angle and distance, personal mix, drag-and-drop audio files, offline WAV export, "Larger text" |
| `static/call.js` | Live call: WebRTC peer connections (one audio stream per person), each stream becomes a seat that `live.js` places in space |
| `static/demo.js` | Guided tour: one minute of live audio with large on-screen captions |
| `static/tracking.js` | Webcam head tracking (MediaPipe FaceMesh in the browser) → `Live.setHead` |
| `static/listen.js`, `static/tune.js` | Listening test (mono vs spatial, CSV export) and "Tune for my ears" |
| `spatial_audio/__init__.py` | Flask app: page, `/api/mix` (offline WAV render), `/api/diag` (sound-problem log), `/tracking-assets/` |
| `spatial_audio/signaling.py` | Passes WebRTC setup messages between browsers (rooms in memory, long polling, no extra packages) |
| `spatial_audio/audio.py`, `models.py` | Offline renderer: equal-power pan, ≤0.6 ms ear delay, distance, focus, peak limiter |
| `tools/make_voices.py` | Generates the speech demo clips (`static/voices/`) with Kokoro or macOS `say` |

## What you can do

- **Live call between browsers.** In the Live call panel, join a room, then open the page in a second tab (or another browser) and join the same room. Each person's real voice arrives as its own WebRTC stream and takes a seat. Pick "Test voice" instead of the microphone to try it with no microphone or feedback. The panel shows each connection's round-trip time.
- **Hear and see direction.** Press Play, drag a person around the table, and listen to the voice move. The **Left ear / Right ear** bars and the plain-words captions ("front right · 1.5 m") show the same thing visually.
- **Distance.** Drag a person toward You (louder, drier) or away (quieter, roomier). Distance is 0.75–3.5 m.
- **Normal call vs Around the table.** One switch compares mono with spatial at matched loudness.
- **Turn your head.** Drag "You", use the slider, press Q/E, or enable the webcam under More controls. The room stays still and voices move around you.
- **Guided tour.** One-minute demo with large subtitles: four voices, normal call, around the table, a voice walking across, a voice moving away, head turn, and a voice circling you.
- **Larger text.** Header button; everything grows by 25% for a projector or a viewer far from the screen.
- **Algorithm switches** (More controls): HRTF, rear filtering, distance, room reflections, reverb, each on/off to hear what it adds. Strength: Subtle / Clear / Dramatic.
- **Your own audio.** Drop WAV, MP3 or M4A onto a person. Live play accepts any length; the offline export converts to 48 kHz WAV in the browser (first 15 s).
- **Focus** (button or F): +5 dB for one voice, −5 dB for the rest, in the live studio and the offline export.
- **Listening test** page: three voices speak at once ("Name, go to colour number"); the volunteer follows one. 2 practice and 12 counted trials, blind, loudness-matched, results saved in the browser and exported as CSV.
- **Tune for my ears**: 12 short sounds, you click where each came from, the best strength is chosen.
- **Self-test** (Signal pipeline page): 13 measurements of the engine in your browser.

AirPods: the app renders its own binaural sound, so Apple Spatial Audio can stay off. Turn off "Spatialize Stereo" and head tracking if offered, so the sound is not processed twice.

## Honest limits

- The call works between browsers on the same computer or network. There are no STUN/TURN servers, so calls across the internet, and microphone use from another machine over plain `http://`, are not supported (browsers allow the microphone only on `localhost` or HTTPS). One-way latency is not measured; the panel shows only the round-trip time of the media path.
- The live studio uses the browser's generic HRTF, not one measured for you. The offline Python export has no front/back cue and no room reflections.
- The speech voices are computer-generated.
- The listening test has not yet been run with volunteers; effects on comprehension are not yet measured.
- Camera tracking needs a webcam and permission; it estimates left/right turning only.

## Speech assets

With Kokoro installed (about 340 MB, one time; files in `~/.hearth-tts` or `KOKORO_DIR`, plus `brew install espeak-ng`):

```sh
~/.hearth-tts/venv/bin/python tools/make_voices.py
```

Without Kokoro the script falls back to macOS `say`. Voices are set in the `VOICES` table at the top of the script.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -v
```

26 checks cover the offline renderer (direction, delay, distance, focus, mono, limiter), the call signalling (rooms, tokens, timeouts, name sanitising), validation, the HTTP routes, the bundled tracker files, every page script, and the speech assets. The browser engine is checked by the in-app self-test.

## Structure

```text
app.py                        Local server entry point
spatial_audio/
  __init__.py                 Flask app and routes
  signaling.py                WebRTC signalling server
  audio.py, models.py         Offline renderer and validated participant model
  tracking_assets.py          Serves the bundled MediaPipe files
  templates/index.html        The four pages
  static/                     app.js live.js call.js demo.js tracking.js listen.js tune.js, CSS, voices/
  vendor/face_mesh/           MediaPipe FaceMesh model and runtimes (offline)
tests/test_audio.py
tools/make_voices.py
```

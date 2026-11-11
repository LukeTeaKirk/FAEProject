# Roundtable — Spatial Audio Conferencing

A Python framework and presentation-ready offline prototype for the FAE Monsoon 2026 project by Manan Gupta and Anshul Jain. Based on the accompanying Stage 1 brief.

## Run

Requires Python 3.9 or later. From this project folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5001 in a browser. Use headphones. No account, camera, microphone, external CDN, or API key is needed. The server binds only to your own computer. Stop it with Ctrl+C.

## Professor demo (about two minutes)

1. Open **Audio studio**. Explain that each avatar represents a separately received voice stream.
2. Select a participant, then click an empty `+` seat to move them. Positive angles are to your right; 0° is ahead of the listener at the center.
3. Click **Build spatial demo**, then play the audio. The built-in sources are distinct musical test tones, not speech or a live call.
4. Adjust volume or mute a person, rebuild, and play again. Changing controls clears the previous mix so it cannot be mistaken for the new setup.
5. Switch to **Mono**, build again, and compare. Mono means identical left and right output channels in a stereo WAV container.
6. Optionally add a different short speech WAV to each person and rebuild. Files must be **48 kHz, 16-bit PCM, mono or stereo, and at most 15 seconds each**. Total request limit: 24 MB. Stereo input is downmixed. Uploads remain in memory for the render and are not saved by the app. All clips start at the same time; shorter clips end in silence.
7. Show **Signal pipeline** and **Project roadmap** to distinguish working components from planned work.

The browser holds current settings and chosen files until reset or refresh; there is no database or saved session yet. Download the rendered WAV if you want to keep a mix.

## Implemented

- Responsive virtual-table UI with four sample participants and six available seats.
- Select a participant and move them into an empty seat.
- Independent 0–150% volume and mute controls.
- Python audio engine: equal-power panning with limited separation, up to 0.6 ms interaural delay, per-source gain, summing, and global peak normalization at 0.95.
- Test-tone generation and validated recorded WAV input.
- Spatial/mono comparison, browser playback, WAV download, and reset.
- Pipeline and roadmap views with explicit implementation status.

## Deliberately unfinished

There is **no live conference**, microphone capture, WebRTC signaling, Opus transport, room synchronization, authentication, camera tracking, measured latency, or volunteer evaluation. The mixer uses a basic stereo approximation rather than measured HRTF filters. Front and back seats at the same lateral angle produce the same cues. Audio is rendered offline; changing a control requires rebuilding. Peak normalization is applied per render and may change relative comparison loudness for loud inputs.

The full project's planned target of under 150 ms one-way latency is not a measured result of this prototype. Android/Windows packaging and manual/camera focus controls are future work. The current deliverable runs locally in a web browser with a Python backend.

## Structure

```text
app.py                         Local server entry point
spatial_audio/
  __init__.py                  Flask factory, page and mixing endpoints
  models.py                    Validated participant model
  audio.py                     Independent source decoding and spatial mixer
  templates/index.html         Three presentation views
  static/style.css             Responsive interface
  static/app.js                Seat controls, uploads and playback UI
 tests/test_audio.py           Audio and endpoint checks
```

The interface uses HTML/CSS and a small amount of browser JavaScript; the application backend and audio processing are Python. The audio engine has no dependency on Flask and can be reused by a future desktop or streaming client.

## Extension points

1. Add a signaling/transport module that produces one 48 kHz mono stream per participant, preserving participant IDs.
2. Split the offline mixer into block processing with persistent delay lines and a streaming limiter before real-time use.
3. Replace the stereo approximation with HRTF convolution, including sample-rate handling and an explicit coordinate system.
4. Synchronize room seats across clients, while keeping each listener's gain controls local.
5. Add manual focus, then optional face-direction estimation with a camera-off fallback.
6. Measure latency and clipping, then compare speaker identification and overlapping-speech comprehension with volunteers.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -v
```

Checks cover left/right direction and delay, mono equality, mute, peak protection, WAV decoding, upload validation, and HTTP rendering.

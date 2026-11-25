"""Application factory. Audio processing is independent of the web interface."""
import io
import json
import wave
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

from .audio import SAMPLE_RATE, mix, read_wav, test_tone, write_wav
from .models import Participant
from .signaling import create_blueprint as signaling_blueprint
from .tracking_assets import tracking_assets

VOICES = Path(__file__).parent / "static" / "voices"


def speech_demo(person_id):
    """Built-in demo voice for a participant (see tools/make_voices.py), or None if unavailable."""
    path = VOICES / f"chat_{person_id}.wav"
    if not path.is_file():
        return None
    with path.open("rb") as stream:
        return read_wav(stream)


def create_app():
    app = Flask(__name__)
    app.register_blueprint(tracking_assets)
    app.register_blueprint(signaling_blueprint())
    app.config["MAX_CONTENT_LENGTH"] = 24 * 1024 * 1024

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", mode="offline prototype", sample_rate=SAMPLE_RATE)

    @app.post("/api/diag")
    def diagnostics():
        """Sound-problem report from the page (browser, audio state). Only printed to this computer's server log."""
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return ("", 204)
        safe = {str(k)[:40]: (v if isinstance(v, (int, float, bool)) else str(v)[:240]) for k, v in list(data.items())[:24]}
        print("DIAG", json.dumps(safe, ensure_ascii=True), flush=True)
        return ("", 204)

    @app.post("/api/mix")
    def render_mix():
        try:
            settings = json.loads(request.form.get("settings", "{}"))
            participants = [Participant.from_dict(p) for p in settings["participants"]]
            if not 1 <= len(participants) <= 8:
                raise ValueError("Choose between one and eight participants.")
            if len({p.id for p in participants}) != len(participants):
                raise ValueError("Participant IDs must be unique.")
            spatial = settings.get("spatial", True)
            if not isinstance(spatial, bool):
                raise ValueError("Spatial mode must be true or false.")
            focus = settings.get("focus")
            if focus is not None and focus not in {p.id for p in participants}:
                raise ValueError("Focus must be one of the participants.")
            source = settings.get("source", "tones")
            if source not in ("tones", "speech"):
                raise ValueError("Source must be 'tones' or 'speech'.")
            sources = []
            for i, person in enumerate(participants):
                uploaded = request.files.get(person.id)
                if uploaded:
                    samples = read_wav(uploaded.stream)
                else:
                    samples = (speech_demo(person.id) if source == "speech" else None)
                    samples = test_tone(i) if samples is None else samples
                sources.append((person, samples))
            result = mix(sources, spatial=spatial, focus=focus)
            return send_file(io.BytesIO(write_wav(result)), mimetype="audio/wav",
                             download_name="spatial-table-mix.wav")
        except (ValueError, TypeError, KeyError, AttributeError, wave.Error, EOFError, json.JSONDecodeError) as exc:
            return jsonify(error=str(exc) or "Invalid audio or participant settings."), 400

    @app.errorhandler(413)
    def too_large(error):
        return jsonify(error="Files exceed the 24 MB request limit. Try shorter WAV clips."), 413

    return app

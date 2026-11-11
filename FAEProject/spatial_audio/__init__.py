"""Application factory. Audio processing is independent of the web interface."""
import io
import json
import wave

from flask import Flask, jsonify, render_template, request, send_file

from .audio import SAMPLE_RATE, mix, read_wav, test_tone, write_wav
from .models import Participant


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 24 * 1024 * 1024

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", mode="offline prototype", sample_rate=SAMPLE_RATE)

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
            sources = []
            for i, person in enumerate(participants):
                uploaded = request.files.get(person.id)
                samples = read_wav(uploaded.stream) if uploaded else test_tone(i)
                sources.append((person, samples))
            result = mix(sources, spatial=spatial)
            return send_file(io.BytesIO(write_wav(result)), mimetype="audio/wav",
                             download_name="spatial-table-mix.wav")
        except (ValueError, TypeError, KeyError, AttributeError, wave.Error, EOFError, json.JSONDecodeError) as exc:
            return jsonify(error=str(exc) or "Invalid audio or participant settings."), 400

    @app.errorhandler(413)
    def too_large(error):
        return jsonify(error="Files exceed the 24 MB request limit. Try shorter WAV clips."), 413

    return app

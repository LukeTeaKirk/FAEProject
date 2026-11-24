"""Serve the bundled MediaPipe model and browser runtimes from Roundtable."""
from pathlib import Path

from flask import Blueprint, send_from_directory

tracking_assets = Blueprint("tracking_assets", __name__)
DIRECTORY = Path(__file__).parent / "vendor" / "face_mesh" / "0.4.1633559619"


@tracking_assets.get("/tracking-assets/<name>")
def asset(name):
    return send_from_directory(DIRECTORY, name, max_age=86400)

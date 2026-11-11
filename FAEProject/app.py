"""Entry point for the spatial conferencing prototype."""
from spatial_audio import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)

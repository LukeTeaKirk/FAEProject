"""Shared domain objects; future call transport can use the same participant model."""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Participant:
    id: str
    name: str
    angle: float
    volume: float = 1.0
    muted: bool = False

    @classmethod
    def from_dict(cls, data):
        angle, volume = float(data["angle"]), float(data.get("volume", 1))
        if not math.isfinite(angle) or not -180 <= angle <= 180:
            raise ValueError("Seat angle must be between -180 and 180 degrees.")
        if not math.isfinite(volume) or not 0 <= volume <= 1.5:
            raise ValueError("Volume must be between 0 and 150%.")
        identity = data["id"]
        if not isinstance(identity, str) or not identity or len(identity) > 64:
            raise ValueError("A participant needs a short text ID.")
        muted = data.get("muted", False)
        if not isinstance(muted, bool):
            raise ValueError("Mute must be true or false.")
        return cls(identity, str(data.get("name", identity))[:80], angle, volume, muted)

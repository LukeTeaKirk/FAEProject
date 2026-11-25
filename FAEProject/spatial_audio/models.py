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
    distance: float = 1.5

    @classmethod
    def from_dict(cls, data):
        angle, volume = float(data["angle"]), float(data.get("volume", 1))
        if not math.isfinite(angle) or not -180 <= angle <= 180:
            raise ValueError("Seat angle must be between -180 and 180 degrees.")
        if not math.isfinite(volume) or not 0 <= volume <= 1.5:
            raise ValueError("Volume must be between 0 and 150%.")
        distance = float(data.get("distance", 1.5))
        if not math.isfinite(distance) or not .75 <= distance <= 3.5:
            raise ValueError("Distance must be between 0.75 and 3.5 metres.")
        identity = data["id"]
        if not isinstance(identity, str) or not identity or len(identity) > 64:
            raise ValueError("A participant needs a short text ID.")
        muted = data.get("muted", False)
        if not isinstance(muted, bool):
            raise ValueError("Mute must be true or false.")
        return cls(identity, str(data.get("name", identity))[:80], angle, volume, muted, distance)

"""WebRTC signalling for Roundtable calls.

Browsers exchange audio directly (peer to peer). This module only passes the short setup messages
(offer, answer, ICE candidates) between them. Rooms live in memory: nothing is written to disk and
everything disappears when the server stops. It uses long polling, so it needs no extra packages.
"""
import re
import secrets
import threading
import time

from flask import Blueprint, jsonify, request

MAX_PEERS = 8            # same limit as the mixer
PEER_TIMEOUT = 20        # seconds without a poll before a browser counts as gone
MAX_QUEUE = 200
MAX_DATA = 20_000        # bytes of JSON in one signalling message
POLL_WAIT = 8            # seconds a poll waits for news before returning empty
KINDS = ("offer", "answer", "ice")
ROOM = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class Rooms:
    def __init__(self, clock=time.monotonic):
        self.cv = threading.Condition()
        self.rooms = {}
        self.clock = clock
        self.counter = 0

    # -- helpers (call with the lock held) ---------------------------------------------------
    def _room(self, name):
        return self.rooms.setdefault(name, {"peers": {}, "version": 0})

    def _prune(self, name):
        room = self.rooms.get(name)
        if not room:
            return
        now = self.clock()
        gone = [pid for pid, p in room["peers"].items() if now - p["seen"] > PEER_TIMEOUT]
        for pid in gone:
            del room["peers"][pid]
        if gone:
            room["version"] += 1
            self.cv.notify_all()
        if not room["peers"]:
            self.rooms.pop(name, None)

    def _peer(self, name, pid, token):
        self._prune(name)
        peer = self.rooms.get(name, {"peers": {}})["peers"].get(pid)
        if not peer or not secrets.compare_digest(peer["token"], str(token)):
            raise ValueError("Unknown participant. Join the call again.")
        peer["seen"] = self.clock()
        return peer

    @staticmethod
    def _listing(room):
        return sorted(({"id": p["id"], "name": p["name"], "order": p["order"]} for p in room["peers"].values()),
                      key=lambda p: p["order"])

    # -- operations ------------------------------------------------------------------------
    def join(self, name, display):
        if not ROOM.match(str(name)):
            raise ValueError("Room names use letters, numbers, - and _ (up to 32).")
        # Names are shown on every other participant's page, so keep only letters, digits and plain punctuation.
        display = " ".join(re.sub(r"[^\w .'-]", "", str(display)).split())[:24]
        if not display:
            raise ValueError("Enter your name.")
        with self.cv:
            self._prune(name)
            room = self._room(name)
            if len(room["peers"]) >= MAX_PEERS:
                raise ValueError(f"This room is full ({MAX_PEERS} people).")
            self.counter += 1
            peer = {"id": secrets.token_hex(4), "token": secrets.token_urlsafe(16), "name": display,
                    "order": self.counter, "seen": self.clock(), "queue": []}
            existing = self._listing(room)
            room["peers"][peer["id"]] = peer
            room["version"] += 1
            self.cv.notify_all()
            return {"id": peer["id"], "token": peer["token"], "peers": existing, "version": room["version"]}

    def leave(self, name, pid, token):
        with self.cv:
            try:
                self._peer(name, pid, token)
            except ValueError:
                return
            room = self.rooms[name]
            del room["peers"][pid]
            room["version"] += 1
            if not room["peers"]:
                self.rooms.pop(name, None)
            self.cv.notify_all()

    def send(self, name, pid, token, to, kind, data):
        if kind not in KINDS or not isinstance(data, dict):
            raise ValueError("Bad signalling message.")
        if len(repr(data)) > MAX_DATA:
            raise ValueError("Signalling message too large.")
        with self.cv:
            self._peer(name, pid, token)
            target = self.rooms[name]["peers"].get(to)
            if not target:
                raise ValueError("That person has left.")
            if len(target["queue"]) >= MAX_QUEUE:
                raise ValueError("Too many pending messages.")
            target["queue"].append({"from": pid, "type": kind, "data": data})
            self.cv.notify_all()

    def poll(self, name, pid, token, since, wait=POLL_WAIT):
        deadline = self.clock() + wait
        with self.cv:
            while True:
                peer = self._peer(name, pid, token)
                room = self.rooms[name]
                if peer["queue"] or room["version"] != since:
                    messages, peer["queue"] = peer["queue"], []
                    return {"messages": messages, "peers": self._listing(room), "version": room["version"]}
                remaining = deadline - self.clock()
                if remaining <= 0:
                    return {"messages": [], "peers": self._listing(room), "version": room["version"]}
                self.cv.wait(min(remaining, 2))


def create_blueprint(rooms=None):
    rooms = rooms or Rooms()
    bp = Blueprint("signaling", __name__)

    def body():
        data = request.get_json(force=True, silent=True)
        if not isinstance(data, dict):
            raise ValueError("Send a JSON object.")
        return data

    def guard(fn):
        try:
            return jsonify(fn())
        except ValueError as exc:
            return jsonify(error=str(exc)), 400

    @bp.post("/api/rtc/join")
    def join():
        return guard(lambda: rooms.join(body().get("room", ""), body().get("name", "")))

    @bp.post("/api/rtc/send")
    def send():
        def run():
            d = body()
            rooms.send(str(d.get("room", "")), str(d.get("id", "")), d.get("token", ""), str(d.get("to", "")),
                       d.get("type"), d.get("data"))
            return {"ok": True}
        return guard(run)

    @bp.get("/api/rtc/poll")
    def poll():
        def run():
            try:
                since = int(request.args.get("since", -1))
            except ValueError:
                since = -1
            return rooms.poll(request.args.get("room", ""), request.args.get("id", ""), request.args.get("token", ""), since)
        return guard(run)

    @bp.post("/api/rtc/leave")
    def leave():
        def run():
            d = body()
            rooms.leave(str(d.get("room", "")), str(d.get("id", "")), d.get("token", ""))
            return {"ok": True}
        return guard(run)

    bp.rooms = rooms
    return bp

import io
import json
import unittest
import wave
from pathlib import Path

import numpy as np

from spatial_audio import create_app
from spatial_audio.audio import SAMPLE_RATE, mix, read_wav, write_wav
from spatial_audio.models import Participant
from spatial_audio.signaling import MAX_PEERS, PEER_TIMEOUT, Rooms


class AudioTests(unittest.TestCase):
    def test_direction_and_interaural_delay(self):
        impulse = np.zeros(100)
        impulse[0] = .5
        result = mix([(Participant('a', 'A', 90), impulse)])
        self.assertGreater(np.max(result[:, 1]), np.max(result[:, 0]))
        self.assertEqual(np.argmax(result[:, 0]), 29)
        self.assertEqual(np.argmax(result[:, 1]), 0)
        mirrored = mix([(Participant('a', 'A', -90), impulse)])
        np.testing.assert_allclose(result[:, ::-1], mirrored)

    def test_mono_mute_and_peak_protection(self):
        samples = np.ones(100)
        mono = mix([(Participant('a', 'A', 60), samples)], spatial=False)
        np.testing.assert_array_equal(mono[:, 0], mono[:, 1])
        muted = mix([(Participant('a', 'A', 0, muted=True), samples)])
        self.assertEqual(np.max(np.abs(muted)), 0)
        loud = mix([(Participant(str(i), 'A', 0, 1.5), samples) for i in range(8)])
        self.assertLessEqual(np.max(np.abs(loud)), .950000001)

    def test_stereo_wav_roundtrip(self):
        data = np.column_stack((np.full(480, .2), np.full(480, .4)))
        decoded = read_wav(io.BytesIO(write_wav(data)))
        np.testing.assert_allclose(decoded, .3, atol=.0001)

    def test_reject_wrong_sample_rate(self):
        data = io.BytesIO()
        with wave.open(data, 'wb') as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(44100)
            f.writeframes(b'\0\0' * 100)
        data.seek(0)
        with self.assertRaises(ValueError):
            read_wav(data)


class DistanceAndFocusTests(unittest.TestCase):
    def level(self, **kwargs):
        participant = kwargs.pop('participant', Participant('a', 'A', 0, **kwargs))
        return np.max(np.abs(mix([(participant, np.full(100, .1))], **self.options)))

    options = {}

    def test_nearer_is_louder_and_mono_ignores_distance(self):
        near, far = self.level(distance=.75), self.level(distance=3.0)
        self.assertGreater(near, self.level())
        self.assertLess(far, self.level())
        self.options = {'spatial': False}
        self.assertAlmostEqual(self.level(distance=.75), self.level(distance=3.0))

    def test_focus_boosts_one_voice_and_lowers_the_others(self):
        a, b = Participant('a', 'A', -60), Participant('b', 'B', 60)
        samples = np.full(100, .1)
        plain = mix([(a, samples), (b, samples)])
        focused = mix([(a, samples), (b, samples)], focus='a')
        self.assertGreater(np.max(np.abs(focused[:, 0])), np.max(np.abs(plain[:, 0])) * 1.2)   # left ear carries A
        self.assertLess(np.max(np.abs(focused[:, 1])), np.max(np.abs(plain[:, 1])))             # right ear carries B

    def test_distance_is_validated(self):
        for bad in (0, 10, float('nan')):
            with self.assertRaises(ValueError):
                Participant.from_dict({'id': 'a', 'angle': 0, 'distance': bad})
        self.assertEqual(Participant.from_dict({'id': 'a', 'angle': 0}).distance, 1.5)


class SignalingTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.rooms = Rooms(clock=lambda: self.now)

    def test_join_lists_earlier_peers_only(self):
        a = self.rooms.join('t', 'Anshul')
        b = self.rooms.join('t', 'Manan')
        self.assertEqual(a['peers'], [])
        self.assertEqual([p['name'] for p in b['peers']], ['Anshul'])

    def test_message_reaches_only_its_target_and_needs_the_token(self):
        a, b = self.rooms.join('t', 'A'), self.rooms.join('t', 'B')
        self.rooms.send('t', b['id'], b['token'], a['id'], 'offer', {'sdp': 'x'})
        got = self.rooms.poll('t', a['id'], a['token'], since=-1, wait=0)
        self.assertEqual(got['messages'], [{'from': b['id'], 'type': 'offer', 'data': {'sdp': 'x'}}])
        self.assertEqual(self.rooms.poll('t', b['id'], b['token'], since=-1, wait=0)['messages'], [])
        with self.assertRaises(ValueError):
            self.rooms.send('t', b['id'], 'wrong', a['id'], 'offer', {})
        with self.assertRaises(ValueError):
            self.rooms.send('t', b['id'], b['token'], a['id'], 'hack', {})

    def test_leaving_and_timeout_update_the_room(self):
        a, b = self.rooms.join('t', 'A'), self.rooms.join('t', 'B')
        self.rooms.leave('t', b['id'], b['token'])
        self.assertEqual(self.rooms.poll('t', a['id'], a['token'], since=-1, wait=0)['peers'][0]['name'], 'A')
        c = self.rooms.join('t', 'C')
        self.now += PEER_TIMEOUT - 5
        self.rooms.poll('t', c['id'], c['token'], since=-1, wait=0)      # C keeps polling, A goes silent
        self.now += 10
        self.assertEqual([p['name'] for p in self.rooms.poll('t', c['id'], c['token'], since=-1, wait=0)['peers']], ['C'])

    def test_rooms_are_separate_validated_and_limited(self):
        self.rooms.join('one', 'A')
        self.assertEqual(self.rooms.join('two', 'B')['peers'], [])
        for bad_room, bad_name in (('bad room!', 'A'), ('', 'A'), ('ok', '   ')):
            with self.assertRaises(ValueError):
                self.rooms.join(bad_room, bad_name)
        for i in range(MAX_PEERS):
            self.rooms.join('full', f'P{i}')
        with self.assertRaises(ValueError):
            self.rooms.join('full', 'late')

    def test_names_cannot_carry_markup(self):
        peer = self.rooms.join('t', '<img src=x onerror=alert(1)>  Dr "Who"')
        got = self.rooms.join('t', 'B')['peers'][0]['name']
        self.assertNotIn('<', got + peer['id'])
        self.assertEqual(got, 'img srcx onerroralert1 Dr Who'[:24])

    def test_http_flow(self):
        client = create_app().test_client()
        a = client.post('/api/rtc/join', json={'room': 'http', 'name': 'A'}).json
        b = client.post('/api/rtc/join', json={'room': 'http', 'name': 'B'}).json
        self.assertEqual([p['name'] for p in b['peers']], ['A'])
        sent = client.post('/api/rtc/send', json={'room': 'http', 'id': b['id'], 'token': b['token'], 'to': a['id'], 'type': 'ice', 'data': {'c': 1}})
        self.assertEqual(sent.status_code, 200)
        polled = client.get('/api/rtc/poll', query_string={'room': 'http', 'id': a['id'], 'token': a['token'], 'since': -1}).json
        self.assertEqual(polled['messages'][0]['type'], 'ice')
        self.assertEqual(client.get('/api/rtc/poll', query_string={'room': 'http', 'id': a['id'], 'token': 'no'}).status_code, 400)
        self.assertEqual(client.post('/api/rtc/join', data='nope').status_code, 400)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()
        self.settings = {'participants': [{'id': 'a', 'angle': -60, 'volume': 1}], 'spatial': True}

    def render(self, settings):
        return self.client.post('/api/mix', data={'settings': json.dumps(settings)})

    def test_ui_and_health(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/api/health').json['sample_rate'], SAMPLE_RATE)

    def test_demo_mix_returns_stereo_wav(self):
        result = self.render(self.settings)
        self.assertEqual(result.status_code, 200)
        with wave.open(io.BytesIO(result.data), 'rb') as audio:
            self.assertEqual(audio.getnchannels(), 2)
            self.assertEqual(audio.getframerate(), SAMPLE_RATE)
            self.assertGreater(audio.getnframes(), 0)

    def test_invalid_settings(self):
        for settings in ({}, {'participants': []}, {'participants': [{'id': 'a', 'angle': float('nan')}]},
                         {'participants': [{'id': 'a', 'angle': 0, 'volume': -1}]}):
            self.assertEqual(self.render(settings).status_code, 400)
        self.assertEqual(self.client.post('/api/mix', data={'settings': 'invalid'}).status_code, 400)

    def test_distance_and_focus_reach_the_renderer(self):
        people = [{'id': 'a', 'angle': -60, 'distance': 3}, {'id': 'b', 'angle': 60}]
        result = self.render({'participants': people, 'focus': 'b'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.render({'participants': people, 'focus': 'nobody'}).status_code, 400)
        self.assertEqual(self.render({'participants': [{'id': 'a', 'angle': 0, 'distance': 99}]}).status_code, 400)

    def test_bundled_tracker_files_are_served(self):
        self.assertEqual(self.client.get('/tracking-assets/face_mesh.js').status_code, 200)
        self.assertEqual(self.client.get('/tracking-assets/face_mesh_solution_simd_wasm_bin.wasm').status_code, 200)
        self.assertEqual(self.client.get('/tracking-assets/../__init__.py').status_code, 404)

    def test_every_page_script_is_served(self):
        page = self.client.get('/').get_data(as_text=True)
        for name in ('app', 'live', 'listen', 'tracking', 'tune', 'demo', 'call'):
            self.assertIn(f'/static/{name}.js', page)
            with self.client.get(f'/static/{name}.js') as response:
                self.assertEqual(response.status_code, 200)

    def test_uploaded_audio_and_invalid_file(self):
        audio = write_wav(np.zeros((480, 2)))
        result = self.client.post('/api/mix', data={
            'settings': json.dumps(self.settings), 'a': (io.BytesIO(audio), 'voice.wav')})
        self.assertEqual(result.status_code, 200)
        invalid = self.client.post('/api/mix', data={
            'settings': json.dumps(self.settings), 'a': (io.BytesIO(b'not audio'), 'voice.wav')})
        self.assertEqual(invalid.status_code, 400)


class SpeechDemoTests(unittest.TestCase):
    """Built-in speech assets (tools/make_voices.py) and the 'speech' source of the offline renderer."""
    VOICES = Path(__file__).resolve().parent.parent / 'spatial_audio' / 'static' / 'voices'

    def setUp(self):
        self.client = create_app().test_client()

    def test_manifest_and_files_are_complete(self):
        manifest = json.loads((self.VOICES / 'manifest.json').read_text())
        self.assertEqual(sorted(manifest['people']), ['aarav', 'diya', 'kabir', 'meera'])
        for pid in manifest['people']:
            self.assertTrue((self.VOICES / f'chat_{pid}.wav').is_file())
            for color in manifest['colors']:
                for number in manifest['numbers']:
                    self.assertTrue((self.VOICES / f'crm_{pid}_{color}_{number}.wav').is_file())

    def test_voices_have_equal_loudness(self):
        levels = []
        for path in sorted(self.VOICES.glob('crm_*.wav')):
            with wave.open(str(path), 'rb') as clip:
                self.assertEqual((clip.getnchannels(), clip.getsampwidth()), (1, 2))
                x = np.frombuffer(clip.readframes(clip.getnframes()), dtype='<i2') / 32768
            levels.append(20 * np.log10(np.sqrt(np.mean(x[np.abs(x) > .01] ** 2))))
        self.assertLess(max(levels) - min(levels), 1.5)

    def test_chat_voices_load_as_valid_wav(self):
        for pid in ('aarav', 'diya', 'kabir', 'meera'):
            with (self.VOICES / f'chat_{pid}.wav').open('rb') as stream:
                samples = read_wav(stream)
            self.assertGreater(len(samples), SAMPLE_RATE * 5)

    def test_speech_source_renders_and_differs_from_tones(self):
        people = [{'id': pid, 'angle': a, 'volume': 1} for pid, a in (('aarav', -60), ('diya', 0), ('kabir', 60), ('meera', 120))]
        speech = self.client.post('/api/mix', data={'settings': json.dumps({'participants': people, 'source': 'speech'})})
        tones = self.client.post('/api/mix', data={'settings': json.dumps({'participants': people, 'source': 'tones'})})
        self.assertEqual(speech.status_code, 200)
        self.assertNotEqual(speech.data, tones.data)
        with wave.open(io.BytesIO(speech.data), 'rb') as audio:
            self.assertGreater(audio.getnframes(), SAMPLE_RATE * 9)   # longest chat clip is about 9.7 s

    def test_diagnostics_endpoint_accepts_reports_and_ignores_junk(self):
        ok = self.client.post('/api/diag', json={'event': 'load', 'state': 'running', 'ua': 'x' * 1000})
        junk = self.client.post('/api/diag', data='not json', content_type='text/plain')
        self.assertEqual((ok.status_code, junk.status_code), (204, 204))

    def test_unknown_source_rejected(self):
        bad = self.client.post('/api/mix', data={'settings': json.dumps({'participants': [{'id': 'a', 'angle': 0}], 'source': 'radio'})})
        self.assertEqual(bad.status_code, 400)


if __name__ == '__main__':
    unittest.main()

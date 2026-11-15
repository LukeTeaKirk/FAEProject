import io
import json
import unittest
import wave
from pathlib import Path

import numpy as np

from spatial_audio import create_app
from spatial_audio.audio import SAMPLE_RATE, mix, read_wav, write_wav
from spatial_audio.models import Participant


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

    def test_unknown_source_rejected(self):
        bad = self.client.post('/api/mix', data={'settings': json.dumps({'participants': [{'id': 'a', 'angle': 0}], 'source': 'radio'})})
        self.assertEqual(bad.status_code, 400)


if __name__ == '__main__':
    unittest.main()

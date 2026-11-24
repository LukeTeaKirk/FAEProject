// Camera frames stay in the browser. The renderer consumes only a horizontal angle.
(() => {
  const toggle = document.querySelector('#camera-toggle');
  const status = document.querySelector('#camera-status');
  const cameras = document.querySelector('#tracking-camera');
  const choice = document.querySelector('#camera-choice');
  const base = '/tracking-assets/';
  let active = null;
  let loading;

  function loadTracker() {
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = base + 'face_mesh.js';
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          loading = null;
          reject(new Error('Could not load tracking files. Check that the bundled tracker files are present.'));
        };
        document.head.append(script);
      });
    }
    return loading;
  }

  function stop(message = 'Camera off. Manual head turn is available.', resetHead = true) {
    const session = active;
    if (!session) return;
    active = null;
    session.stream?.getTracks().forEach(track => track.stop());
    session.video.pause();
    session.video.srcObject = null;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.textContent = 'Enable camera head tracking';
    choice.hidden = true;
    if (resetHead) Live.setHead(0);
    status.textContent = message;
  }

  async function showCameras(session, track) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (active !== session) return;
    const inputs = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
    cameras.replaceChildren(...inputs.map((device, index) =>
      new Option(device.label || ('Camera ' + (index + 1)), device.deviceId)));
    cameras.value = track.getSettings().deviceId || '';
    choice.hidden = inputs.length < 2;
  }

  function updatePose(session, results) {
    if (active !== session) return;
    const face = results.multiFaceLandmarks?.[0];
    if (!face) {
      status.textContent = 'Looking for your face. Face the camera to resume.';
      return;
    }
    // Unmirrored camera pixels: turning to the listener's right brings the
    // image-right temple closer. MediaPipe depth uses the same units as x.
    const left = face[234], right = face[454];
    const vertical = (right.y - left.y) * session.video.videoHeight / session.video.videoWidth;
    const yaw = Math.atan2(left.z - right.z, Math.hypot(right.x - left.x, vertical)) * 180 / Math.PI;
    if (!Number.isFinite(yaw)) return;
    if (session.center === null) {
      session.center = yaw;
      session.angle = 0;
    }
    session.angle += .55 * (yaw - session.center - session.angle);
    const angle = Math.round(session.angle);
    if (angle !== Live.head) Live.setHead(angle);
    status.textContent = 'Tracking head turns. Use Face front to recenter.';
  }

  async function start(deviceId) {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Camera access requires localhost or HTTPS and a camera-enabled browser.';
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const session = { video, stream: null, center: null, angle: 0 };
    active = session;
    toggle.setAttribute('aria-pressed', 'true');
    toggle.textContent = 'Disable camera head tracking';
    status.textContent = 'Allow camera access, then look straight ahead.';
    let model;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }) }
      });
      if (active !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      const [track] = stream.getVideoTracks();
      track.onended = () => { if (active === session) stop('Camera disconnected. Enable tracking to reconnect.'); };
      video.srcObject = stream;
      await video.play();
      if (active !== session) return;
      showCameras(session, track).catch(() => {});
      status.textContent = 'Loading face tracking. Look straight ahead.';
      await loadTracker();
      if (active !== session) return;
      model = new FaceMesh({ locateFile: file => base + file });
      model.setOptions({ maxNumFaces: 1, selfieMode: false, refineLandmarks: false,
        minDetectionConfidence: .55, minTrackingConfidence: .55 });
      model.onResults(results => updatePose(session, results));
      while (active === session) {
        if (video.readyState >= 2) await model.send({ image: video });
        await new Promise(resolve => setTimeout(resolve, 55));
      }
    } catch (error) {
      if (active === session) {
        const messages = {
          NotAllowedError: 'Camera permission was denied. Allow camera access in your browser and system settings, then retry.',
          NotFoundError: 'No camera was found. Connect a webcam and retry.',
          NotReadableError: 'Camera unavailable. Close other apps using it and retry.'
        };
        stop(messages[error.name] || 'Tracking could not start. Check camera access, WebGL and the bundled tracker files.');
      }
    } finally {
      if (model) await model.close();
    }
  }

  toggle.onclick = () => active ? stop() : start();
  cameras.onchange = () => start(cameras.value);
  document.querySelector('#head-reset').addEventListener('click', () => {
    if (active) active.center = null;
  });
  document.querySelector('#head-turn').addEventListener('input', () => stop(undefined, false), true);
  document.querySelector('.listener').addEventListener('pointerdown', () => stop(undefined, false), true);
  document.addEventListener('keydown', event => {
    if (/^[qe]$/i.test(event.key) && !event.target.matches('input, select, textarea')) stop(undefined, false);
  }, true);
  document.querySelectorAll('[data-page]').forEach(button => {
    if (button.dataset.page !== 'studio') button.addEventListener('click', () => stop());
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => stop());
})();

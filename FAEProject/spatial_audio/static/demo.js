/* Guided tour: about a minute of live audio with large on-screen captions.
   Every sound is paired with something visible (a caption, the ear bars, a moving avatar), so the demo
   still makes sense to someone who cannot hear the difference clearly. It drives the same controls a user has. */
const Demo = (() => {
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SEATS = { aarav: -60, diya: 0, kabir: 60, meera: 120 };
  let token = 0, running = false;
  class Stopped extends Error {}

  const bar = () => $('#demo-banner');
  function say(title, text) {
    const b = bar(); b.hidden = false;
    b.querySelector('b').textContent = title; b.querySelector('span').textContent = text;
  }
  const person = id => people.find(p => p.id === id);

  async function run() {
    if (running) return stop();
    running = true; const mine = ++token;
    const alive = () => { if (!running || token !== mine) throw new Stopped(); };
    const wait = async ms => { const end = performance.now() + ms; while (performance.now() < end) { alive(); await sleep(60); } };
    // Smoothly change something from 0 to 1 over a number of milliseconds.
    const tween = async (ms, fn) => { const t0 = performance.now(); for (;;) { alive(); const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k >= 1) return; await sleep(50); } };
    const saved = { people: JSON.parse(JSON.stringify(people)), selected, focusId, source, head: Live.head, spatial };
    $('#demo-start').textContent = '■  Stop tour'; $('#coach').hidden = true;
    try {
      // Start from a clean, known table.
      people.forEach(p => Object.assign(p, { angle: SEATS[p.id], distance: 1.5, volume: 1, muted: false }));
      focusId = null; selected = 'aarav'; source = 'speech'; $('#source-select').value = 'speech';
      if (!spatial) $('[data-mode="spatial"]').click();
      Live.setHead(0); draw();
      say('Putting on the table…', 'Starting the voices.');
      if (!Live.playing) await Live.start(); alive();

      say('1 · Four people, one table', 'They are all talking at once. Each one sits in a different place around “You”.');
      await wait(6500);

      $('[data-mode="mono"]').click();
      say('2 · A normal call', 'The same four voices, all coming from one place. Hard to tell who is who.');
      await wait(7000);

      $('[data-mode="spatial"]').click();
      say('3 · Around the table', 'Now each voice has its own place. A voice on your right is louder in your RIGHT ear: watch the two bars.');
      await wait(7500);

      selected = 'aarav'; draw();
      moveSeat(person('aarav'), -90, 1.5);
      say('4 · Aarav walks across', 'From far left to far right. The LEFT bar falls while the RIGHT bar grows.');
      await wait(900);
      await tween(7000, k => moveSeat(person('aarav'), Math.round((-90 + 180 * k) / 15) * 15, 1.5));
      moveSeat(person('aarav'), SEATS.aarav, 1.5); draw();

      selected = 'kabir'; draw();
      say('5 · Kabir moves away', 'Farther voices are quieter and sound more distant. Look at the metres next to his name.');
      await tween(4000, k => moveSeat(person('kabir'), 60, Math.round((1.5 + 2 * k) * 4) / 4));
      await wait(1200);
      await tween(3000, k => moveSeat(person('kabir'), 60, Math.round((3.5 - 2 * k) * 4) / 4));
      draw();

      say('6 · You turn your head', 'The room stays still, so every voice swings around you. Watch the captions: “front right” becomes “in front of you”.');
      await tween(4000, k => Live.setHead(Math.round(90 * k / 5) * 5));
      await wait(1800);
      await tween(4000, k => Live.setHead(Math.round((90 - 180 * k) / 5) * 5));
      await wait(1200);
      await tween(2000, k => Live.setHead(Math.round((-90 + 90 * k) / 5) * 5));

      selected = 'diya'; draw();
      say('7 · One voice circles you', 'Diya goes all the way around your head. Listen for her passing in front, at the sides and behind.');
      Live.setOrbit(true);
      await wait(9000);
      Live.setOrbit(false);

      say('That is the idea', 'Every voice gets its own place, so you can follow one person in a crowd. Now try dragging someone yourself.');
      await wait(4500);
    } catch (e) {
      if (!(e instanceof Stopped)) { say('The tour stopped', e.message || 'Something went wrong.'); await sleep(2500); }
    } finally {
      {
        running = false;
        Live.setOrbit(false);
        people.forEach((p, i) => Object.assign(p, { distance: undefined }, saved.people[i]));
        selected = saved.selected; focusId = saved.focusId;
        Live.setHead(saved.head);
        if (saved.spatial !== spatial) $(`[data-mode="${saved.spatial ? 'spatial' : 'mono'}"]`).click();
        draw(); Live.sync();
        bar().hidden = true; $('#demo-start').textContent = '★  Guided tour';
      }
    }
  }
  // The running tour notices this within a fraction of a second, puts the table back as it was and hides the captions.
  function stop() { running = false; }

  document.addEventListener('DOMContentLoaded', () => {
    $('#demo-start').onclick = run; $('#demo-stop').onclick = () => { stop(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && running) stop(); });
    document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { if (running && b.dataset.page !== 'studio') stop(); }));
  });
  return { run, stop, get running() { return running; } };
})();

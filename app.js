/**
 * Scanner application logic.
 *
 * Design rule that drives everything below: a scan is decided against the local
 * roster in IndexedDB and never waits on the network. The write to HubSpot is
 * queued and drained in the background. See docs/DECISIONS.md.
 */
(() => {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  const state = {
    session: null,
    device: null,
    roster: [],
    byToken: new Map(),
    scanning: false,
    videoStream: null,
    detector: null,
    lastScanValue: null,
    lastScanAt: 0,
    draining: false,
    retryDelay: CFG.queueRetryBaseMs,
    filter: 'all',
    confirmResolve: null,
  };

  /* ------------------------------------------------------------------ utils */

  const nowIso = () => new Date().toISOString();

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const timeOnly = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  function beep(ok) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
      setTimeout(() => ctx.close(), 600);
    } catch (_) {
      /* audio is a nicety, never a failure */
    }
  }

  const buzz = (ms) => navigator.vibrate && navigator.vibrate(ms);

  /* ------------------------------------------------------------------- api */

  async function call(path, { method = 'GET', body = null, auth = true } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && state.session) headers['X-Session-Token'] = state.session;

    const res = await fetch(CFG.n8nBase + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      signOut('Session expired — sign in again.');
      throw new Error('unauthorized');
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(`bad response from server (${res.status})`);
    }
    if (!res.ok) throw new Error((json && json.message) || `server error ${res.status}`);
    return json;
  }

  /* --------------------------------------------------------------- screens */

  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(`screen-${name}`).classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
    if (name !== 'scan') stopCamera();
    if (name === 'list') renderDoorList();
    if (name === 'settings') $('settings-device').textContent = state.device || '—';
  }

  function setSignedIn(on) {
    $('tabs').hidden = !on;
    $('statusbar').hidden = !on;
    $('btn-menu').hidden = !on;
  }

  function signOut(message) {
    localStorage.removeItem('session');
    localStorage.removeItem('device');
    state.session = null;
    state.device = null;
    setSignedIn(false);
    show('login');
    $('login-error').textContent = message || '';
  }

  /* ---------------------------------------------------------------- roster */

  async function loadRosterFromDb() {
    state.roster = await DB.allAttendees();
    state.byToken = new Map(state.roster.map((a) => [a.token, a]));
    renderStatus();
    renderPrepare();
  }

  async function downloadRoster() {
    $('prepare-msg').textContent = 'Downloading…';
    try {
      const data = await call(CFG.endpoints.roster);
      await DB.replaceRoster(data.attendees || []);
      await DB.setMeta('rosterSyncedAt', nowIso());
      await loadRosterFromDb();
      $('prepare-msg').textContent = `Door list ready — ${state.roster.length} attendees.`;
    } catch (err) {
      $('prepare-msg').textContent = `Could not download: ${err.message}`;
    }
  }

  async function renderPrepare() {
    const syncedAt = await DB.getMeta('rosterSyncedAt');
    $('roster-count').textContent = state.roster.length;
    $('roster-synced').textContent = syncedAt ? new Date(syncedAt).toLocaleString() : 'never';
    $('roster-warning').style.display = state.roster.length ? 'none' : 'block';
  }

  const isCheckedIn = (a) => Boolean(a.local_checked_in_at || a.checked_in_at);
  const checkedInAt = (a) => a.local_checked_in_at || a.checked_in_at;

  async function renderStatus() {
    const total = state.roster.length;
    const inCount = state.roster.filter(isCheckedIn).length;
    const queued = await DB.queueCount();
    $('status-counts').textContent = `Checked in: ${inCount} / ${total}`;
    $('status-queue').textContent = `Queue: ${queued}`;
    $('status-queue').classList.toggle('pending', queued > 0);
    const online = navigator.onLine;
    $('status-net').textContent = online ? 'Online' : 'Offline';
    $('status-net').className = online ? 'online' : 'offline';
  }

  /* ------------------------------------------------------------- check-ins */

  /**
   * Decide a scan locally, then queue the write. Returns the result kind so the
   * caller can paint the screen.
   */
  async function checkIn(token, method) {
    const attendee = state.byToken.get(token);
    if (!attendee) return { kind: 'unknown' };
    if (attendee.status === 'cancelled') return { kind: 'cancelled', attendee };
    if (isCheckedIn(attendee)) return { kind: 'already', attendee };

    const scannedAt = nowIso();
    attendee.local_checked_in_at = scannedAt;
    attendee.local_device = state.device;
    attendee.local_method = method;
    await DB.putAttendee(attendee);

    await DB.enqueue({
      scan_id: uuid(),
      action: 'checkin',
      token,
      scanned_at: scannedAt,
      method,
      device: state.device,
    });

    renderStatus();
    drainQueue();
    return { kind: 'ok', attendee };
  }

  async function undoCheckIn(token) {
    const attendee = state.byToken.get(token);
    if (!attendee || !isCheckedIn(attendee)) return;
    delete attendee.local_checked_in_at;
    delete attendee.local_device;
    delete attendee.local_method;
    attendee.checked_in_at = null;
    attendee.status = 'registered';
    await DB.putAttendee(attendee);
    await DB.enqueue({
      scan_id: uuid(),
      action: 'undo',
      token,
      scanned_at: nowIso(),
      method: 'manual_search',
      device: state.device,
    });
    renderStatus();
    renderDoorList();
    drainQueue();
  }

  /** Push queued jobs to n8n. Safe to call often; only one drain runs at a time. */
  async function drainQueue() {
    if (state.draining || !navigator.onLine || !state.session) return;
    const jobs = await DB.queueAll();
    if (!jobs.length) {
      state.retryDelay = CFG.queueRetryBaseMs;
      return;
    }

    state.draining = true;
    try {
      const data = await call(CFG.endpoints.checkin, { method: 'POST', body: { scans: jobs } });
      for (const r of (data && data.results) || []) {
        await DB.dequeue(r.scan_id);
        // The server is authoritative on who got there first: adopt its
        // timestamp and device so every phone tells the guest the same story.
        if (r.result === 'already_checked_in') {
          const a = state.byToken.get(r.token);
          if (a) {
            a.checked_in_at = r.checked_in_at || a.checked_in_at;
            a.local_checked_in_at = r.checked_in_at || a.local_checked_in_at;
            a.local_device = r.device || a.local_device;
            await DB.putAttendee(a);
          }
        }
      }
      state.retryDelay = CFG.queueRetryBaseMs;
    } catch (_) {
      state.retryDelay = Math.min(state.retryDelay * 2, CFG.queueRetryMaxMs);
      setTimeout(drainQueue, state.retryDelay);
    } finally {
      state.draining = false;
      renderStatus();
    }
  }

  /* --------------------------------------------------------------- results */

  let resultTimer = null;

  function paintResult(result) {
    const box = $('result');
    const map = {
      ok: { cls: 'ok', icon: '✓', note: 'Checked in' },
      already: { cls: 'warn', icon: '◷', note: 'Already checked in' },
      unknown: { cls: 'bad', icon: '✕', note: 'Not found — search by name instead' },
      cancelled: { cls: 'bad', icon: '✕', note: 'Registration cancelled' },
    };
    const style = map[result.kind];
    const a = result.attendee;

    box.className = `result ${style.cls}`;
    $('result-icon').textContent = style.icon;
    $('result-name').textContent = a ? `${a.first_name || ''} ${a.last_name || ''}`.trim() : 'Unknown code';
    $('result-company').textContent = (a && a.company) || '';
    $('result-note').textContent =
      result.kind === 'already'
        ? `Already checked in at ${timeOnly(checkedInAt(a))}${a.local_device ? `, ${a.local_device}` : ''}`
        : style.note;
    box.hidden = false;

    const good = result.kind === 'ok';
    beep(good);
    buzz(good ? 60 : [40, 60, 40]);

    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      box.hidden = true;
    }, CFG.resultDismissMs);
  }

  /* ---------------------------------------------------------------- camera */

  async function startCamera() {
    if (state.scanning) return;
    try {
      state.videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (err) {
      alert(`Camera unavailable: ${err.message}\n\nCheck browser permissions, then reload. On iPhone use Safari directly.`);
      return;
    }

    const video = $('video');
    video.srcObject = state.videoStream;
    video.setAttribute('playsinline', '');
    // Deliberately not awaited: play() can hang or reject (backgrounded view,
    // iOS autoplay rules) and must not block the scan loop from starting. The
    // loop waits on readyState instead.
    video.play().catch(() => {});

    $('btn-start-camera').hidden = true;
    state.scanning = true;

    if ('BarcodeDetector' in window && !state.detector) {
      try {
        state.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (_) {
        state.detector = null;
      }
    }
    scanTick();
  }

  function stopCamera() {
    state.scanning = false;
    if (state.videoStream) {
      state.videoStream.getTracks().forEach((t) => t.stop());
      state.videoStream = null;
    }
    $('btn-start-camera').hidden = false;
  }

  async function scanTick() {
    if (!state.scanning) return;
    const video = $('video');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      let value = null;
      if (state.detector) {
        try {
          const codes = await state.detector.detect(video);
          if (codes.length) value = codes[0].rawValue;
        } catch (_) {
          state.detector = null; // fall through to jsQR from now on
        }
      }
      if (!value) value = decodeWithJsQr(video);
      if (value) await onCode(value.trim());
    }
    // setTimeout, not requestAnimationFrame: rAF stops in a backgrounded or
    // embedded view, which would show a live preview that silently scans
    // nothing. ~12 fps is plenty for a QR held in front of a phone.
    setTimeout(scanTick, 80);
  }

  function decodeWithJsQr(video) {
    const canvas = $('frame');
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Downscale: jsQR on a full 1080p frame is too slow for a live preview.
    const scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return code ? code.data : null;
  }

  /**
   * Our own QR holds the bare token. Codes minted by other tooling may hold a
   * URL with the token in a query parameter — accept those too rather than
   * telling a guest with a valid code that they are not on the list.
   */
  function tokenFromScan(value) {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const params = new URL(value).searchParams;
      for (const key of ['t', 'token', 'code']) {
        const found = params.get(key);
        if (found) return found;
      }
    } catch (_) {
      /* not a parseable URL — fall through and try it as a raw token */
    }
    return value;
  }

  async function onCode(rawValue) {
    const value = tokenFromScan(rawValue);
    const now = Date.now();
    if (value === state.lastScanValue && now - state.lastScanAt < CFG.resultDismissMs) return;
    state.lastScanValue = value;
    state.lastScanAt = now;
    paintResult(await checkIn(value, 'qr'));
  }

  /* ---------------------------------------------------------------- search */

  function renderSearch() {
    const q = $('search-input').value.trim().toLowerCase();
    const ul = $('search-results');
    ul.innerHTML = '';
    if (q.length < 2) return;

    const matches = state.roster
      .filter((a) => a.search && a.search.includes(q))
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))
      .slice(0, 30);

    for (const a of matches) ul.appendChild(personRow(a, 'search'));
    if (!matches.length) {
      const li = document.createElement('li');
      li.textContent = 'No match on this device. Check the printed list.';
      ul.appendChild(li);
    }
  }

  function personRow(a, context) {
    const li = document.createElement('li');

    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('b');
    name.textContent = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email;
    const meta = document.createElement('span');
    meta.textContent = [a.company, a.short_code].filter(Boolean).join(' · ');
    who.append(name, meta);

    const cancelled = a.status === 'cancelled';
    const badge = document.createElement('span');
    badge.className = `badge ${isCheckedIn(a) ? 'in' : 'out'}`;
    badge.textContent = cancelled ? '✕ Cancelled' : isCheckedIn(a) ? `✓ ${timeOnly(checkedInAt(a))}` : 'Not in';

    // A cancelled registration gets no check-in button — the desk should send
    // that person to whoever can re-open the registration, not quietly admit them.
    if (cancelled) {
      li.append(who, badge);
      return li;
    }

    const btn = document.createElement('button');
    if (isCheckedIn(a)) {
      btn.textContent = 'Undo';
      btn.onclick = async () => {
        const yes = await confirmSheet('Undo check-in?', `${name.textContent} will go back to “registered”.`);
        if (yes) undoCheckIn(a.token);
      };
    } else {
      btn.textContent = 'Check in';
      btn.onclick = async () => {
        const yes = await confirmSheet('Check in?', `${name.textContent}${a.company ? ` — ${a.company}` : ''}`);
        if (!yes) return;
        const method = context === 'search' && $('search-input').value.trim().toUpperCase() === (a.short_code || '')
          ? 'short_code'
          : 'manual_search';
        const result = await checkIn(a.token, method);
        paintResult(result);
        renderSearch();
        renderDoorList();
      };
    }

    li.append(who, badge, btn);
    return li;
  }

  function renderDoorList() {
    const ul = $('door-list');
    ul.innerHTML = '';
    const rows = state.roster
      .filter((a) =>
        state.filter === 'all' ? true : state.filter === 'in' ? isCheckedIn(a) : !isCheckedIn(a)
      )
      .sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    for (const a of rows) ul.appendChild(personRow(a, 'list'));
  }

  /* --------------------------------------------------------------- confirm */

  function confirmSheet(title, text) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm').hidden = false;
    return new Promise((resolve) => {
      state.confirmResolve = resolve;
    });
  }

  function closeConfirm(answer) {
    $('confirm').hidden = true;
    if (state.confirmResolve) state.confirmResolve(answer);
    state.confirmResolve = null;
  }

  /* ------------------------------------------------------------------ wire */

  async function login() {
    const device = $('device').value.trim();
    const pin = $('pin').value.trim();
    $('login-error').textContent = '';
    if (!device || !pin) {
      $('login-error').textContent = 'Device label and PIN are both required.';
      return;
    }
    try {
      const data = await call(CFG.endpoints.auth, {
        method: 'POST',
        body: { pin, device },
        auth: false,
      });
      state.session = data.session_token;
      state.device = device;
      localStorage.setItem('session', state.session);
      localStorage.setItem('device', device);
      $('pin').value = '';
      setSignedIn(true);
      await loadRosterFromDb();
      show(state.roster.length ? 'scan' : 'prepare');
    } catch (err) {
      $('login-error').textContent =
        err.message === 'unauthorized' ? 'Wrong PIN.' : `Could not sign in: ${err.message}`;
    }
  }

  function wire() {
    $('event-name').textContent = `${CFG.eventName} · ${CFG.eventDate}`;

    $('btn-login').onclick = login;
    $('pin').addEventListener('keydown', (e) => e.key === 'Enter' && login());

    $('btn-roster').onclick = downloadRoster;
    $('btn-resync').onclick = () => {
      show('prepare');
      downloadRoster();
    };
    $('btn-to-scan').onclick = () => show('scan');
    $('btn-start-camera').onclick = startCamera;
    $('btn-menu').onclick = () => show('settings');
    $('btn-logout').onclick = () => signOut();

    $('btn-clear').onclick = async () => {
      const queued = await DB.queueCount();
      const warn = queued
        ? `${queued} scan(s) have NOT reached HubSpot yet. They will be lost.`
        : 'The door list and all local scan data will be removed from this device.';
      if (await confirmSheet('Clear local data?', warn)) {
        await DB.clearAll();
        await loadRosterFromDb();
        show('prepare');
      }
    };

    $('confirm-yes').onclick = () => closeConfirm(true);
    $('confirm-no').onclick = () => closeConfirm(false);

    $('search-input').addEventListener('input', renderSearch);

    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => show(t.dataset.screen);
    });

    document.querySelectorAll('.filter').forEach((f) => {
      f.onclick = () => {
        document.querySelectorAll('.filter').forEach((x) => x.classList.remove('active'));
        f.classList.add('active');
        state.filter = f.dataset.filter;
        renderDoorList();
      };
    });

    // Staff lock the phone between guests. Release the camera when the page is
    // hidden (battery, and iOS reclaims it anyway) and bring it back on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state.scanning) {
          state.resumeCamera = true;
          stopCamera();
        }
      } else if (state.resumeCamera) {
        state.resumeCamera = false;
        if ($('screen-scan').classList.contains('active')) startCamera();
      }
    });

    window.addEventListener('online', () => {
      renderStatus();
      drainQueue();
    });
    window.addEventListener('offline', renderStatus);
    setInterval(drainQueue, 15000);
    setInterval(renderStatus, 5000);
  }

  async function boot() {
    wire();
    state.session = localStorage.getItem('session');
    state.device = localStorage.getItem('device');

    if (state.session) {
      setSignedIn(true);
      await loadRosterFromDb();
      show(state.roster.length ? 'scan' : 'prepare');
      drainQueue();
    } else {
      show('login');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})();

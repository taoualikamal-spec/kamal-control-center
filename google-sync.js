/* Up Again — sending the routine to Google Calendar.
   The app asks Google for one narrow permission: to make its own calendar
   ("Up Again") and manage the events in it. It cannot read or change any
   other calendar. The sign-in token lives in memory only and is never saved;
   your data goes from this phone straight to Google, with no server between. */

// Public by design: a web sign-in client ID is not a secret. It can also be
// pasted on the Routine page, so a new one needs no code change.
const GOOGLE_CLIENT_ID = '';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';

let googleToken = null; // { value, expiresAt }

function googleClientId(routine) { return GOOGLE_CLIENT_ID || (routine && routine.google.clientId) || ''; }

function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not reach Google. Are you online?'));
    document.head.appendChild(script);
  });
}

// Opens Google's own sign-in window. Must be called from a tap.
async function getGoogleToken(clientId, firstTime) {
  if (googleToken && googleToken.expiresAt > Date.now() + 60000) return googleToken.value;
  await loadGoogleScript();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) { reject(new Error(response.error_description || response.error || 'Google did not allow it.')); return; }
        googleToken = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000 };
        resolve(googleToken.value);
      },
      error_callback: error => reject(new Error(error && error.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in did not finish.'))
    });
    client.requestAccessToken({ prompt: firstTime ? 'consent' : '' });
  });
}

function forgetGoogleToken() {
  if (googleToken && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(googleToken.value, () => {});
  googleToken = null;
}

async function googleRequest(fetchFn, token, method, path, body) {
  const response = await fetchFn(`${GOOGLE_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && data.error && data.error.message) || `Google answered ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// Runs jobs a few at a time, so a first sync of ~150 events stays polite.
async function runLimited(jobs, limit = 4) {
  const results = [];
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const index = next++; results[index] = await jobs[index](); } };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

/* Brings the Up Again calendar in line with `desired` ({key, event, sig}[]).
   `store` is routine.google; it is updated in place with what was sent.
   Returns counts of what changed. */
async function syncGoogleCalendar({ fetchFn, token, desired, store, todayDate, onProgress = () => {} }) {
  const encode = encodeURIComponent;
  if (store.calendarId) {
    try { await googleRequest(fetchFn, token, 'GET', `/calendars/${encode(store.calendarId)}`); }
    catch (error) { if (error.status === 403 || error.status === 404 || error.status === 410) { store.calendarId = ''; store.events = {}; } else throw error; }
  }
  if (!store.calendarId) {
    const calendar = await googleRequest(fetchFn, token, 'POST', '/calendars', { summary: 'Up Again', description: 'Your routine and prayer times, from the Up Again app.', timeZone: ROUTINE_TZ });
    store.calendarId = calendar.id;
    store.events = {};
  }
  const cal = `/calendars/${encode(store.calendarId)}/events`;
  const plan = syncPlan(desired, store.events, todayDate);
  const total = plan.create.length + plan.update.length + plan.remove.length;
  let done = 0;
  const tick = () => onProgress(++done, total);

  const insert = async item => {
    const created = await googleRequest(fetchFn, token, 'POST', cal, item.event);
    store.events[item.key] = { id: created.id, sig: item.sig };
    tick();
  };
  const jobs = [
    ...plan.create.map(item => () => insert(item)),
    ...plan.update.map(item => async () => {
      try {
        await googleRequest(fetchFn, token, 'PUT', `${cal}/${encode(item.id)}`, item.event);
        store.events[item.key] = { id: item.id, sig: item.sig };
        tick();
      } catch (error) {
        // Deleted by hand in Google Calendar: make it again.
        if (error.status === 404 || error.status === 410) { done--; await insert(item); } else throw error;
      }
    }),
    ...plan.remove.map(item => async () => {
      try { await googleRequest(fetchFn, token, 'DELETE', `${cal}/${encode(item.id)}`); }
      catch (error) { if (error.status !== 404 && error.status !== 410) throw error; }
      delete store.events[item.key];
      tick();
    })
  ];
  plan.forget.forEach(key => { delete store.events[key]; });
  await runLimited(jobs);
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}

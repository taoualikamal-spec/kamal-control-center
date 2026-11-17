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
    const timer = setTimeout(() => reject(new Error('The Google window did not answer. Close it and tap again. If it keeps happening, open the app in Chrome instead of the installed app.')), 120000);
    const finish = (fn, value) => { clearTimeout(timer); fn(value); };
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) { finish(reject, new Error(response.error_description || response.error || 'Google did not allow it.')); return; }
        googleToken = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000 };
        finish(resolve, googleToken.value);
      },
      error_callback: error => finish(reject, new Error(
        error && error.type === 'popup_closed' ? 'The Google window was closed before it finished.'
        : error && error.type === 'popup_failed_to_open' ? 'The phone blocked the Google window. Allow pop-ups for this site, or open the app in Chrome.'
        : 'Google sign-in did not finish.'))
    });
    client.requestAccessToken({ prompt: firstTime ? 'consent' : '' });
  });
}

function forgetGoogleToken() {
  if (googleToken && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(googleToken.value, () => {});
  googleToken = null;
}

// An object (and a var, so it is reachable from tests) so tests can make the waiting instant.
var googleTiming = { wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const RETRY_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError'];

function googleError(response, data) {
  const reason = data && data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason || '';
  const message = reason === 'calendarUsageLimitsExceeded'
    ? 'Google paused new events for a while (too many at once). What was sent is kept. Try again in an hour.'
    : response.status === 401 ? 'The Google sign-in ran out. Tap again to sign in.'
    : (data && data.error && data.error.message) || `Google answered ${response.status}.`;
  const error = new Error(message);
  error.status = response.status;
  error.reason = reason;
  error.retry = response.status === 429 || response.status >= 500 || (response.status === 403 && RETRY_REASONS.includes(reason));
  return error;
}

async function googleRequest(fetchFn, token, method, path, body, tries = 6) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchFn(`${GOOGLE_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      if (attempt + 1 >= tries) throw new Error('No connection to Google. Check the internet and tap again; what was sent is kept.');
      await googleTiming.wait(1000 * 2 ** attempt);
      continue;
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (response.ok) return data;
    const error = googleError(response, data);
    if (!error.retry || attempt + 1 >= tries) throw error;
    await googleTiming.wait(1000 * 2 ** attempt + Math.random() * 500);
  }
}

// Runs jobs a few at a time, so a first sync of ~150 events stays polite.
async function runLimited(jobs, limit = 2) {
  const results = [];
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < jobs.length && !failed) {
      const index = next++;
      try { results[index] = await jobs[index](); } catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

const UP_AGAIN_CALENDAR = { summary: 'Up Again', description: 'Your routine and prayer times, from the Up Again app.' };

/* Other "Up Again" calendars this app made (from sends that were cut off
   before the phone saved them). Only calendars with this app's exact name
   and description are touched. Returns how many were removed, or -1 when
   Google does not let the app see the calendar list. */
async function removeExtraCalendars(fetchFn, token, keepId) {
  let list;
  try { list = await googleRequest(fetchFn, token, 'GET', '/users/me/calendarList?maxResults=250&fields=items(id,summary,description)'); }
  catch (error) { if (error.status === 401) throw error; return -1; }
  let removed = 0;
  for (const calendar of (list && list.items) || []) {
    if (calendar.id === keepId || calendar.summary !== UP_AGAIN_CALENDAR.summary || calendar.description !== UP_AGAIN_CALENDAR.description) continue;
    try { await googleRequest(fetchFn, token, 'DELETE', `/calendars/${encodeURIComponent(calendar.id)}`); removed++; }
    catch (error) { if (error.status === 401) throw error; }
  }
  return removed;
}

/* Reads every event in the Up Again calendar and matches them to the app's
   own list by their hidden tag: one is kept for each tag, copies are
   deleted, and events the phone had lost track of are taken back instead
   of being sent again. Events without a tag (added by hand) are left alone. */
async function reconcileGoogleEvents(fetchFn, token, store) {
  const cal = `/calendars/${encodeURIComponent(store.calendarId)}/events`;
  const found = [];
  let pageToken = '';
  do {
    const page = await googleRequest(fetchFn, token, 'GET', `${cal}?maxResults=2500&showDeleted=false&fields=items(id,extendedProperties),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    found.push(...((page && page.items) || []));
    pageToken = (page && page.nextPageToken) || '';
  } while (pageToken);
  const byKey = new Map();
  found.forEach(event => {
    const key = event.extendedProperties && event.extendedProperties.private && event.extendedProperties.private.upAgain;
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(event.id);
  });
  const extra = [];
  byKey.forEach((ids, key) => {
    const known = store.events[key];
    const keep = known && ids.includes(known.id) ? known.id : ids[0];
    // Taken back with an empty signature, so the next step rewrites it to match the app.
    if (!known || known.id !== keep) store.events[key] = { id: keep, sig: '' };
    ids.filter(id => id !== keep).forEach(id => extra.push(id));
  });
  // Remembered but gone from Google: forget, so it is made again.
  Object.keys(store.events).forEach(key => { if (!byKey.has(key)) delete store.events[key]; });
  await runLimited(extra.map(id => async () => {
    try { await googleRequest(fetchFn, token, 'DELETE', `${cal}/${encodeURIComponent(id)}`); }
    catch (error) { if (error.status !== 404 && error.status !== 410) throw error; }
  }));
  return extra.length;
}

/* Brings the Up Again calendar in line with `desired` ({key, event, sig}[]).
   `store` is routine.google; it is updated in place with what was sent.
   `onSave` is called whenever there is something worth keeping right away.
   Returns counts of what changed. */
async function syncGoogleCalendar({ fetchFn, token, desired, store, todayDate, onProgress = () => {}, onSave = () => {} }) {
  const encode = encodeURIComponent;
  if (store.calendarId) {
    try { await googleRequest(fetchFn, token, 'GET', `/calendars/${encode(store.calendarId)}`); }
    catch (error) { if (error.status === 403 || error.status === 404 || error.status === 410) { store.calendarId = ''; store.events = {}; } else throw error; }
  }
  if (!store.calendarId) {
    const calendar = await googleRequest(fetchFn, token, 'POST', '/calendars', { ...UP_AGAIN_CALENDAR, timeZone: ROUTINE_TZ });
    store.calendarId = calendar.id;
    store.events = {};
    onSave(); // saved at once: a send cut off now must never make a second calendar
  }
  const extraCalendars = await removeExtraCalendars(fetchFn, token, store.calendarId);
  const duplicates = await reconcileGoogleEvents(fetchFn, token, store);
  onSave();
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
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, duplicates, extraCalendars };
}

/* Up Again — the insight engine.
 *
 * Pure functions: give them the stored data, get back findings. No DOM, no
 * state of its own, so every rule can be tested against an invented history.
 *
 * One person produces very little data, so there is no model here and there
 * should never be one. Just counts, with a minimum number of observations
 * before anything is allowed on screen, and the count shown next to every
 * claim so the reader can weigh it themselves.
 */
(function (global) {
  'use strict';

  // Observations needed before a claim is shown. Each side of a comparison
  // needs its own, so "strong vs mild" needs MIN_GROUP of each.
  const MIN = 5;
  const MIN_GROUP = 5;
  const MIN_FOCUS_ENTRIES = 10;

  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);

  const average = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);

  function countBy(values) {
    const counts = {};
    values.filter(Boolean).forEach(value => { counts[value] = (counts[value] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  const clockMinutes = time => {
    const [hours, mins] = String(time || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
  };
  const clockText = total => {
    const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  };
  const hoursText = minutes => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  function sleepLength(sleep) {
    const start = clockMinutes(sleep && sleep.toBed);
    const end = clockMinutes(sleep && sleep.wokeAt);
    if (start === null || end === null) return 0;
    return (end <= start ? end + 1440 : end) - start;
  }

  function timeOfDayBand(iso) {
    const hour = new Date(iso).getHours();
    if (hour < 6) return 'late at night';
    if (hour < 12) return 'in the morning';
    if (hour < 18) return 'in the afternoon';
    return 'in the evening';
  }

  function weekdayName(date) {
    return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
  }

  // A finding carries its own evidence. `ready` false means the UI should say
  // what is coming and how much more is needed, never the claim itself.
  function finding(id, area, text, count, need) {
    return { id, area, text, count, need, ready: count >= need };
  }

  function waitSeconds(cravings) {
    return cravings
      .filter(entry => entry.outcome === 'rode' && Number(entry.secondsSurfed) > 0)
      .map(entry => Number(entry.secondsSurfed));
  }

  /* How long this person actually needs, rather than a fixed five minutes.
     Uses a high point of their own waits so the timer covers most of them. */
  function personalWaitSeconds(state, fallback) {
    const waits = waitSeconds(state.cravings || []).sort((a, b) => a - b);
    if (waits.length < 3) return fallback;
    const high = waits[Math.min(waits.length - 1, Math.floor(waits.length * 0.75))];
    return Math.max(180, Math.min(600, Math.ceil(high / 60) * 60));
  }

  /* Options ordered by how often this person actually picks them, so the
     likely answer is the first one they see. */
  function rankedOptions(allOptions, usedValues) {
    const counts = {};
    usedValues.filter(Boolean).forEach(value => { counts[value] = (counts[value] || 0) + 1; });
    return allOptions.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  }

  function mostLikely(usedValues) {
    const ranked = countBy(usedValues);
    return ranked.length ? ranked[0][0] : '';
  }

  function urgeFindings(state) {
    const cravings = state.cravings || [];
    const total = cravings.length;
    const out = [];

    const reason = countBy(cravings.map(entry => entry.trigger))[0];
    if (reason) {
      out.push(finding('urge-reason', 'urges',
        `It starts with <b>${escapeHtml(String(reason[0]).toLowerCase())}</b> more than anything else.`,
        total, MIN));
    }

    const band = countBy(cravings.map(entry => timeOfDayBand(entry.createdAt)))[0];
    if (band) {
      out.push(finding('urge-time', 'urges',
        `It happens most often <b>${escapeHtml(band[0])}</b>.`, total, MIN));
    }

    const waits = waitSeconds(cravings).map(seconds => Math.max(1, Math.round(seconds / 60)));
    if (waits.length) {
      out.push(finding('urge-wait', 'urges',
        `When you waited, you usually needed about <b>${Math.round(average(waits))} minutes</b>. The longest was ${Math.max(...waits)}.`,
        waits.length, MIN));
    }

    const rode = cravings.filter(entry => entry.outcome === 'rode' && Number(entry.secondsSurfed) > 0);
    const strong = rode.filter(entry => Number(entry.intensity) >= 4).map(entry => entry.secondsSurfed / 60);
    const mild = rode.filter(entry => Number(entry.intensity) <= 3).map(entry => entry.secondsSurfed / 60);
    if (strong.length && mild.length) {
      const close = Math.abs(average(strong) - average(mild)) < 1.5;
      const text = close
        ? `A <b>strong</b> want took about ${average(strong).toFixed(1)} min to pass and a mild one about ${average(mild).toFixed(1)} min. Strong or mild, it passes in about the same time — a strong one is not more dangerous, it just feels louder.`
        : `A <b>strong</b> want took about ${average(strong).toFixed(1)} min to pass, a mild one about ${average(mild).toFixed(1)} min.`;
      out.push(finding('urge-strength', 'urges', text, Math.min(strong.length, mild.length), MIN_GROUP));
    }

    const tags = countBy(cravings.flatMap(entry => (entry.debrief && entry.debrief.gaveTags) || []));
    if (tags.length) {
      const tagTotal = tags.reduce((sum, item) => sum + item[1], 0);
      out.push(finding('urge-help', 'urges',
        `Most of all, it helps you <b>${escapeHtml(String(tags[0][0]).toLowerCase())}</b>. If you can find another way to do that, the want gets weaker on its own.`,
        tagTotal, MIN));
    }

    return out;
  }

  function timeFindings(state) {
    const entries = state.timeEntries || [];
    const out = [];

    const lost = entries.filter(entry => entry.type === 'stolen');
    const lostTop = countBy(lost.map(entry => entry.category))[0];
    if (lostTop) {
      out.push(finding('time-lost', 'time',
        `Most of your lost time goes to <b>${escapeHtml(String(lostTop[0]).toLowerCase())}</b>.`,
        lost.length, MIN));
    }

    const focus = entries.filter(entry => entry.type === 'focus');
    if (focus.length) {
      const byDay = {};
      focus.forEach(entry => {
        const day = weekdayName(entry.date);
        byDay[day] = (byDay[day] || 0) + Number(entry.minutes);
      });
      const best = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
      if (best) {
        out.push(finding('time-best-day', 'time',
          `Your focus lands best on a <b>${escapeHtml(best[0])}</b> — about ${Math.round(best[1] / 60)} hours so far.`,
          focus.length, MIN_FOCUS_ENTRIES));
      }
      const focusTop = countBy(focus.map(entry => entry.category))[0];
      if (focusTop) {
        out.push(finding('time-focus-kind', 'time',
          `Most of your focus time goes to <b>${escapeHtml(String(focusTop[0]).toLowerCase())}</b>.`,
          focus.length, MIN));
      }
    }

    return out;
  }

  /* Sleep. The split is this person's OWN median night, never an outside
     "you should sleep 8 hours" — the question is what a longer night does
     for THEM, which is a question their own data can actually answer. */
  function sleepFindings(state) {
    const days = state.days || {};
    const out = [];
    const nights = Object.keys(days)
      .map(date => ({ date, sleep: days[date].sleep }))
      .filter(item => item.sleep && item.sleep.toBed && item.sleep.wokeAt)
      .map(item => ({ date: item.date, minutes: sleepLength(item.sleep), wake: clockMinutes(item.sleep.wokeAt) }))
      .filter(item => item.minutes > 0);

    if (!nights.length) return out;

    const mean = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
    const averageWake = mean(nights.map(item => item.wake));
    const spread = Math.round(mean(nights.map(item => Math.abs(item.wake - averageWake))));

    out.push(finding('sleep-average', 'sleep',
      `You sleep about <b>${hoursText(Math.round(mean(nights.map(item => item.minutes))))}</b> a night.`,
      nights.length, MIN));
    out.push(finding('sleep-steady', 'sleep',
      `You wake around <b>${clockText(averageWake)}</b>, give or take ${spread} minutes.`,
      nights.length, MIN));

    const sorted = nights.map(item => item.minutes).slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const longer = nights.filter(item => item.minutes >= median).map(item => item.date);
    const shorter = nights.filter(item => item.minutes < median).map(item => item.date);

    const focusOn = dates => {
      const set = new Set(dates);
      return (state.timeEntries || []).filter(entry => entry.type === 'focus' && set.has(entry.date))
        .reduce((sum, entry) => sum + Number(entry.minutes), 0) / Math.max(1, dates.length);
    };
    const waitedOn = dates => {
      const set = new Set(dates);
      return (state.cravings || []).filter(entry => entry.outcome === 'rode' && set.has(entry.date)).length / Math.max(1, dates.length);
    };

    if (longer.length && shorter.length) {
      const pair = Math.min(longer.length, shorter.length);
      out.push(finding('sleep-focus', 'sleep',
        `After your longer nights you focused about <b>${Math.round(focusOn(longer))} min</b> the next day. After the shorter ones, about ${Math.round(focusOn(shorter))} min.`,
        pair, MIN_GROUP));
      out.push(finding('sleep-urges', 'sleep',
        `After your longer nights you waited out <b>${waitedOn(longer).toFixed(1)}</b> wants a day. After the shorter ones, ${waitedOn(shorter).toFixed(1)}.`,
        pair, MIN_GROUP));
    }
    return out;
  }

  function compute(state) {
    const dismissed = state.dismissedInsights || [];
    return [].concat(urgeFindings(state), timeFindings(state), sleepFindings(state))
      .filter(item => dismissed.indexOf(item.id) === -1);
  }

  function forArea(state, area) {
    return compute(state).filter(item => item.area === area);
  }

  global.Insights = {
    compute, forArea, personalWaitSeconds, rankedOptions, mostLikely,
    timeOfDayBand, countBy, sleepLength,
    thresholds: { MIN, MIN_GROUP, MIN_FOCUS_ENTRIES }
  };
})(typeof window !== 'undefined' ? window : globalThis);

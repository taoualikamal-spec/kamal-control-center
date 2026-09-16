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

  function compute(state) {
    const dismissed = state.dismissedInsights || [];
    return [].concat(urgeFindings(state), timeFindings(state))
      .filter(item => dismissed.indexOf(item.id) === -1);
  }

  function forArea(state, area) {
    return compute(state).filter(item => item.area === area);
  }

  global.Insights = {
    compute, forArea, personalWaitSeconds, rankedOptions, mostLikely,
    timeOfDayBand, countBy,
    thresholds: { MIN, MIN_GROUP, MIN_FOCUS_ENTRIES }
  };
})(typeof window !== 'undefined' ? window : globalThis);

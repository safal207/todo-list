"use strict";

window.sdelanoAnalytics = (() => {
  const storageKey = "sdelano.analytics.v1";
  const endpoint = document.querySelector('meta[name="sdelano-metrics-endpoint"]')?.content.trim();
  const events = [
    "task_list_viewed", "invite_viewed", "task_created", "task_completed",
    "share_opened", "share_action", "referral_opened", "referral_started",
    "referral_task_created", "referral_task_completed"
  ];
  const referral = { opened: 1, started: 2, created: 3, completed: 4 };
  const pilotKey = "sdelano.pilot.v1";
  const pilotCodePattern = /^T(0[1-9]|10)$/;

  function localDate() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")].join("-");
  }

  function dayIndex(value) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value ?? "")) return NaN;
    const [y, m, d] = value.split("-").map(Number);
    const time = Date.UTC(y, m - 1, d);
    const date = new Date(time);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return NaN;
    return time / 86400000;
  }

  function readPilot() {
    try {
      const saved = JSON.parse(localStorage.getItem(pilotKey));
      if (!saved || !pilotCodePattern.test(saved.code) || !Number.isFinite(dayIndex(saved.startedOn))) return null;
      return {
        code: saved.code,
        startedOn: saved.startedOn,
        newUser: saved.newUser === true,
        created: saved.created === true,
        completed: saved.completed === true,
        returnedD1: saved.returnedD1 === true
      };
    } catch { return null; }
  }

  function savePilot(pilot) {
    try {
      localStorage.setItem(pilotKey, JSON.stringify(pilot));
      return true;
    } catch { return false; }
  }

  // Pilot is local-only. A valid invitation code starts one cohort per browser.
  // No participant ID, task text or dates are sent over the network.
  function startPilot(invitationCode, isNewUser) {
    const existing = readPilot();
    if (existing) return existing;
    if (!pilotCodePattern.test(invitationCode ?? "")) return null;
    const pilot = {
      code: invitationCode, startedOn: localDate(), newUser: isNewUser === true,
      created: false, completed: false, returnedD1: false
    };
    return savePilot(pilot) ? pilot : null;
  }

  function updatePilot(event) {
    const pilot = readPilot();
    if (!pilot) return;
    let changed = false;
    if (event === "task_list_viewed" && !pilot.returnedD1 &&
        dayIndex(localDate()) - dayIndex(pilot.startedOn) === 1) {
      pilot.returnedD1 = true;
      changed = true;
    }
    if (event === "task_created" && !pilot.created) {
      pilot.created = true;
      changed = true;
    }
    if (event === "task_completed" && pilot.created && !pilot.completed) {
      pilot.completed = true;
      changed = true;
    }
    if (changed) savePilot(pilot);
  }

  let state = { events: {}, referralStage: 0 };
  let storageAvailable = true;

  function refreshState() {
    if (!storageAvailable) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const counts = {};
      for (const event of events) {
        const count = saved?.events?.[event];
        if (Number.isSafeInteger(count) && count >= 0) counts[event] = count;
      }
      const stage = saved?.referralStage;
      state = {
        events: counts,
        referralStage: Number.isInteger(stage) && stage >= 0 && stage <= referral.completed ? stage : 0
      };
    } catch {
      storageAvailable = false;
    }
  }

  function track(event, nextStage) {
    if (!events.includes(event)) return;
    refreshState();
    if (nextStage !== undefined) {
      if (state.referralStage >= nextStage) return;
      state.referralStage = nextStage;
    }
    state.events[event] = (state.events[event] ?? 0) + 1;
    updatePilot(event);
    if (storageAvailable) {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); }
      catch { storageAvailable = false; }
    }

    if (endpoint) {
      void fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ event }),
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }).catch(() => {});
    }
  }

  function openReferral() {
    track("referral_opened", referral.opened);
  }

  function startReferral() {
    openReferral();
    track("referral_started", referral.started);
  }

  function taskCreated() {
    track("task_created");
    if (state.referralStage < referral.started || state.referralStage >= referral.completed) {
      return false;
    }
    track("referral_task_created", referral.created);
    return true;
  }

  function taskCompleted(createdFromInvite) {
    track("task_completed");
    if (createdFromInvite && state.referralStage === referral.created) {
      track("referral_task_completed", referral.completed);
    }
  }

  function summary() {
    refreshState();
    const { referral_opened = 0, referral_task_completed = 0 } = state.events;
    return {
      events: { ...state.events },
      referralConversion: referral_opened ? referral_task_completed / referral_opened : null
    };
  }

  return Object.freeze({
    track: (event) => track(event), openReferral, startReferral, taskCreated, taskCompleted, summary,
    startPilot, pilotSummary: () => readPilot()
  });
})();

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
    track: (event) => track(event), openReferral, startReferral, taskCreated, taskCompleted, summary
  });
})();

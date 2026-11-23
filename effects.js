(() => {
  "use strict";

  const KEY = "sdelano.feedback.enabled.v1";
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== "off"; } catch { /* Private mode */ }
  let context;

  // Original short synthesized tones, not audio assets or autoplay.
  const melody = {
    tap: [[510, 0, 0.045]],
    add: [[520, 0, 0.075], [720, 0.06, 0.10]],
    complete: [[550, 0, 0.09], [750, 0.09, 0.11], [1000, 0.19, 0.16]],
    reopen: [[630, 0, 0.08]],
    remove: [[330, 0, 0.11]],
    coins: [[880, 0, 0.08], [1220, 0.08, 0.13]],
    xp: [[590, 0, 0.09], [790, 0.085, 0.11], [1030, 0.19, 0.145]],
    energy: [[390, 0, 0.10], [590, 0.09, 0.12], [780, 0.18, 0.13]],
    reward: [[660, 0, 0.08], [880, 0.08, 0.10], [1175, 0.18, 0.15]],
    level: [[560, 0, 0.12], [730, 0.13, 0.15], [910, 0.28, 0.17]]
  };

  function sound(kind) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      if (!context) context = new Audio();
      if (context.state === "suspended") void context.resume().catch(() => {});
      const time = context.currentTime;
      for (const [frequency, delay, length] of (melody[kind] || melody.tap)) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = ["complete", "coins", "reward", "level"].includes(kind) ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, time + delay);
        gain.gain.setValueAtTime(0.0001, time + delay);
        gain.gain.exponentialRampToValueAtTime(kind === "level" ? 0.022 : kind === "xp" ? 0.051 : 0.045, time + delay + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + delay + length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(time + delay);
        oscillator.stop(time + delay + length + 0.01);
      }
    } catch { /* Audio may be blocked by the browser; tasks stay usable. */ }
  }

  function play(kind = "tap") {
    if (!enabled) return;
    sound(kind);
    try {
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(kind === "complete" ? [16, 30, 28] : 12);
      }
    } catch { /* Vibration is optional, notably unavailable on iOS. */ }
  }

  function isEnabled() { return enabled; }

  function setEnabled(value) {
    enabled = Boolean(value);
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch {}
    if (enabled) play("tap");
  }

  window.taskFeedback = { play, isEnabled, setEnabled };
})();

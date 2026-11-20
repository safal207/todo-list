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
    remove: [[330, 0, 0.11]]
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
        oscillator.type = kind === "complete" ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, time + delay);
        gain.gain.setValueAtTime(0.0001, time + delay);
        gain.gain.exponentialRampToValueAtTime(0.045, time + delay + 0.012);
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

(() => {
  "use strict";
  // UI-only preference. Task storage remains shared in the same origin.
  const key = "sdelano.ui.mode.v1";
  const nav = document.querySelector(".version-switch[data-app-version]");
  if (!nav) return;
  const mode = nav.dataset.appVersion;
  const explicitClassic = new URLSearchParams(location.search).get("classic") === "1";
  let chosen;
  try {
    chosen = localStorage.getItem(key);
    if (explicitClassic) {
      localStorage.setItem(key, "classic");
      chosen = "classic";
    }
    if (mode === "game") localStorage.setItem(key, "game");
  } catch { /* Denied localStorage does not block regular links. */ }
  if (mode === "classic" && chosen === "game" && !explicitClassic) {
    location.replace(new URL("v2/", location.href));
    return;
  }
  nav.querySelectorAll("a[data-mode-target]").forEach(link => {
    link.addEventListener("click", () => {
      try { localStorage.setItem(key, link.dataset.modeTarget); } catch {}
    });
  });
})();

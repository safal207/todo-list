(() => {
  "use strict";
  // Display approved painted stages only after the 4-frame image has decoded.
  // On unsupported devices or failed network fetch, the original mascot
  // and CSS growth visuals remain visible without losing any game state.
  const atlas = new Image();
  let ready = false;
  function showArt() {
    if (ready || atlas.naturalWidth !== 160 || atlas.naturalHeight !== 640) return;
    ready = true;
    document.body.classList.add("fox-art-ready");
  }
  atlas.onload = showArt;
  atlas.src = "assets/fox-evolution-stages.webp";
  if (typeof atlas.decode === "function") {
    atlas.decode().then(showArt, () => { /* Stay with original mascot. */ });
  }
})();

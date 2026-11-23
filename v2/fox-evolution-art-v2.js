(() => {
  "use strict";

  // Fox Evolution v2 is strictly presentational. It cannot change XP, coins,
  // cosmetics, task history, cloud state or the existing growth rules.
  const figures = document.querySelectorAll(".fox-evolution-figure");
  if (!figures.length || !window.sdelanoFoxEvolution) return;

  const ATLAS = "assets/fox-evolution-stages.webp";
  const image = new Image();
  image.decoding = "async";

  // The original fox remains visible until all four frames are available.
  // Failed requests leave the existing v1 illustrations fully functional.
  image.onload = () => {
    if (image.naturalWidth !== 192 || image.naturalHeight !== 768) return;
    document.body.dataset.foxArt = "ready";
  };
  image.onerror = () => {
    document.body.dataset.foxArt = "fallback";
  };
  document.body.dataset.foxArt = "loading";
  image.src = ATLAS;

  window.sdelanoFoxArt = Object.freeze({
    source: ATLAS,
    stages: ["cub", "student", "hero", "master"]
  });
})();

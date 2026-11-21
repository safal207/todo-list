"use strict";

// Build a private, per-user JPG in the browser. Never reads or draws task names.
window.achievementPoster = (() => {
  const WIDTH = 1200;
  const HEIGHT = 630;

  function fillRounded(ctx, x, y, width, height, radius, color) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function fitText(ctx, text, x, baseline, maxWidth, fontSize, color) {
    let size = fontSize;
    do {
      ctx.font = "900 " + size + "px Arial, sans-serif";
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    } while (size > 38);
    ctx.fillStyle = color;
    ctx.fillText(text, x, baseline);
  }

  function create({ done, total } = {}) {
    if (!Number.isInteger(done) || !Number.isInteger(total) ||
        total < 1 || total > 9999 || done < 0 || done > total) {
      return Promise.reject(new RangeError("Invalid achievement counts"));
    }
    const percent = Math.floor(done * 100 / total);
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("Canvas is unavailable"));

    ctx.fillStyle = "#201926";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Simple original shapes: crisp and legible even in Telegram photo previews.
    ctx.fillStyle = "#33273f";
    ctx.beginPath();
    ctx.arc(1110, 20, 290, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#48344a";
    ctx.fillRect(0, 0, 16, HEIGHT);
    ctx.fillStyle = "#ffd75e";
    ctx.fillRect(60, 60, 42, 8);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 37px Arial, sans-serif";
    ctx.fillText("СДЕЛАНО.", 114, 80);
    ctx.fillStyle = "#ffd75e";
    ctx.font = "900 27px Arial, sans-serif";
    ctx.fillText("ЛИЧНЫЙ РЕЗУЛЬТАТ", 70, 132);

    fitText(ctx, "ШАГ", 56, 310, 610, 220, "#ffffff");
    ctx.font = "900 63px Arial, sans-serif";
    ctx.fillStyle = "#ffd75e";
    ctx.fillText("ЗА ШАГОМ.", 70, 376);

    fillRounded(ctx, 702, 112, 429, 274, 25, "#fff7e7");
    fitText(ctx, done + " / " + total, 731, 249, 382, 105, "#201926");
    ctx.fillStyle = "#4e3c4d";
    ctx.font = "800 28px Arial, sans-serif";
    ctx.fillText("ЗАДАЧ ВЫПОЛНЕНО", 732, 303);
    ctx.font = "900 55px Arial, sans-serif";
    ctx.fillStyle = "#c03b28";
    ctx.fillText(percent + "%", 732, 362);

    fillRounded(ctx, 69, 415, 1062, 23, 11, "#61536a");
    if (percent > 0) fillRounded(ctx, 69, 415, 1062 * percent / 100, 23, 11, "#ffd75e");

    fillRounded(ctx, 69, 473, 1062, 112, 18, "#ffd75e");
    fitText(ctx, "ЗАПИШИ ЗАДАЧУ", 104, 554, 990, 68, "#201926");

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== "image/jpeg") {
          reject(new Error("Could not create JPEG"));
          return;
        }
        resolve(new File([blob], "sdelano-progress-" + done + "-of-" + total + ".jpg",
          { type: "image/jpeg" }));
      }, "image/jpeg", 0.9);
    });
  }

  return Object.freeze({ create });
})();

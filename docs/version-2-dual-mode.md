# Сделано 2.0 — два режима, одни задачи

Independent Draft candidate based directly on stable main, not on a merge of PR #50.

## Paths and version isolation

- Root / = stable Classic 1.0. Original JS/CSS from main is unchanged, except for a compact selector, its CSS, and a tiny UI-preference script.
- /v2/ = Game 2.0. Original candidate PR #50 runtime code and binary assets are duplicated by exact Git blobs under /v2/. Service Worker has scope /v2/; it cannot control classic /.
- Both use localStorage key todo-list.tasks.v1 on the same site origin. The switch does not copy, migrate, clear, or rewrite task records.
- The separate optional sdelano.game.v1 wallet is only used in Game 2.0. Tasks done in Classic keep their status; already completed classic tasks are not rewarded retroactively.
- No preference = show v1. Explicit user switch to game remembers sdelano.ui.mode.v1=game; later visits to root redirect to /v2/. Explicit Classic switch resets to classic with the classic=1 query override.
- No functioning localStorage = normal links still work; browser may not remember preference.
- Cloud remains disabled (empty v2 cloud-config). Real Android notifications need opt-in and a real trusted origin.

## Release gates

- Playwright cross-mode tests for task create/complete/undo, wallet isolation, and non-destructive transitions on 320/390 px in Chromium, Firefox, WebKit.
- Check that classic first-screen layout and old tests remain intact; no silent new-permission prompts or redirects for existing classic users.
- Verify JSON backup, mobile UX, and real Android focus notifications before approving publication.
- No changes to main or GitHub Pages until owner authorizes release. PR #50 is a separate integrated code reference, not a merge prerequisite.

Source game commit: dea287e805cb62821fe25075786eee411c7d1546, PR #50 CI 3/3 success.
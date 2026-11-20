# Сделано

Список задач на HTML, CSS и JavaScript. Добавьте своё дело или попробуйте на примере, отметьте выполнение и увидите прогресс. Задачи можно фильтровать, возвращать в работу и удалять. Список и отметки сохраняются после перезагрузки страницы в том же браузере.

## Запуск

Откройте [демо на GitHub Pages](https://safal207.github.io/todo-list/). Для локального запуска скачайте репозиторий и откройте `index.html` через любой статический HTTP-сервер, например `python -m http.server 8000`. Затем перейдите на `http://localhost:8000`. Сборка и установка зависимостей не требуются.

## Как проверить

1. Нажмите «Добавить задачу» на первом экране и введите своё дело. В пустом списке можно сразу добавить пример.
2. Нажмите галочку рядом с задачей. Панель прогресса покажет 100% и «Всё сделано!», если выполнены все задачи.
3. Проверьте состояния через «В работе» и «Готово». Обновите страницу и убедитесь, что задачи и отметки сохранились.
4. Снимите отметку, удалите задачу и снова обновите страницу. Удалённая задача должна исчезнуть из списка.

Данные хранятся в `localStorage` текущего браузера. Для задач с одинаковыми названиями отметка и удаление работают независимо.

## AI-инструменты

- Codex (OpenAI) — проектирование первого сценария, реализация интерфейса и логики, проверки в браузере.
- OpenAI Image Generation — иллюстрация с [объёмной галочкой](hero-check.webp), подготовленная для первого экрана.

<details>
  <summary>Промпт для иллюстрации</summary>

> Create a single isolated premium 3D product mascot OBJECT for an ORIGINAL cheerful Russian task management web app called Сделано. A twisted stack of 3 large chunky matte molded-plastic app tiles, visually like a small stack of physical checklist cards or keyboard keycaps, shot as a photoreal playful product photograph from 25 degrees above with orthographic feel. The TOP tile faces the camera, is vivid buttery lemon yellow with one big dark dark-brown raised tick/checkmark in center, the understack visible staggered with warm peach cream and deep tomato red sides and a small deep plum accent. Crisp simplified typography-free graphic silhouette, beautiful tactile matte toy-like material and subtle highlights. In 3/4 isometric view with broad face readable at thumbnail. Centered loose composition, all parts inside canvas with small margin. Large square artwork, object fills 79% of frame in width, no extra items, no stand, no words, no lettering, no logos, no hands or living characters, no screen/UI screenshot. The background outside the object must be genuinely transparent alpha with no floor, no horizon, no solid color, no scenery, no bokeh. Use warm studio light from upper left, with shadows confined onto the object. It will sit on a solid warm vermilion website panel.

</details>

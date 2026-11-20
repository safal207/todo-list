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

## Большая цель

[Откройте режим «Большая цель»](https://safal207.github.io/todo-list/goals/). Введите результат, выберите срок и создайте план. По словам в названии приложение подбирает близкий шаблон. Можно выбрать шаблон вручную или взять универсальный план для своей цели. План и таймер сохраняются между посещениями.

В каталоге есть шаблоны для бизнеса, дома мечты, накоплений, семьи, знакомств, английского, поиска инвесторов и собственной цели. У шагов есть ожидаемые результаты, зависимости и плановые даты. При завершении можно записать фактический результат.

- **Дом мечты.** Подтвердите критерии, затем выберите накопление из доходов бизнеса, изучение банковских предложений или перенос покупки. После решения показывается выбранная ветка. При пересмотре решения приложение предупреждает о сбросе зависимых подтверждений.
- **Четыре представления.** Карточки показывают порядок и зависимости, Канбан — статусы, Гант — плановые интервалы, матрица — срочность и важность открытых шагов. Состояние шагов общее. Основной список задач и планы целей сохраняются отдельно.
- **Горизонты и сферы.** Выберите день, неделю, месяц, 3 месяца, полгода, год, 5, 10, 20, 30 или 50 лет. Подцели можно связать с более длинной целью. «Карта и история» переключает граф, таблицу, историю целей и историю задач. Действия в обычном списке также видны в истории задач с момента обновления приложения.
- **Пруфы, баллы и награды.** Подтверждённый шаг даёт 10 баллов, заметка или фото добавляет 5, завершение маршрута приносит ещё 20. Фото PNG, JPEG или WebP до 5 МБ хранится в браузере. Ранг и награды рассчитываются по текущему прогрессу.
- **Сводка для партнёра.** Можно скопировать название цели, срок, прогресс и следующий шаг, открыть окно отправки в Telegram или VK или воспользоваться системным меню, если оно доступно. Личные заметки и фото хранятся в браузере.
- **Русский и английский.** Переключатель меняет интерфейс и шаблоны. Ваши названия, подтверждения и заметки сохраняются в том виде, в котором вы их ввели.

### Методики Большой цели

- **Брайан Трейси.** Конкретная цель, общий срок, промежуточные даты и один доступный приоритетный шаг применяют его подход к постановке целей и приоритизации. [Семь шагов](https://www.briantracy.com/blog/personal-success/seven-steps-to-success/) · [ABCDE](https://www.briantracy.com/blog/time-management/the-abcde-list-technique-for-setting-priorities/)
- **Джефф Уокер.** Ожидаемый результат следующей карточки создаёт предвкушение, выбранный срок придаёт реальную срочность, готовый шаблон даёт пользу в первый визит. Сводка помогает договориться о регулярной сверке с партнёром. Открытые материалы автора описывают эти механики в контексте запусков. [«Запуск»](https://books.google.com/books/about/Launch_Updated_Expanded_Edition.html?id=6xK6EAAAQBAJ) · [Материалы Уокера](https://plf2019sept.s3.amazonaws.com/Launch_Masterclass_L3_Blueprint_v1.pdf)
- **Duolingo и ClickFunnels.** Короткие шаги, цветовое подтверждение и серия дней помогают видеть сделанное. Основное действие на экране ведёт от создания плана к первому доступному шагу. [Duolingo о серии](https://blog.duolingo.com/how-duolingo-streak-builds-habit/) · [ClickFunnels](https://www.clickfunnels.com/)
- **«6 минут».** Утром выберите одно главное действие, вечером запишите результат и что поможет завтра. Это адаптация идеи ежедневной короткой сверки. [«6 минут. Дневник успеха»](https://alpinabook.ru/catalog/book-6-minut-dnevnik/)
- **Матрица Эйзенхауэра.** Важность можно изменить на карточке. Срочность рассчитывается по сроку шага: ближайшие три дня и просроченные даты. [Четыре квадранта в изложении FranklinCovey](https://www.franklincovey.com/courses/the-7-habits/habit-3/)

## AI-инструменты

- Codex (OpenAI) — проектирование первого сценария, реализация интерфейса и логики, проверки в браузере.
- OpenAI Image Generation — [объёмная галочка](hero-check.webp) и [лестница с флажком](goals/goal-steps.webp) для первых экранов.

<details>
  <summary>Промпт для иллюстрации</summary>

> Create a single isolated premium 3D product mascot OBJECT for an ORIGINAL cheerful Russian task management web app called Сделано. A twisted stack of 3 large chunky matte molded-plastic app tiles, visually like a small stack of physical checklist cards or keyboard keycaps, shot as a photoreal playful product photograph from 25 degrees above with orthographic feel. The TOP tile faces the camera, is vivid buttery lemon yellow with one big dark dark-brown raised tick/checkmark in center, the understack visible staggered with warm peach cream and deep tomato red sides and a small deep plum accent. Crisp simplified typography-free graphic silhouette, beautiful tactile matte toy-like material and subtle highlights. In 3/4 isometric view with broad face readable at thumbnail. Centered loose composition, all parts inside canvas with small margin. Large square artwork, object fills 79% of frame in width, no extra items, no stand, no words, no lettering, no logos, no hands or living characters, no screen/UI screenshot. The background outside the object must be genuinely transparent alpha with no floor, no horizon, no solid color, no scenery, no bokeh. Use warm studio light from upper left, with shadows confined onto the object. It will sit on a solid warm vermilion website panel.

</details>

<details>
  <summary>Промпт для иллюстрации «Большая цель»</summary>

> An isolated 3D product artwork for a bright warm goal-planning web app. A small staircase made of three cheerful chunky solid matte lacquered toy blocks climbing diagonally from lower left to upper right, with a small simple butter-yellow flag on the top landing attached to a dark plum pole. Lower step pale cream, middle terracotta red, top step soft lavender. One tiny dark brown raised checkmark inlaid into the lower step face, visually clear at small size. This is an aspirational OBJECT, not a setting; no people, no other objects, no screens, no lettering, no text, no numbers, no UI. Premium playful photoreal physical product shot, slight isometric view from front-left and just above; matte molded-plastic material, warm studio highlights, bold uncluttered silhouette. Square canvas, whole object inside canvas with a small transparent margin. Transparent alpha background with no floor, no horizon, and no opaque shadows outside the object. The illustration will be laid on a flat warm yellow web hero.

</details>

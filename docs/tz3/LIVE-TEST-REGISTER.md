# Журнал выполнения ТЗ №3

## Цикл JF3-20260823-001

| Поле | Значение |
|---|---|
| ТЗ | ТЗ №3, редакция 2.1 |
| Начало | 2026-08-23T02:10:42+03:00 |
| Статус | IN PROGRESS |
| Рабочая папка | `C:\Users\zvd1\Desktop\JUSTFUN-AUDIT-WORK-20260821` |
| Репозиторий | `C:\Users\zvd1\Desktop\JUSTFUN-AUDIT-WORK-20260821\release-main` |
| GitHub | `KAPCTEH/21.08reliz` |
| Исполнительная ветка | `codex/tz3-execution-baseline` |
| Исходный коммит | `b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568` |
| Версия продукта | `7.8.3` |
| Текущий Gate | Stage 1 / address live provider pending |

## Хронология

### JF3-S0001 — Проверка разрешённой рабочей области

- Время: 2026-08-23T02:10:42+03:00
- Действие: проверено фактическое расположение репозитория и ТЗ №3.
- Ожидание: работа выполняется только в `JUSTFUN-AUDIT-WORK-20260821` и `release-main`.
- Фактически: разрешённые пути существуют; команды к старым папкам проекта не выполнялись.
- Результат: `PASS`.
- Следующий шаг: проверить Git.

### JF3-S0002 — Локальная исходная версия Git

- Действие: прочитаны ветка, HEAD, status, remotes и последние пять коммитов.
- Состояние до: ветка `main`.
- Фактически: `main`, HEAD `b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568`, рабочая директория чистая, remote `origin=https://github.com/KAPCTEH/21.08reliz.git`.
- Результат: `PASS`.
- Доказательство: вывод `git status`, `git rev-parse HEAD`, `git remote -v`, `git log` текущего цикла.

### JF3-S0003 — Сверка локального и удалённого main

- Действие: выполнен read-only `git ls-remote origin refs/heads/main`.
- Ожидание: удалённый `main` совпадает с локальным исходным коммитом.
- Фактически: GitHub вернул `b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568`.
- Результат: `PASS`.

### JF3-S0004 — Состояние GitHub и последней Windows-сборки

- Действие: через публичный GitHub REST API прочитаны свойства репозитория, последние Actions, job и артефакт.
- Фактически:
  - репозиторий публичный, default branch `main`;
  - `Audit incremental` run `32600392032` — `success`;
  - `Windows native release gate` run `32600392031` — `success`;
  - job `build-and-accept` `97097673611` — `success`, неуспешных шагов нет;
  - артефакт `9482860446` существует и не просрочен;
  - имя артефакта `justfun-windows-b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568`;
  - размер `1325925788` байт;
  - digest `sha256:c1c3ef9ca65fbaf05b687ee46bc5f1215025f4683f385ac1a485538900cc8973`;
  - срок хранения до `2026-09-05T21:54:11Z`.
- Результат: `PASS`.
- Ссылки:
  - https://github.com/KAPCTEH/21.08reliz/actions/runs/32600392031
  - https://github.com/KAPCTEH/21.08reliz/actions/runs/32600392032
  - https://github.com/KAPCTEH/21.08reliz/actions/runs/32600392031/job/97097673611

### JF3-S0005 — Проверка релизного контракта и обновлений

- Действие: прочитаны `package.json`, `release.json`, `update/policy.json`, `update/trusted-keys.json`.
- Фактически:
  - продукт `JustFun Логистика 7.8.3`;
  - `release_status=development`;
  - Windows `x64`, установка `per-user`;
  - Authenticode не обязателен по решению владельца;
  - система обновлений `enabled=false`;
  - internal/staging/stable endpoints не заданы;
  - allowlist хостов пуст;
  - доверенные ключи обновлений отсутствуют.
- Результат проверки состояния: `PASS`.
- Релизный результат: `BLOCKED` до настройки подписанного обновления.
- Связанный блокер: `JF3-BLOCKER-001`.

### JF3-S0006 — Создание исполнительной ветки

- Действие: создана ветка `codex/tz3-execution-baseline` от подтверждённого `main`.
- Фактически: переключение успешно.
- Результат: `PASS`.
- Следующий шаг: сохранить журналы, проверить их формат и выполнить Stage 0 source checks.

### JF3-S0007 — Проверка интерфейса вспомогательного test-runner

- Действие: выполнен `node tools/audit/run-selected-tests.mjs --help`.
- Фактически: инструмент трактует первый аргумент как путь к плану и не имеет команды `--help`; получен безопасный `ENOENT`, файлы не изменены.
- Результат: `NOT APPLICABLE` для запуска через `--help`.
- Решение: обязательные проверки запущены точными командами из GitHub workflow.

### JF3-S0008 — Локальные инструменты

- Фактически: Node.js `24.19.0`, npm `11.17.0`, Python `3.13.14`, .NET SDK `8.0.423`.
- `node_modules` присутствует для application, desktop-runtime и tests; installer dependencies локально не установлены.
- Результат: `PASS` для дешёвых исходных проверок; локальная полная сборка не запускалась.

### JF3-S0009 — Исходные контракты и безопасность

- `verify-release-contract.mjs`: 78 тестов, 0 ошибок.
- `security-audit.mjs source tools .github`: 172 файла, 0 находок, 0 запрещённых артефактов.
- source hygiene: `ok=true`, 277 отслеживаемых файлов.
- static audit regression: 56 implementation bindings, 23 controlled overrides, `ok=true`.
- Результат: `PASS`.

### JF3-S0010 — Ядро обновлений

- update core: 43 проверки.
- downloader: 15 проверок.
- controller: 48 проверок.
- update UI: 58 проверок.
- Update Helper runner: 16 проверок.
- Всего: 180 успешных проверок.
- Результат: `PASS` для исходного кода.
- Ограничение: подписанный живой каталог не настроен; `JF3-BLOCKER-001` остаётся открыт.

### JF3-S0011 — Релизные, визуальные и бизнес-регрессии

- evidence builder: 4 группы успешно.
- REG entity source contract: server entities, idempotent commands, permissions и conflicts — успешно.
- design token regression: базовый ratchet пройден; зафиксированы 1 191 уникальное HEX-значение и другие legacy-варианты, что не доказывает единый стиль.
- visual QA contract и release regression: успешно.
- current cycle и experience regression: успешно.
- order save integrity и atomic mutation: успешно.
- background sync failure regression: успешно.
- deep business: 69 из 69 проверок успешно; демо-набор содержит 70 заказов, 62 товара и 18 водителей.
- Результат: `PASS` для изолированных исходных регрессий.
- Ограничение: живые кнопки, реальный VPS и реальная установленная программа этими тестами не подтверждены.

### JF3-S0012 — Исходное состояние поиска адресов

- UI: `index.html`, поле `deliveryAddress`, кнопка `addressSearchBtn`.
- Renderer: `searchDeliveryAddress`, `geocodeSearch`, `expandAddressQuery`, `rankGeocodeResults`, `parseNominatimResult` в `00-app-bundle-v595.js`.
- Desktop: IPC `desktop:maps-geocode`, `directOpenStreetMapGeocode`, `resolveDesktopMapGeocode` в `main.js`.
- VPS: `/v1/maps/geocode`, `proxy_geocode` в `server.py`.
- Фактически: прямой публичный Nominatim с VPS fallback на Nominatim; ручная кнопка; до 10 результатов; простые замены нескольких сокращений и подстрочное ранжирование.
- Не обнаружены: ГАР/ФИАС, локальный адресный индекс, `pg_trgm`, полноценная обработка опечаток, контракт ровно до трёх достоверных вариантов, confidence, эталонный корпус и метрики Stage 39.
- Результат проверки состояния: `PASS`.
- Релизный результат: `BLOCKED`.
- Связанный блокер: `JF3-BLOCKER-002`.

### JF3-S0013 — Завершение Stage 0

- Исходная точка, GitHub, артефакт, инструменты, контракты, известные блокеры и журналы зафиксированы.
- Результат Stage 0: `PASS`.
- Следующий этап: карта проекта и Gate A; исправление релизных блокеров до формирования нового RC.

### JF3-S0014 — Фиксация блокеров в GitHub

- `JF3-BLOCKER-001`: https://github.com/KAPCTEH/21.08reliz/issues/23
- `JF3-BLOCKER-002`: https://github.com/KAPCTEH/21.08reliz/issues/24
- Результат: `PASS`.
- Секреты и приватные данные в Issues не размещались.

### JF3-S0015 — Первый инкремент интеллектуального поиска адресов

- Время завершения исходного инкремента: 2026-08-23T02:38:35+03:00.
- Коммит кода: `4ba860a25cceb2cef4a43c85ea25a0fc9cd030b3`.
- Добавлен отдельный модуль `04-address-intelligence-v783.js`.
- Реализованы: расширенная нормализация русских сокращений, нечёткое ранжирование слов, проверка номера дома/участка, приоритет согласованных регионов, дедупликация и максимум три результата.
- В поле адреса добавлены автоподсказки с задержкой 700 мс, отменой устаревшего запроса и предупреждением о необходимости проверки.
- Ручной выбор точки и reverse geocode сохранены.
- Новый тест добавлен в релизный каталог и Windows release gate.
- Проверки: address intelligence, синтаксис JS, map diagnostic, release contract, runtime smoke, security, current-cycle, experience, visual/release/design-token — `PASS`.
- Runtime smoke: 24 скрипта загружены, 0 ошибок, 349 кнопок обнаружено.
- Результат: `PASS` для первого исходного инкремента.
- Ограничение на дату первого инкремента: живой поставщик, стабильные source IDs, большой эталонный корпус, метрики и живая проверка ещё отсутствовали; `JF3-BLOCKER-002` остался `OPEN`.

### JF3-S0016 — Поиск адресов без загрузки базы

- Решение владельца: не добавлять полную базу ГАР/ФИАС, а находить адреса по запросу.
- План загрузки и локального хранения адресного архива отменён; архивы в проект не добавлены.
- Реализован scoped VPS-контракт и adapter DaData Suggestions с ФИАС-кодами, частями адреса и координатами.
- Ключ поставщика хранится только в защищённом `server.env`, не передаётся в renderer, не пишется в журнал и сохраняется при повторном развёртывании VPS.
- Без ключа автоподсказки не выполняют скрытые запросы. По кнопке разрешён один явный запрос через Nominatim с серверным ограничением частоты и временным кэшем.
- Защита соответствует правилу публичного Nominatim, запрещающему автодополнение.
- Source commit: `ad4136d`.
- Проверки: provider 9/9, desktop main, address intelligence, map proxy 5/5, installer source 20/20 и release contract 80 — `PASS`.
- Не проверено: реальный ключ, production VPS, живые адреса, корпус и установленный Windows UI.
- Результат: `SOURCE PASS`; `JF3-BLOCKER-002` остаётся `OPEN`.

### JF3-S0017 — Усиление проверки ответа и повторный Gate

- Неверные даты, рейтинги, координаты, типы полей и ФИАС-коды от внешнего поставщика теперь отклоняются.
- Runtime smoke сначала обнаружил, что jsdom не предоставляет стандартный Chromium API `structuredClone`; тестовый стенд дополнен этим API без ослабления production-кода.
- Повторный runtime smoke: 24/24 скрипта, 349 кнопок, 0 runtime errors.
- Security audit: 173 файла, 0 находок; source hygiene: 286 tracked files; static audit: 56 bindings / 23 overrides.
- Current cycle, experience, release, visual и design-token регрессии: `PASS`.
- Результат: `SOURCE PASS`; реальный поставщик, production VPS и установленная Windows-программа не проверены.

### JF3-S0018 — Доверие обновлений и реальный путь GitHub Release

- В разрешённой рабочей области и среди имён переменных окружения оригинальный Ed25519-ключ не найден; значения секретов не читались и не выводились.
- Staging Worker `1.0.0`: `/health` HTTP 200; staging-каталог ожидаемо отвечает `CATALOG_NOT_PUBLISHED`.
- Production Worker `1.0.0`: `/health` HTTP 200; stable-каталог ожидаемо отвечает `CATALOG_NOT_PUBLISHED`.
- В update policy записаны проверенные endpoints и точные allowlist-домены; updater остаётся `enabled=false` до появления доверенного ключа.
- Найден дефект: GitHub Release Assets может вернуть redirect, а загрузчик запрещал все redirect. GitHub Issue: https://github.com/KAPCTEH/21.08reliz/issues/25.
- Исправление `bdce184`: максимум три HTTPS-перехода, каждый домен из allowlist; посторонний домен отклоняется; размер и SHA-256 обязательны.
- Проверки update/catalog: 223 успешных; release contract 80; security audit 0 находок; Cloudflare dry-run успешен.
- Результат: `PARTIAL PASS`; `JF3-BLOCKER-001` остаётся `OPEN` из-за отсутствующего корневого ключа и живого подписанного обновления.

### JF3-S0019 — Защищённый полный цикл удаления склада

- Исходный инкремент: `d55ab31e1fec5da6d54c1d5d7d9d7bdb2ab25d6b`.
- Добавлены durable prepare/lease, архивирование перед удалением, атомарные tombstone для LIVE и DEMO, очистка старых business payload и запрет восстановления удалённого склада.
- Удаление Telegram-привязки теперь подтверждается центральным broker через HMAC-attestation VPS; обычного bearer недостаточно.
- Освобождение lease записывается в PostgreSQL outbox в одной транзакции с удалением и повторяется без клиентского токена или секрета.
- Desktop journal привязан к компании, складу, пользователю и сессии; результат старой сессии не применяется после выхода/входа.
- Локальные безопасные проверки до сборки: 64/64 `PASS`; PostgreSQL-класс локально был обнаружен, но пропущен из-за отсутствия тестового DSN и потому потребовал обязательного CI.
- Результат исходного инкремента: `SOURCE PASS`; production и живое приложение не проверены.

### JF3-S0020 — Первый обязательный PostgreSQL CI и найденная ошибка

- GitHub Audit incremental: `32624425249`, commit `d55ab31`, результат `FAIL`.
- 63 из 64 безопасных тестов прошли; реальный PostgreSQL запустил 22 теста и обнаружил одну ошибку в общей причине.
- Причина: tombstone имеет `payload=null`, а проверка ошибочно считала исчезновение `id`, `warehouseId` и `environment` попыткой изменить неизменяемые поля.
- Ошибка возникала до второй проверки lease и блокировала корректное удаление.
- Устаревший Windows run `32624425321` отменён после подтверждённого CI-fail, чтобы не расходовать лимиты на заведомо непригодный SHA.
- Результат: `FAIL FOUND AND FIXED`; релизный статус остался `NO-GO`.

### JF3-S0021 — Исправление tombstone и повторный PostgreSQL Gate

- Исправляющий commit: `c45eb07242e59fa3df95724bb283ec6d90ad07ae`.
- Immutable-защита сохранена для обновлений и исключена только для удаления; обычный и intent-delete пути покрыты регрессией.
- Локально: revision 35/35, entity source contract, Python compile и diff check — `PASS`.
- GitHub Audit incremental `32624837813`: 64/64 безопасных тестов — `PASS`.
- Внутри того же запуска PostgreSQL 16: 22/22 интеграционных теста — `PASS`, без skip.
- Подтверждены атомарное удаление, полный rollback при истёкшем lease, сохранение prepared при сбое Telegram, RLS и повтор outbox после временной сетевой ошибки.
- Windows native release gate `32624837780` выполняется; production и установленная программа не проверены.

### JF3-S0022 — Повторная полная UI-инвентаризация текущего SHA

- FULL: 302 кнопки, 695 интерактивных элементов, 88 безопасных кандидатов, 41 разрушительное/дорогое действие.
- DEMO: 349 кнопок, 776 интерактивных элементов, 90 безопасных кандидатов, 41 разрушительное/дорогое действие.
- Оба evidence JSON содержат commit `c45eb07`, чистый WEB-source и полный список элементов.
- Результат: `SOURCE INVENTORY PASS`; клики, размеры, прокрутка, визуальный стиль и работа установленного EXE ещё не доказаны.

### JF3-S0023 — Экономия GitHub Actions

- Дублирующий push-run `32624835080` отменён; проверка pull request `32624837813` сохранена и завершилась успешно.
- Audit workflow больше не запускается одновременно по push ветки `codex/**` и по pull request; push-проверка остаётся обязательной для `main`.
- Зеркало workflow и каталог 82 тестов синхронизированы в постоянном audit-ledger commit `1f4f52f`.
- Результат: `PASS`; будущие изменения ветки не должны тратить второй одинаковый Linux-run.

### JF3-S0024 — Windows native release gate текущего product-source

- GitHub run: `32624837780`, head `c45eb07`, результат `PASS`.
- Успешно выполнены: Update Helper, pinned dependencies, source/security/release contracts, защищённый Electron payload, Recovery, update payload и premium Setup.
- Все экраны установщика отрисованы и проверены; hidden application visual acceptance прошла.
- Пройдены interrupted-update recovery, изолированная полная установка, ярлык, иконка и запреты опасных операций.
- SBOM и release evidence собраны и загружены.
- Artifact `9489539095`: `justfun-windows-7105a7e48987ba4926730a3d7841c2f4dcf8b180`, 1 326 877 942 байта, digest `sha256:522522e4dbcd5b67e6b3813513b3274d2ea172814a8ca336e16d9aec7ad76d71`.
- GitHub artifact attestation штатно пропущена для pull request; это не финальная подпись релизного артефакта.
- Результат: `CI PASS`; артефакт ещё не установлен на физическом ПК пользователя.

## Текущее решение

- Stage 0: `PASS`.
- Gate A: `PASS` для source/CI; реальный PostgreSQL и Windows installer gate подтверждены.
- Адресный provider-инкремент: `SOURCE PASS`, живое подтверждение не выполнено.
- Удаление склада: `SOURCE + POSTGRESQL PASS`, production и multi-PC подтверждение не выполнены.
- Установка на ПК: ещё не начиналась.
- Ввод секретов: ещё не выполнялся; для автоподсказок потребуется ключ поставщика, который владелец введёт лично на VPS.
- Итоговый релизный статус: `NO-GO` до закрытия всех ворот ТЗ №3.

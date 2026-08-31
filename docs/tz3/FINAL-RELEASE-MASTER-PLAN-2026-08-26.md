# ТЗ №3.1 — Финальный мастер-план выпуска JustFun 7.8.4

Версия документа: `1.0`.

Дата консолидации: `26.08.2026`, часовой пояс `Europe/Moscow`.

Свежий внешний контроль GitHub: `26.08.2026 21:11 МСК`.

Текущий вердикт: **`NO-GO` — публичный коммерческий релиз выпускать нельзя**.

Канонический репозиторий:

`C:\Users\zvd1\Desktop\JUSTFUN-AUDIT-WORK-20260821\release-main`

Проверенный HEAD рабочей ветки:

`cb56c88eb3d236e2d99b46f3537af634ca1fb088`

## 0. Назначение и сила документа

Этот документ объединяет в один исполнимый план:

- решения владельца из текущего диалога;
- релевантные решения из других задач проектов `Подготовка к релизу`, `08.08 ИСПРОВЛЕНИЯ РЕЛИЗ`, `РЕЛИЗ АВТОМАТИЗАЦИИ` и `JustFun`;
- текущее состояние канонического репозитория;
- подтверждённые исходные, CI, Windows, VPS, PostgreSQL, Telegram и Cloudflare-доказательства;
- действующее ТЗ №3 и его специализированные приложения;
- открытые дефекты, риски и недоказанные области;
- точный порядок действий до production и stable.

Документ не объявляет проект готовым. Он задаёт путь, после выполнения которого выпуск может получить `GO`.

При противоречии применяется следующий порядок:

1. последнее явное решение владельца;
2. этот мастер-план — для порядка исполнения, ворот и текущего статуса;
3. [`TZ3-COMPLETE-RELEASE-SPEC.md`](TZ3-COMPLETE-RELEASE-SPEC.md) — для полного функционального объёма;
4. специализированные приложения ТЗ №3;
5. подтверждённое поведение точного исходного коммита и точного бинарного файла.

Старые папки, архивы, отдельные рабочие копии и прежние отчёты не являются источниками финальной сборки. Они используются только как исторические доказательства и набор регрессионных сценариев.

## 1. Правила правды и статусов

Каждое утверждение получает один статус:

| Статус | Значение |
|---|---|
| `OWNER_DECISION` | прямое, не отменённое решение владельца |
| `SOURCE_CONFIRMED` | подтверждено текущим исходным кодом |
| `TEST_CONFIRMED` | выполнен тест на точном коммите |
| `LIVE_CONFIRMED` | выполнено на установленной программе или production/staging |
| `HISTORICAL_EVIDENCE` | было подтверждено в старом кандидате; требует повтора |
| `REPORTED_NOT_REPRODUCED` | сообщалось, но текущим прогоном не воспроизведено |
| `NOT_VERIFIED` | доказательств нет |
| `BLOCKED` | проверка невозможна из-за конкретного блокера |
| `STALE` | доказательство относится к заменённому коду или артефакту |

Правила:

- исходный тест не доказывает production deploy;
- список кнопок не доказывает нажатие каждой кнопки;
- один скриншот не доказывает сохранение после перезапуска или синхронизацию второго ПК;
- успешный старый installer не доказывает новый installer;
- исправление в source не закрывает live-дефект до повтора на точном кандидате;
- повторный PASS flaky-теста не стирает первоначальный FAIL;
- отсутствующий, пропущенный или заблокированный тест не считается `PASS`;
- статус `CONDITIONAL_GO` не применяется: его формальные условия ранее не были определены;
- допустимы только итоговые решения `GO` или `NO-GO`.

## 2. Что фактически было проаудировано

### 2.1. История проекта

Проверены релевантные задачи и сообщения, в которых владелец определял:

- правила полного и последующего инкрементального аудита;
- работу только в созданной канонической папке;
- выпуск Windows-установщика;
- автоматическое обновление без переустановки;
- живой полный тест ТЗ №3;
- локальный и серверный режимы хранения;
- VPS, PostgreSQL, Telegram и Cloudflare;
- адресный поиск;
- многопользовательскую работу;
- визуальную приёмку;
- требования к фиксации каждого успешного и неуспешного шага;
- порядок «сначала полный обход, потом пакет исправлений, потом полный повтор».

Нерелевантные бытовые и сторонние задачи проекта в техническое ТЗ не включались.

### 2.2. Текущий репозиторий и документы

Сверены:

- Git-ветка, HEAD, расхождение с `main` и рабочее дерево;
- открытый PR и обязательные GitHub checks;
- текущий release contract и update policy;
- Windows build/release workflows;
- update publication и rollback workflows;
- актуальный release-readiness аудит;
- карта проекта, реестр дефектов и реестр живых тестов;
- local-first, multi-tenant, migration, address, updater и unattended-E2E спецификации.

### 2.3. Свежий внешний срез

Через GitHub API без чтения значений секретов подтверждено:

- репозиторий `KAPCTEH/21.08reliz` публичный;
- `main` защищена обязательным PR, strict checks `impact-and-tests` и `build-and-accept`, review, conversation resolution, linear history и enforce-admins;
- force-push и удаление `main` запрещены;
- PR №26 открыт, остаётся draft, merge state — blocked;
- exact Windows run `32984663174` на `609b99d...` остаётся `queued`, jobs `0`;
- официальный GitHub Status уже показывает `All Systems Operational`, поэтому прежний общий инцидент больше не объясняет бесконечную очередь;
- GitHub Environments `update-staging` и `update-production` имеют `0` protection rules и не имеют deployment branch policy;
- открыты Issues №5, №23, №24, №25 и №27.

### 2.4. Граница аудита

В этой консолидации не выполнялись:

- новая установка или запуск JustFun;
- изменение production;
- публикация stable;
- использование приватного signing key;
- чтение паролей, токенов или их значений;
- разрушение либо очистка старых папок;
- повтор всего уже выполненного тестового массива.

Это осознанный доказательный аудит и план, а не скрытая попытка выпуска.

## 3. Окончательно зафиксированные решения владельца

1. Используется только канонический репозиторий `JUSTFUN-AUDIT-WORK-20260821\release-main`.
2. Старые папки и архивы не используются для исправлений и финальной сборки.
3. Клиент выбирает режим `На этом компьютере` либо `Сервер и несколько компьютеров`.
4. В локальном режиме обычные операции сохраняются без VPS.
5. В серверном режиме VPS/PostgreSQL является источником подтверждённого общего состояния, а клиент сохраняет допустимые локальные намерения в долговечной outbox.
6. Только критические общие операции работают `fail-closed` без сервера.
7. При переходе local-to-server данные переносятся автоматически, с backup, проверкой, идемпотентным повтором и откатом.
8. Пилот содержит полный интерфейс и полный набор функций релиза. Он ограничивается охватом клиентов, а не возможностями.
9. В stable публикуется тот же бинарный файл и тот же SHA-256, который прошёл пилот.
10. Любое изменение бинарного файла создаёт новый кандидат и новый цикл проверки.
11. Идея нового общего Telegram-бота, Gateway и `local_mailbox` отменена. Проверяется и доводится существующая Telegram-архитектура.
12. Обязательное сравнение адресного поиска с Яндекс Картами отменено.
13. Локальная база ГАР/ФИАС и другие многогигабайтные адресные архивы в проект не добавляются.
14. Адреса ищутся через поддерживаемого внешнего provider, нормализацию и ограниченный временный кэш.
15. Адресный поиск обязан понимать ошибки, сокращения, неполный и длинный ввод, деревни, сёла, посёлки, СНТ, ДНТ, ДНП и массивы, выдавая максимум три достоверных варианта.
16. Windows Authenticode не является релизным блокером; предупреждение `Неизвестный издатель` принято.
17. Ed25519-подпись каталога и пакета обновления обязательна.
18. Первый живой проход не останавливается на каждой ошибке: фиксируется весь доступный цикл, затем выполняется единый пакет исправлений и полный повтор.
19. Фиксируются не только дефекты, но и каждый успешный шаг, состояние до/после, журнал и фактическое изменение данных.

Решение владельца от `2026-08-27`: релизная приёмка выполняется на одном физическом Windows-ПК. Синхронизация, конфликты, разграничение компаний/складов и повтор команд подтверждаются автоматическими протокольными и runtime-тестами. Проверка на дополнительных ПК исключена из блокирующих критериев релиза и может быть выполнена после выпуска.

## 4. Разрешённые противоречия старой истории

| Старое утверждение | Финальное решение |
|---|---|
| Только server-first, локальные данные недопустимы | Два режима. В shared-режиме server-authoritative V3; обычные offline-намерения локально долговечны и синхронизируются через outbox |
| Один общий Telegram-бот/Gateway для всех клиентов | Отменено. Оставить текущую Telegram-схему и доказать её живую работу |
| Обязательное сравнение с Яндекс Картами | Отменено |
| Локально загрузить ГАР/ФИАС | Отменено; адреса должны находиться, а не включаться архивом в продукт |
| Старый whole-warehouse snapshot | Заменён V3 `entities/events/commands`, `command_id`, per-entity version и RLS |
| Выпустить старый архив как `1.0` | Заменено текущим release contract `7.8.4` и совместимостью с `7.8.3` |
| Требуется 2–3 ПК | Отменено решением владельца от `2026-08-27`; обязательна живая приёмка на одном ПК и автоматическая проверка многопользовательских сценариев |
| Authenticode обязателен | Не блокер по решению владельца |
| Старый PASS автоматически действует для нового кандидата | Запрещено; PASS переносится только при точном неизменившемся входе и formal reuse evidence |

## 5. Текущий подтверждённый статус

### 5.1. Репозиторий и CI

| Объект | Состояние | Статус |
|---|---|---|
| Рабочая ветка | `codex/tz3-execution-baseline`, HEAD `cb56c88...` | `SOURCE_CONFIRMED` |
| Разница с `origin/main` | `0 behind / 78 ahead` | release ещё не в `main` |
| Рабочее дерево | изменён `tests/update-catalog-ops-unit.mjs`; новые `rollback-staging.yml`, readiness-аудит, этот мастер-план и пользовательский `docs/instructions/` | не готово к release cut |
| PR №26 | open, draft, blocked | `BLOCKED` |
| Exact Windows run | run `32984663174`, SHA `609b99d...`, queued, 0 jobs | `BLOCKED` |
| GitHub Status | All Systems Operational при свежей проверке | общий outage завершён; run нужно диагностировать/перезапустить |
| `main` protection | обязательные проверки и review включены | `LIVE_CONFIRMED` |
| Production Environment | 0 approvals, нет branch policy | release-safety blocker |

### 5.2. Продукт и артефакты

| Объект | Состояние | Статус |
|---|---|---|
| Установленная программа | JustFun 7.8.3, приложение закрыто | baseline |
| Планируемая версия | 7.8.4, `release_status=candidate`, default channel `stable` | source contract |
| Финальный 7.8.4 installer/payload | после updater fix `609b99d...` не существует | `BLOCKED` |
| Старый RC1 payload | commit `00ee971a...`, staging sequence 2 | `STALE`, apply запрещён |
| Staging Worker/catalog | health 200, catalog sequence 2 подписан и совпадает с Git | service PASS, release payload stale |
| Production Worker | health 200 | service live |
| Stable catalog | HTTP 404 | stable не выпускался |
| Staging rollback workflow | есть только локально, не в GitHub | `BLOCKED` |

### 5.3. Что уже подтверждено

- чистая source-основа, audit-ledger и GitHub governance созданы;
- Electron installer 7.8.3 устанавливался на физический ПК;
- старый точный 7.8.4-кандидат проходил setup/uninstall/data-preservation, но теперь устарел;
- Update Helper self-test прошёл `10/10`;
- updater реализует подпись, sequence, SHA-256, file manifest, journal, health и rollback;
- updater fix `609b99d...` прошёл профильные локальные наборы и независимый review;
- отдельный аудит updater/pipeline прошёл `286/286` локальных проверок;
- локально выполнены часть заказов, товаров, остатков, водителей, маршрутов, отчётности, backup и второй склад;
- четыре заказа и сумма `10 400 ₽` сохранялись в проверенном живом baseline;
- production VPS/PostgreSQL поднимался, сохранял старые данные и подтверждал одну команду после повторного чтения;
- V3 entity/event/command protocol, idempotent command ID, optimistic versions и RLS реализованы и тестировались;
- Telegram provisioning, D1 schema 3, Worker, webhook и диагностика проходили;
- source-инвентаризация UI содержит FULL `302` кнопки / `695` интерактивных элементов и DEMO `349` / `776`.

### 5.4. Что не доказано

- точный финальный installer/payload 7.8.4;
- живой update, health, rollback и повторное восстановление;
- детерминированная local-first запись во время startup/bootstrap;
- полный бизнес-цикл на финальной сборке;
- все статусы, оплаты, архив, удаление и восстановление;
- каждый динамический UI-контрол и полный единый визуальный стиль;
- три физических ПК и все роли;
- реальный конфликт двух устройств и offline/reconnect replay;
- изоляция двух компаний в production;
- все поддерживаемые миграции старых и повреждённых БД;
- реальная Telegram-группа, inbound/outbound и redelivery;
- production адресный provider и адресный корпус;
- source parity всех production Workers;
- измеримая canary-телеметрия;
- безопасный полный жизненный цикл signing key.

## 6. Реестр релизных блокеров

Отсутствие доказательства обозначается как gate/blocker, а не автоматически как дефект P0/P1. Severity P0/P1 применяется только к подтверждённой опасной ошибке или нарушению контракта.

| ID | Класс | Блокер | Условие закрытия |
|---|---:|---|---|
| `MR-001` | P0 | Недетерминированный local-first gate уже воспроизводил исчезновение тестовой записи; точная первопричина ещё не доказана | event/timer trace, доказанная причина, исправление атомарности, randomized/interleaving tests и многократный детерминированный PASS |
| `MR-002` | release-safety blocker | Publication verifier доверяет allowlist/contracts из самого каталога | проверка только против canonical policy/release/compatibility contract и отрицательные тесты |
| `MR-003` | release-safety blocker | Production Environment не требует approval и не ограничен `main` | required reviewer, protected-branch policy, отдельные staging/production права, проверка отказа feature-ветке |
| `MR-004` | artifact gate | Нет exact immutable 7.8.4 artifact | чистый принятый main SHA, exact Windows run, installer/payload/recovery/manifest/SBOM/provenance |
| `MR-005` | live gate | Не доказан update/rollback | полный живой `7.8.3 → 7.8.4 → health → rollback → reapply` без потери данных |
| `MR-006` | data gate | Не закрыта полная миграционная матрица | 100% поддерживаемых schema transitions, backup/restore, interruption/resume, corrupt/unknown fail-closed |
| `MR-007` | multi-user gate | Не доказана многопользовательская целостность | автоматические сценарии: 2 компании, 2+ склада, роли, conflicts, reconnect, outbox и zero cross-scope leakage; живая проверка на одном ПК |
| `MR-008` | BLOCKER | Жизненный цикл склада не принят как полностью серверный и атомарный | закрыть Issue №27 кодом, миграцией и живым create/rename/archive/delete/no-return тестом |
| `MR-009` | P1 | User invitation/RBAC path не принят | устранить `NOT_FOUND`, проверить делегирование, role caps, revoke и второй login |
| `MR-010` | deployment gate | Production source parity Workers не доказан | backup, deploy exact main SHA, attestation, rollback и повтор integration smoke |
| `MR-011` | integration gate | Telegram E2E неполон | реальная группа, inbound, outbound, retry, idempotency, warehouse/company isolation |
| `MR-012` | integration gate | Address E2E неполон | реальный provider, 2 000 адресов/10 000 вводов, Top-3 и latency criteria |
| `MR-013` | acceptance gate | Полный бизнес/UI acceptance не завершён | весь реестр контролов и бизнес-цикл на exact 7.8.4 |
| `MR-014` | key-safety gate | Signing-key lifecycle не закрыт | две backup-копии, restore drill, rotation/revocation/halt plan, next-key overlap |
| `MR-015` | canary gate | Нет canary telemetry и stop automation | privacy-safe события, dashboard, пороги и проверенный halt/rollback |
| `MR-016` | evidence gate | Реестр дефектов имеет незакрытый хвост | каждый пункт CLOSED с proof либо заново классифицирован с обоснованием |
| `MR-017` | evidence gate | Текущий release-evidence generator намеренно выдаёт `NO_GO/NOT_RUN` | до final build реализовать fail-closed импорт подписанных/хэшированных live и canary evidence; `GO` возможен только при полном наборе входов |
| `MR-018` | live gate | Issue №25 исправлен в source, но GitHub Release redirect не закрыт живым повтором | exact payload скачан через реальный redirect и прошёл size/SHA/manifest verification |
| `MR-019` | product/compliance gate | Не зафиксированы политика тарифных лимитов, retention и threat model локальных бизнес-данных | решить active-vs-all seats, сроки очистки/анонимизации и необходимость app-level encryption либо явно принять ограничение |

## 7. Целевая релизная архитектура

```text
Windows UI
  ├─ локальная транзакционная запись
  ├─ долговечная outbox с command_id и contract_version
  ├─ защищённый cache подтверждённого server state
  ├─ диагностика без секретов
  └─ signed updater + health + rollback
             │
             ▼
VPS API V3 ──► PostgreSQL entities/events/commands
  │             ├─ optimistic versions
  │             ├─ idempotency
  │             ├─ RLS и полный tenant scope
  │             └─ audit/migrations/backups
  ├─ License Worker/D1
  ├─ существующий Telegram broker/Worker/D1
  ├─ address provider adapter
  └─ route/map provider adapter

Release control
  Git main SHA ─► exact build ─► signed catalog ─► staging
                                         └──────► 5% ─► 25% ─► 100%
                                                      │
                                                      └─ signed halt/rollback
```

Инварианты:

- `company_id + warehouse_id + environment` обязательны во всех shared-запросах;
- server-wins относится к подтверждённому общему состоянию, но не уничтожает pending local intent;
- один `command_id` в одном scope даёт один результат;
- один и тот же ID в другом scope не раскрывает чужой результат;
- critical transition не подтверждается локально без server commit;
- ошибка Telegram, адреса или updater не блокирует независимую обычную работу;
- неизвестная схема или несовместимый контракт останавливает запись до изменения данных.

## 8. Метод исполнения с максимальной эффективностью

Полное покрытие сохраняется, но бессистемные повторы исключаются.

1. До изменений фиксируются SHA, версии, состояние БД, offsets журналов и текущий реестр дефектов.
2. Завершается один discovery-проход всех ещё не проверенных функций.
3. Дефекты группируются по первопричине, а не исправляются по одному симптому.
4. Независимые сценарии продолжаются после обычного дефекта.
5. Немедленная остановка выполняется только при потере данных, нарушении scope/прав, падении, криптографической ошибке или неизвестном destructive effect.
6. После discovery создаётся один контролируемый пакет исправлений.
7. До сборки запускаются только impact-тесты, контракты и обязательные safety gates.
8. Полный source/CI gate запускается один раз на замороженном кандидате.
9. Installer создаётся только после полного source PASS.
10. Живой полный повтор выполняется только на exact immutable artifact.
11. Логи читаются одним delta-пакетом на группу сценариев; немедленно — только при опасном событии.
12. Скриншоты делаются для дефекта и контрольной точки, а не для каждого обычного клика.
13. Валидное старое evidence переиспользуется только при совпадении SHA входов, toolchain и отсутствия impact.
14. Любое изменение после final gate создаёт новый SHA, новый artifact и новый цикл.

## 9. Этап 0 — заморозить фактическую основу

### Работы

- сохранить текущий Git status, HEAD и remote refs;
- отделить пользовательский `docs/instructions/` от release commit;
- определить судьбу изменённого `tests/update-catalog-ops-unit.mjs` и нового `rollback-staging.yml` через review, а не потерю изменений;
- зарегистрировать `MR-001` и `MR-002` в едином defect ledger/GitHub Issue;
- пометить staging sequence 2 как `DO_NOT_APPLY` в runbook;
- сохранить старую резервную копию как отдельную recovery point;
- перед любым будущим apply создать новую копию закрытой установленной 7.8.3 и текущих данных;
- зафиксировать доступность уже предоставленных секретов только по псевдонимам, не читая значения в отчёт.

### Gate `G0`

- один канонический worktree;
- нет неизвестных изменений;
- каждый dirty-файл имеет владельца и решение;
- backup manifest и SHA-256 сохранены;
- старый RC1 физически не может быть выбран тестовым runbook;
- scope и evidence IDs зафиксированы.

## 10. Этап 1 — завершить baseline discovery без точечных исправлений

На установленной 7.8.3 выполняются только ещё не закрытые безопасные сценарии:

- полный read-only обход вкладок, панелей, форм и настроек;
- поиск, фильтры, сброс, прокрутка, ESC и возврат фокуса;
- пустые, заполненные, loading, error и offline-состояния;
- четыре синтетических заказа;
- товары, остатки, водители, автомобили, маршруты, статусы, оплаты, отчёты, печать/PDF;
- новый склад и отсутствие данных первого склада;
- архив, разрешённое удаление и отсутствие самовозврата;
- backup, закрытие, повторный запуск и повторное чтение;
- local-only работа без VPS/Telegram;
- один общий log delta и сопоставление UI → local store/outbox.

Запрещено:

- применять staging sequence 2;
- менять реальные клиентские данные;
- выдавать заблокированный путь за PASS;
- исправлять каждый найденный дефект до завершения независимых сценариев.

### Gate `G1`

- каждый статический и динамически обнаруженный control имеет статус;
- каждый успешный шаг и каждый дефект записан;
- у каждого blocked-сценария есть точная причина;
- discovery ledger заморожен;
- нет необъяснённого изменения данных.

## 11. Этап 2 — закрыть source-safety и release-governance

### 11.1. Недетерминированный local-first gate

Подтверждённый факт — flaky FAIL с исчезновением тестовой записи и отсутствием outbox. Startup/bootstrap/timer race сейчас является только рабочей гипотезой; называть её причиной до event trace запрещено.

Обязательная последовательность:

1. Добавить event trace с фазами UI-ready, server bootstrap, local mutation, outbox capture, upload и authoritative apply.
2. Воспроизвести неуспешный interleaving без искусственного увеличения sleep.
3. Доказать точную первопричину.
4. Исправить атомарность: pending local intent нельзя потерять или затереть server bootstrap.
5. Не объявлять рабочую поверхность готовой, пока не восстановлены server cache и local outbox либо пока write barrier не гарантирует сохранность.
6. Добавить детерминированные тесты обоих порядков событий и randomized scheduler.
7. Выполнить минимум 30 последовательных PASS в двух чистых worktree с одинаковым toolchain.

### 11.2. Publication verifier

Workflow обязан брать истину только из:

- `source/application/update/policy.json`;
- `source/application/release.json`;
- `release/compatibility-policy.json`;
- exact build manifest.

Отрицательные тесты обязаны отклонять:

- чужой payload host или redirect host;
- чужой release-notes host;
- лишний, отсутствующий или неверный contract;
- неверные product ID, architecture, channel, minimum version;
- несовпадающие build ID, commit SHA, размер или SHA-256;
- повтор sequence и downgrade;
- catalog, подписанный неверным или отозванным ключом.

### 11.3. GitHub и Cloudflare governance

- включить required reviewer для `update-production`;
- разрешить production deploy только из защищённой `main`;
- staging и production используют разные tokens и минимальные разрешения;
- исключить `secrets: inherit` там, где возможно передать точные именованные secrets;
- production token не доступен feature-веткам;
- сохранить публичные байты каталогов и history в независимом immutable evidence;
- завершить, протестировать и закоммитить отдельный `rollback-staging.yml`;
- разделить staging rollback и stable rollback в документации;
- зависший exact run диагностировать и повторно dispatch только на точном принятом SHA.

### 11.4. Финальный генератор доказательств

- текущий безопасный default `NO_GO/NOT_RUN` сохраняется до появления обязательных входов;
- инструмент до final build должен уметь принимать только проверенные manifest-файлы live E2E, migration, update/rollback и canary;
- каждый вход привязывается к exact commit, artifact SHA, environment и времени;
- отсутствующий, неподписанный, чужой или несовместимый вход оставляет итог `NO_GO`;
- результат `GO` вычисляется правилами, а не передаётся свободным строковым параметром;
- negative tests доказывают невозможность получить `GO` пропуском gate или подменой evidence;
- после live/canary инструмент формирует отдельный `RELEASE-GO.json` без изменения проверенного бинарного файла.

### 11.5. Жизненный цикл release key

- доказать соответствие локального private key встроенному trusted public key без вывода ключа;
- создать минимум две независимо хранимые зашифрованные резервные копии;
- выполнить restore drill и тестовую подпись непубликуемого fixture;
- вести журнал использования ключа и назначить владельца;
- до final build добавить следующий public key для overlap-ротации;
- проверить отзыв старого ключа, signed halt и аварийное восстановление доверия;
- доказать, что отозванный ключ больше не выпускает принимаемый клиентом каталог.

### 11.6. Canary telemetry до сборки

- реализовать обезличенные события download/apply/restart/health/rollback/crash;
- использовать случайный или вращаемый технический идентификатор без ФИО, адресов, заказов и содержимого БД;
- задать rate limits, retry/outbox и ограниченный retention;
- описать privacy notice и режим pilot telemetry;
- проверить квоты выбранного backend и поведение при его недоступности;
- ошибка telemetry не ломает приложение и updater, но делает расширение canary невозможным;
- добавить тесты redaction, duplicate delivery, offline retry и server aggregation.

### Gate `G2`

- local-first gate детерминирован;
- publication negative matrix PASS;
- feature-ветка не может получить production deploy;
- production требует ручного approval;
- staging rollback виден GitHub и проходит dry-run/controlled test;
- все workflow/actions pinned;
- release-evidence generator остаётся fail-closed и проходит negative matrix;
- release key backup/restore/rotation/revocation drill PASS;
- telemetry реализована и не содержит пользовательских данных;
- 0 открытых release-safety P0.

## 12. Этап 3 — данные, роли, склады и миграции

### 12.1. Локальная надёжность и outbox

- атомарная запись сущности и outbox;
- неизменяемый `command_id`;
- сохранение очереди после crash/restart/update;
- состояния pending/sending/confirmed/conflict/rejected;
- backoff и safe retry;
- UI-индикатор несинхронизированных изменений;
- запрет silent drop при bootstrap;
- преобразование старой contract version только детерминированным adapter.

### 12.2. VPS V3

- полный scope на каждом read/write;
- transaction-scoped authorization и FORCE RLS;
- optimistic version conflict;
- idempotency;
- bounded pool;
- audit trail;
- cursor/resume без пропуска событий;
- server command → commit → event → re-read → UI.

### 12.3. Склады и компании

- create/rename/switch/archive/delete выполняются как серверные атомарные операции в shared-режиме;
- локальный optimistic UI не объявляет успех до подтверждения критического действия;
- частично созданный tenant/warehouse либо откатывается, либо безопасно resume;
- старый клиент не восстанавливает удалённый склад;
- одинаковые warehouse IDs разных компаний не пересекаются.

### 12.4. Пользователи и права

- invitation create/list/accept/revoke;
- второй login;
- role caps и правило `requested ⊆ role cap ∩ grantor permissions`;
- server-side проверка каждого действия;
- отзыв сессии и устройства;
- blocked users/devices не должны ошибочно занимать коммерческий лимит, если продуктовый контракт считает только активные;
- retention/cleanup для sessions, invitations, audit и rate-limit данных;
- документированное решение по защите локальных бизнес-данных at rest.

### 12.5. Миграционная система

Создать единый реестр поддерживаемых версий для:

- localStorage/IndexedDB/профиля Windows;
- PostgreSQL V1/V2/V3;
- License D1;
- Telegram D1;
- update journal и catalog state.

Алгоритм каждой миграции:

`preflight → backup → expand → idempotent backfill → verify → compatibility window → contract`.

Обязательная матрица:

- чистая база;
- текущая заполненная база;
- каждая явно поддерживаемая старая версия;
- незавершённая миграция;
- повтор миграции;
- обрыв процесса/сети/питания;
- недостаток места;
- повреждённая и неизвестная схема;
- old client/new server;
- new client/old server;
- два клиента разных поддерживаемых версий;
- rollback после expand и partial backfill;
- реальное восстановление backup и повторное чтение.

### Gate `G3`

- 100% зарегистрированных переходов PASS;
- 0 потерянных, дублированных, orphan или cross-scope записей;
- неизвестная схема останавливается до записи;
- migration checksum неизменяем;
- backup реально восстановлен;
- invitation/RBAC/device lifecycle PASS;
- warehouse lifecycle PASS;
- 0 открытых data/security P0/P1.

## 13. Этап 4 — интеграции

### 13.1. VPS/PostgreSQL staging parity и production readiness

- deploy candidate source в изолированный staging, не выдавая его за production;
- staging attestation source ↔ deployed bytes/config;
- health, TLS/pin, contracts, schema, auth, command, event, warehouse scope и RLS checks;
- подготовить backup, expand-first deployment и rollback-план текущего production сервиса/БД;
- проверить совместимость старого клиента с новым сервером на staging;
- production deploy до `G10 = PASS` и отдельного решения `GO_TO_PILOT` запрещён;
- до этого все server/client update-сценарии выполняются только на изолированном staging с production-like конфигурацией и обезличенными копиями данных.

### 13.2. License

- активация новой лицензии;
- существующий владелец;
- приглашённый сотрудник;
- лимиты активных сотрудников/устройств;
- revoke и повторный вход;
- expired/invalid/offline ошибки;
- отсутствие секретов и PII в логах.

### 13.3. Telegram — существующая схема

- company profile publication;
- warehouse binding;
- команда подключения реальной группы;
- водительский START/link;
- отправка маршрута;
- входящий статус;
- исходящее уведомление;
- повторная доставка без дубля;
- отключение, отмена и перепривязка;
- СПБ → МСК не переносит старую привязку;
- две компании/склада не видят чужие события;
- ошибка Telegram не блокирует VPS и локальную работу.

### 13.4. Адреса и карты

Целевой provider — текущий adapter DaData на VPS, если он реально настроен. Ключ не попадает в renderer или журнал. Public Nominatim не используется для autocomplete.

Приёмка:

- минимум 2 000 реальных адресов и 10 000 вариантов ввода;
- семь приоритетных регионов;
- общий Top-3 не ниже 95%;
- Top-3 с одной обычной опечаткой не ниже 90%;
- 0 автоматически принятых неверных адресов;
- provider p95 не более 2,5 секунды при описанной нормальной сети;
- ручной адрес/точка доступны в 100% отказов provider;
- максимум три дедуплицированных результата;
- сохраняются original, normalized, canonical address, coordinates, accuracy и provider/ФИАС IDs при наличии;
- отдельная проверка маршрута, ручной правки точки и отказа route provider.

### Gate `G4`

- каждая интеграция имеет отдельные configured/reachable/authorized/healthy состояния;
- exact staging deployed source доказан; production plan и rollback проверены;
- Telegram real-group E2E PASS;
- адресный корпус PASS;
- отказ одной интеграции не ломает остальные;
- 0 открытых integration P0/P1.

## 14. Этап 5 — полный бизнес-цикл и интерфейс

### 14.1. Тестовые контексты

Минимум:

- PC-A: владелец, компания A, склад A1;
- PC-B: сотрудник другой роли, компания A, склады A1/A2;
- PC-C: чистая установка, компания B либо независимый upgrade/rollback-контур;
- две независимые компании;
- минимум два склада основной компании;
- все фактически поддерживаемые роли;
- LIVE и DEMO/TEST без смешивания;
- локальный, online, offline и reconnect режимы.

### 14.2. Четыре обязательных заказа

1. Обычная городская доставка с товаром, оплатой, водителем и маршрутом.
2. Самовывоз с редактированием состава и статуса.
3. Доставка в деревню/село с неполным адресом.
4. Доставка в СНТ/ДНТ/ДНП/массив с опечаткой и длинным вводом.

Для каждого:

- create/read/update/re-read;
- товары, количества, цены, остатки и движения;
- адрес и координаты;
- водитель/автомобиль/маршрут;
- все разрешённые фактическим контрактом переходы статуса;
- оплата, отмена/возврат при применимости;
- отчёт, печать/PDF и экспорт при наличии;
- архив и разрешённое удаление;
- закрытие приложения и повторное чтение;
- второй ПК видит подтверждённое изменение без relogin;
- повтор команды не создаёт дубль.

### 14.3. Полная UI-приёмка

Для каждого control из статического реестра и каждого динамически обнаруженного control:

- видимость, подпись и роль;
- hover/focus/active/disabled/loading;
- один клик — одно действие;
- Enter/Space/ESC и возврат фокуса;
- открытие и закрытие окон;
- вертикальная и горизонтальная прокрутка;
- поиск, фильтры, сброс и сохранение выбранного состояния;
- empty/loading/error/offline/success states;
- уведомления и их закрытие;
- destructive confirmation/cancel;
- отсутствие наложения, обрезания и выхода за экран;
- единые шрифты, цвета, радиусы, тени, отступы, иконки и логотипы.

Конфигурации:

- 1366×768, 100%;
- 1920×1080, 100% и 125%;
- 2560×1440, 150%;
- длинные русские строки;
- реальные объёмы списков;
- системная светлая тема и только фактически заявленная дополнительная тема.

### 14.4. Обязательные исторические регрессии

Ниже не объявлены текущими дефектами без повтора, но должны быть проверены:

- заказ менеджера исчезает либо не появляется у владельца;
- доставленный заказ после входа снова становится активным;
- водитель обновляется только после перезахода;
- не работает ручное согласование;
- не сохраняются административные поля;
- отсутствует история/карточка завершённого рейса;
- пропадает имя водителя;
- раздел данных не синхронизируется между пользователями;
- при СПБ → МСК остаётся чужая Telegram-привязка;
- поиск и фильтры отключаются глобальной UI-блокировкой;
- серверный bootstrap удаляет новый order/driver/route;
- авторизация теряется после repair/update/reinstall;
- invitation endpoint возвращает `NOT_FOUND`.

### Gate `G5`

- четыре заказа прошли полный цикл;
- все обязательные бизнес-модули PASS;
- автоматическая многопользовательская матрица и роли PASS;
- каждый обязательный FULL-control PASS;
- все исторические регрессии имеют свежий результат;
- визуальные P1/P2 исправлены либо низкорисковые P3 явно приняты владельцем;
- 0 открытых functional/UI P0/P1.

## 15. Этап 6 — полный source/CI/security/performance gate

До запуска полного gate все принятые изменения, включая `release_status=released`, обязаны находиться в защищённой `main`. После этого commit замораживается. Любое изменение source, release contracts, dependencies, build configuration или тестов создаёт новый SHA и требует полного повторения `G6`.

На этом замороженном чистом released-коммите выполняются:

- clean dependency install только по lock-файлу;
- syntax/static/type checks;
- unit, contract, integration и negative tests;
- local-first randomized tests;
- migration matrix;
- PostgreSQL/RLS/idempotency/conflict tests;
- updater/controller/downloader/helper tests;
- installer/recovery source checks;
- UI runtime/button/visual/accessibility checks;
- secret/security/dependency scan;
- source-only archive audit;
- reproducible build checks;
- нагрузка и soak.

### 15.1. Обязательный test-environment manifest

До измерения порогов создаётся неизменяемый manifest:

- exact commit, artifact/build ID, dataset seed/digest и время;
- модель CPU, число ядер, RAM, тип/свободное место диска, Windows build, power mode и масштаб экрана каждого ПК;
- версии Electron/Node/Python/PostgreSQL, параметры pool и лимиты Workers;
- регион/размер VPS, PostgreSQL configuration digest;
- сеть клиента и сервера: тип подключения, RTT p50/p95, packet loss и доступная полоса;
- число повторов, warm-up, timeout, начало/конец интервала и инструмент измерения;
- числовой baseline предыдущей 7.8.3 на том же контуре.

Правила расчёта:

- `p95` — элемент с индексом `ceil(0,95 × N)` в отсортированном наборе успешных измерений; timeout/error учитывается отдельно как FAIL, а не выбрасывается;
- cold start: минимум 30 полностью закрытых запусков; search/filter и открытие раздела: минимум 100 операций после 10 warm-up; server command: минимум 500 операций между 30 сессиями;
- 8-часовой client soak и 24-часовой server soak измеряются каждую минуту; unhandled error, crash, исчерпание pool или необработанная очередь, не вернувшаяся к исходному уровню в течение 5 минут после остановки нагрузки, означает FAIL;
- метрики и сырые обезличенные samples сохраняются вместе с manifest; менять окружение или формулу после просмотра результата запрещено.

Минимальные измеримые показатели:

- 0 P0/P1;
- 0 security findings уровня release blocker;
- 5 000 заказов без runtime error;
- local search/filter на 5 000 заказов: p95 ≤ 2 с;
- cold start: p95 ≤ 10 с без ручного входа;
- открытие локального раздела: p95 ≤ 1 с;
- серверная команда без внешнего provider: p95 ≤ 3 с;
- минимум 30 одновременных server-сессий;
- 36 параллельных команд с conflict/RLS checks;
- клиентский soak 8 часов;
- серверный soak 24 часа без роста необработанной очереди и утечки соединений.

### Gate `G6`

- clean clone и CI дают одинаковый результат;
- все обязательные jobs `success`;
- skipped перечислены и не относятся к release-critical scope;
- worktree чист;
- toolchain и input digests сохранены;
- `release_status=released` уже находится в проверенном commit;
- final commit утверждён и больше не меняется.

## 16. Этап 7 — собрать один immutable final candidate

Перед сборкой:

- принять все исходные изменения через PR;
- подтвердить, что `release_status=released` уже входил в exact commit, прошедший `G6`; новый status-commit после `G6` запрещён;
- сохранить version `7.8.4`, contracts, minimum supported version и update policy;
- собрать из exact protected `main` SHA;
- не использовать временный PR merge SHA как источник артефакта.

Генератор build-evidence на этом этапе обязан честно оставить общий вердикт `NO_GO`, потому что live/canary ещё не завершены. Это ожидаемое состояние, а не ошибка сборки. Финальный `RELEASE-GO.json` создаётся позже тем же заранее проверенным инструментом из доказательств `G8–G11`, без изменения исходного commit и бинарного payload.

Обязательные артефакты:

- Setup;
- Recovery;
- full update payload;
- signed update catalog candidate;
- build manifest;
- file manifest;
- SHA-256 всех артефактов;
- SBOM и перечень лицензий;
- provenance/attestation;
- clean source ZIP из commit, а не из dirty worktree;
- changelog, migrations и compatibility matrix;
- инструкции install/update/rollback/backup/Telegram/VPS;
- evidence bundle.

Отдельно собирается test-only `staging-bootstrap 7.8.3`:

- исходная точка — точный подтверждённый baseline 7.8.3;
- единственный разрешённый смысловой diff — `default_channel: stable → staging`; полный diff прикладывается к evidence;
- сохраняются source commit, toolchain, manifest, Setup/installed hashes и build identity;
- проверяются чистая установка, запуск, чтение baseline-данных, repair/uninstall и сохранение данных;
- bootstrap никогда не публикуется как stable, не выдаётся клиентам и применяется только в изолированном update-тесте.

Допустимое ограничение: Authenticode может отсутствовать. Это фиксируется в release notes как предупреждение `Неизвестный издатель`, но не меняет `GO` при выполнении остальных ворот.

### Gate `G7`

- installer/payload/source/manifest привязаны к одному SHA;
- распакованный payload совпадает с file manifest;
- source ZIP совпадает с allowlist commit;
- нет секретов, caches, node_modules, logs, старых архивов или loose private keys;
- exact Windows CI artifact скачан и хэширован;
- test-only staging-bootstrap имеет отдельный manifest/SHA и доказанный единственный channel-diff;
- после сборки бинарный файл не меняется.

## 17. Этап 8 — предварительный exact-candidate repeat и автономный E2E

До воздействия на текущую рабочую 7.8.3 exact artifact проверяется в изолированном контуре.

### 17.1. Прямой repeat exact-кандидата

- чистая установка exact 7.8.4 на отдельный тестовый Windows-контур;
- вход только тестовой учётной записью;
- полный основной бизнес-цикл, UI smoke, сохранение, restart и повторное чтение;
- staging VPS/License/Telegram/address integrations;
- uninstall/reinstall с сохранением тестовых данных;
- проверка точного EXE/ASAR/build identity после установки.

### 17.2. Полная exact-artifact migration matrix

- каждая зарегистрированная старая локальная, PostgreSQL и D1 schema;
- чистая, заполненная, частично мигрированная, повреждённая и неизвестная копия;
- повтор, interruption/resume, rollback и mixed-client compatibility;
- сравнение schema, counts, IDs, relations, sums, statuses, versions и canonical digests;
- реальное восстановление каждой обязательной backup-копии;
- 0 silent repair неизвестной схемы.

### 17.3. Обязательный `UNATTENDED_E2E_PASS`

После однократной загрузки тестовых доступов в защищённое хранилище весь утверждённый цикл выполняется без участия владельца. Порядок профилей жёсткий: `discovery/regression → migration-matrix PASS → staging update/rollback → soak`.

- install/login/company/warehouse/local mode;
- товары, остатки, водители, четыре заказа, адреса, маршруты, статусы, отчёты, print/PDF;
- backup/restart/restore;
- local-to-server и staging integrations;
- два автоматизированных клиента, conflict/offline/reconnect/outbox;
- только после полного migration PASS — staging update/health/rollback/reapply на одноразовой копии baseline;
- checkpoints и безопасный resume после искусственного crash;
- сбор только обезличенных доказательств.

MFA/CAPTCHA либо недостающее внешнее полномочие получает `EXTERNAL_AUTH_BLOCKED`, но не `PASS`. Независимые сценарии продолжаются. Production и реальные клиентские данные автономный исполнитель не изменяет.

### Gate `G8`

- exact direct-install repeat PASS;
- `UNATTENDED_E2E_PASS=true` на exact commit/artifact SHA;
- `MIGRATION_MATRIX_PASS=true` для 100% зарегистрированных переходов;
- timestamp migration PASS предшествует первому staging update apply;
- unattended run завершился без участия владельца после preflight;
- checkpoints не создают дублей;
- staging update/rollback/reapply PASS на disposable baseline;
- все отчёты и их SHA сохранены в evidence bundle.

## 18. Этап 9 — живое обновление, rollback и восстановление

Этот этап разрешён только после `G8 = PASS`.

Перед обновлением клиента в изолированном staging:

1. Создать и проверить backup staging VPS/Workers/БД и зафиксировать запрет production credentials.
2. Развернуть server-side часть exact final `main` SHA в staging в backward-compatible expand-фазе.
3. Сохранить deployment attestation и точный rollback target.
4. Доказать health, scope и работу прежнего клиента 7.8.3 с новым server-side контрактом.
5. При несовместимости немедленно откатить server-side deploy и не начинать client apply.

Перед apply:

1. Закрыть JustFun.
2. Создать свежий backup текущей 7.8.3 и данных.
3. Проверить backup по manifest/SHA и тестовому чтению.
4. Сохранить старую backup-копию отдельно.
5. Установить точный staging-bootstrap 7.8.3.
6. Опубликовать новый immutable staging sequence, следующий после 2, с exact final payload.

Основной цикл:

`7.8.3 → download → verify → apply → restart → health → data compare → signed rollback → restart → data compare → reapply 7.8.4`.

Проверяются также:

- повреждённая подпись;
- неверный SHA/размер/manifest;
- обрыв скачивания;
- обрыв после распаковки;
- занятый файл;
- недостаток места;
- падение до health confirmation;
- повреждённый proof;
- повтор того же sequence;
- downgrade без signed rollback;
- восстановление journal после crash;
- совместимость данных с rollback window.

Сравниваются до/после:

- версия, build ID и commit;
- авторизация;
- компания, склад, роль и настройки;
- 4 заказа и их суммы/статусы;
- товары, остатки, водители и маршруты;
- local outbox и server versions/digests;
- Telegram bindings;
- журналы и health evidence.

### Gate `G9`

- update, rollback и reapply PASS;
- 0 потерянных/изменённых вне контракта записей;
- rollback реально запускает рабочую версию;
- health подтверждён exact build;
- backup реально восстанавливается;
- старый sequence 2 не применён;
- release Issue №23 может быть закрыт доказательством.

## 19. Этап 10 — финальная приёмка exact кандидата на одном ПК

Порядок сохраняет независимость слоёв:

1. local-only полный цикл на PC-A;
2. подключение VPS и перенос local-to-server;
3. повтор изменяющих сценариев на текущем ПК и автоматическая многопользовательская матрица;
4. conflict, disconnect, reconnect и outbox replay;
5. clean install/upgrade/rollback на текущем ПК;
6. другая компания и cross-tenant negative tests;
7. существующая Telegram-интеграция;
8. адресный provider и route provider;
9. полный UI/visual repeat;
10. migration matrix;
11. load/soak/security;
12. итоговый единый log/evidence анализ.

Никакой дефект не закрывается только кодом: нужен live repeat exact кандидата.

### Gate `G10`

- все пункты [`LIVE-ACCEPTANCE-SCENARIOS.md`](LIVE-ACCEPTANCE-SCENARIOS.md) имеют PASS;
- весь [`LIVE-TEST-REGISTER.md`](LIVE-TEST-REGISTER.md) обновлён;
- все release-critical записи [`DEFECTS.md`](DEFECTS.md) CLOSED;
- один физический ПК, автоматические сценарии 2 компаний/2+ складов и все роли PASS;
- source, installed bytes, staging server deploy и evidence связаны одним release identity.

## 20. Этап 11 — production pilot и stable

После `G0–G10 = PASS` оформляется отдельное решение `GO_TO_PILOT`. Оно разрешает только управляемую production-canary через stable-каталог с ограниченным rollout и не означает публичный коммерческий `GO` или массовое объявление релиза.

До публикации 5%:

1. Включить production approval и protected-main policy.
2. Создать свежий production backup Workers/VPS/PostgreSQL/D1/KV и реально проверить восстановление на изолированном контуре.
3. Развернуть exact server-side `main` SHA в backward-compatible expand-фазе.
4. Сохранить production deployment attestation, public/config digests и точный rollback target.
5. Доказать health, tenant scope и совместимость прежнего клиента 7.8.3 с новым server-side контрактом.
6. При любом FAIL откатить production server deploy и не публиковать stable sequence 1.

До canary должны существовать privacy-safe события:

- catalog sequence/build/channel;
- download start/verified/failed;
- apply start/completed/failed;
- restart/health;
- rollback и safe error code;
- crash rate без заказов, адресов, ФИО, токенов или содержимого БД.

До `GO_TO_PILOT` замораживается `canary-metrics-manifest`:

- cohort/device count, период, exact 7.8.3 baseline, release SHA и инфраструктурный manifest;
- `update health rate = уникальные устройства с health в течение 10 минут после apply / уникальные устройства с verified download`;
- `automatic rollback rate = уникальные автоматические rollback / уникальные apply start`;
- `crash rate = неожиданные завершения / все запущенные сессии длительностью не менее 30 секунд`;
- queue age, conflict rate, PostgreSQL error rate и Telegram failure rate с точными единицами, запросами и числовыми p50/p95/p99;
- baseline собирается на той же группе/инфраструктуре минимум 3 рабочих дня; если это невозможно, `GO_TO_PILOT` блокируется до отдельного решения владельца;
- absolute stop-пороги и denominator фиксируются до первого 5%-устройства и после просмотра результата не меняются.

### 20.1. Production pilot

- используется тот же exact payload, что прошёл staging;
- stable sequence 1 публикуется с rollout `5%`;
- GitHub Release до завершения canary остаётся prerelease/draft, официальная массовая ссылка и публичное объявление не выпускаются;
- начальный 5%-пилот наблюдается минимум 5 полных рабочих дней;
- на каждом последующем этапе наблюдение минимум 24 часа;
- желательный минимум — 20 подходящих устройств; если клиентов меньше, участвуют все доступные canary-устройства и требуется отдельное ручное решение владельца;
- после PASS выпускаются новые подписанные stable catalog sequences: sequence 2 с `25%`, затем sequence 3 со `100%`;
- все три stable sequences ссылаются на один и тот же payload SHA; меняются только sequence, rollout и подпись каталога.

### 20.2. Stop-пороги

Немедленный halt и rollback:

- любое повреждение или исчезновение данных — допустимо `0`;
- любое нарушение company/warehouse/environment/role scope — `0`;
- любая криптографическая ошибка release artifact — `0`;
- любой неработающий rollback после failed apply — `0`.

Порог продолжения:

- apply + restart + health ≥ 99% устройств, полностью скачавших и проверивших пакет;
- automatic rollback из-за дефекта новой версии ≤ 1%;
- crash rate не хуже baseline более чем на 0,5 процентного пункта;
- queue age, conflict rate, PostgreSQL errors и Telegram failures не выходят за утверждённый baseline.

### 20.3. Stable

После успешных 100%:

- тот же GitHub Release переводится из prerelease/draft в stable без замены asset;
- публикуется постоянная официальная ссылка;
- фиксируются final SHA-256, tag, commit, catalog sequence и public bytes;
- выпускаются release notes, known limitations, system requirements и support contacts;
- создаётся финальный immutable evidence bundle;
- итоговый release report получает `GO`.

### Gate `G11`

- production approval и branch policy активны;
- canary thresholds выдержаны;
- halt/rollback проверены;
- stable endpoint отдаёт exact подписанный catalog;
- GitHub Release не prerelease;
- официальная ссылка работает;
- тот же payload SHA использован в staging, pilot и stable.

## 21. Эксплуатационная готовность после выпуска

До публичного объявления должны быть готовы:

- инструкция обычного пользователя;
- инструкция владельца компании;
- установка, repair и uninstall;
- локальный режим и переход на VPS;
- добавление пользователя, роли, устройства и склада;
- текущая схема Telegram-подключения;
- backup/restore и disaster recovery;
- обновление, halt и rollback;
- сбор диагностического пакета с preview;
- privacy/retention правила;
- support SLA и канал обращения;
- ротация/отзыв release key и API tokens;
- мониторинг queue age, errors, latency, backups и migrations;
- проверка восстановления backup по расписанию;
- процедура emergency patch как нового immutable release.

## 22. Полный набор релизных доказательств

Финальный evidence bundle содержит:

- Git commit/tag и clean status;
- source file inventory и SHA-256;
- exact build run/job/artifact IDs;
- installer, recovery и payload hashes;
- manifest, SBOM, dependency licenses и provenance;
- результаты всех test suites с командой, cwd, tool version и exit code;
- migration matrix и backup/restore reports;
- DB counts, IDs, versions, scope и canonical digests до/после;
- outbox replay/conflict/idempotency evidence;
- three-PC live matrix;
- UI control register и визуальные дефекты/исправления;
- address corpus metrics;
- Telegram real-group trace без содержимого секретов;
- update/rollback/reapply journal;
- Cloudflare catalog public bytes, signature и sequence history;
- production deploy attestation;
- canary dashboard export и stop decisions;
- итоговый defect ledger;
- итоговый `RELEASE-GO.json` и человекочитаемый release report.

Запрещено включать:

- пароли;
- API tokens;
- приватный Ed25519 key;
- SSH private keys;
- полные персональные данные;
- реальные заказы и адреса клиентов;
- неочищенные полные production logs.

## 23. Участие владельца

Сейчас для составления и принятия этого плана действие владельца не требуется.

При исполнении сначала используются уже предоставленные защищённые доступы. Повторно спрашивать их без проверки наличия/срока действия запрещено.

Владелец нужен только когда внешний сервис объективно требует:

- MFA/CAPTCHA;
- ввод отсутствующего или истёкшего секрета через защищённый интерфейс;
- подтверждение нового SSH fingerprint после независимой сверки;
- доступ к реальной Telegram-группе;
- физический доступ к PC-B/PC-C;
- destructive production action;
- окончательное принятие перечисленных P3/известных ограничений;
- финальное business-решение на расширение canary.

Наличие matching release-signing key проверяется локально по public key, не раскрывая приватное содержимое. Даже если ключ найден, его backup/rotation/revocation lifecycle остаётся отдельным обязательным gate.

## 24. Жёсткие условия `NO-GO`

Релиз запрещён, если выполняется хотя бы одно условие:

1. Есть открытый P0/P1 или неразобранный release blocker.
2. Не доказана связь source SHA → build → installer/payload → installed bytes.
3. Worktree exact build был dirty.
4. Есть пропущенный release-critical тест.
5. Local-first intent может исчезнуть при bootstrap/reconnect.
6. Повтор команды создаёт дубль.
7. Данные или права пересекают company/warehouse/environment.
8. Critical operation проходит без server confirmation.
9. Неизвестная миграция меняет исходную БД.
10. Backup не был реально восстановлен.
11. Update, health, rollback или reapply не доказаны живьём.
12. Production publish возможен из feature-ветки либо без approval.
13. Catalog не проверяется против canonical policy/contracts.
14. Exact production Worker source не аттестован.
15. Telegram или адресный provider не прошли реальный E2E.
16. Не завершены три ПК и роли.
17. Не завершён полный FULL UI/button pass.
18. Canary telemetry отсутствует или нарушены stop-пороги.
19. Staging/pilot/stable используют разные payload SHA.
20. В release artifacts, logs или evidence найден секрет.
21. Не получен отдельный `UNATTENDED_E2E_PASS` на exact artifact.
22. Не решены product/compliance правила тарифных лимитов, retention и защиты локальных бизнес-данных.

## 25. Определение окончательного `GO`

JustFun 7.8.4 готов к публичному коммерческому релизу только одновременно при выполнении всех условий:

- `G0–G11 = PASS`;
- `0` открытых P0/P1;
- `0` известных потерь, дублей, silent rollback данных или scope violations;
- один immutable commit и один immutable payload SHA;
- финальный installer установлен и проверен на физических ПК;
- local, VPS, Telegram, addresses, maps, update и rollback приняты раздельно и вместе;
- три ПК, две компании, два склада и все роли прошли;
- полный бизнес-цикл, UI и миграции прошли;
- отдельный автономный E2E exact-кандидата завершён без участия владельца;
- backup и disaster recovery доказаны;
- production pilot прошёл stop-пороги;
- stable опубликован тем же артефактом;
- владелец получил установщик, официальный URL, backup, инструкции и способ отката;
- итоговый release report содержит доказательства, а не обещания.

До выполнения последнего пункта формулировка `полноценный релиз готов` запрещена.

## 26. Порядок выполнения без перестановок

1. `G0`: зафиксировать основу и fresh backup.
2. `G1`: завершить baseline discovery.
3. `G2`: доказать и исправить первопричину local-first data-loss gate, затем закрыть release governance.
4. `G3`: закрыть data/RBAC/warehouse/migration блокеры.
5. `G4`: закрыть VPS/License/Telegram/address integrations.
6. `G5`: закрыть business/UI и исторические регрессии.
7. `G6`: пройти полный source/CI/security/performance gate.
8. `G7`: собрать один exact immutable final candidate.
9. `G8`: выполнить direct repeat, автономный E2E и exact-artifact migration matrix.
10. `G9`: доказать production-compatible deploy, update/rollback/reapply.
11. `G10`: пройти полный exact-candidate E2E на одном физическом ПК и автоматическую многопользовательскую матрицу.
12. `G11`: провести 5%/25%/100% production canary.
13. После PASS 100%-этапа сформировать final evidence, перевести тот же GitHub Release в public stable, зафиксировать `GO` и только затем делать массовое объявление; asset и payload SHA не заменять.

## 27. Связанные обязательные документы

- [`RELEASE-READINESS-AUDIT-2026-08-26.md`](RELEASE-READINESS-AUDIT-2026-08-26.md) — подробный текущий аудит;
- [`TZ3-COMPLETE-RELEASE-SPEC.md`](TZ3-COMPLETE-RELEASE-SPEC.md) — полный функциональный объём;
- [`PROJECT-MAP.md`](PROJECT-MAP.md) — карта проекта;
- [`LIVE-ACCEPTANCE-SCENARIOS.md`](LIVE-ACCEPTANCE-SCENARIOS.md) — живые сценарии;
- [`LOCAL-FIRST-CONNECTIVITY-ACCEPTANCE.md`](LOCAL-FIRST-CONNECTIVITY-ACCEPTANCE.md) — local/offline/VPS/Telegram порядок;
- [`MULTI-TENANT-DATA-MIGRATION-SPEC.md`](MULTI-TENANT-DATA-MIGRATION-SPEC.md) — multi-tenant и миграции;
- [`UNATTENDED-E2E-AND-DATABASE-MIGRATION-SPEC.md`](UNATTENDED-E2E-AND-DATABASE-MIGRATION-SPEC.md) — автономный E2E и старые базы;
- [`ADDRESS-SEARCH-SPEC.md`](ADDRESS-SEARCH-SPEC.md) — адресный поиск;
- [`UI-INVENTORY.md`](UI-INVENTORY.md) — UI-инвентаризация;
- [`LIVE-TEST-REGISTER.md`](LIVE-TEST-REGISTER.md) и [`LIVE-TEST-REGISTER.json`](LIVE-TEST-REGISTER.json) — живые доказательства;
- [`DEFECTS.md`](DEFECTS.md) — единый реестр дефектов;
- [`RELEASE-STATUS.md`](RELEASE-STATUS.md) — оперативный статус;
- [`RELEASE-CANDIDATE.md`](RELEASE-CANDIDATE.md) — кандидаты и хэши;
- [`../UPDATE-CATALOG-OPERATIONS.md`](../UPDATE-CATALOG-OPERATIONS.md) — публикация и rollback catalog.

## 28. Итог аудита

Проект имеет сильную подготовленную основу и существенный объём реализованной функциональности. Основная проблема сейчас не в отсутствии программы, а в отсутствии единой доказанной цепочки от последнего исходного кода до exact Windows-бинарника, полного живого многопользовательского цикла, безопасной миграции, update/rollback и controlled production-canary.

Самый короткий безопасный путь к выпуску — не создавать новые параллельные архитектуры и не собирать очередной installer заранее. Сначала закрываются `MR-001–MR-003`, data/integration gates и весь discovery ledger. Затем один раз создаётся immutable-кандидат, который проходит update, rollback, три ПК, полный бизнес/UI E2E и canary без изменения байтов.

Только такой порядок позволяет выпустить программу клиентам без подмены доказательств обещаниями.

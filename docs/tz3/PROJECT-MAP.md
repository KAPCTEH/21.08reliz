# Карта проекта ТЗ №3

## Статус карты

Карта исходного проекта собрана. Она отделяет подтверждённый путь кода от ещё не выполненной живой проверки установленной Windows-программы.

- Канонический репозиторий: `C:\Users\zvd1\Desktop\JUSTFUN-AUDIT-WORK-20260821\release-main`.
- Ветка исполнения: `codex/tz3-execution-baseline`.
- Текущий проверенный product-source commit: `c45eb07242e59fa3df95724bb283ec6d90ad07ae`.
- Полный исходный UI-инвентарь: [`UI-INVENTORY.md`](UI-INVENTORY.md).
- Живые результаты: [`LIVE-TEST-REGISTER.md`](LIVE-TEST-REGISTER.md).
- Полные живые сценарии: [`LIVE-ACCEPTANCE-SCENARIOS.md`](LIVE-ACCEPTANCE-SCENARIOS.md).
- Текущий релизный статус: `NO-GO`; установка выполнена, живая приёмка на первом ПК находится `IN PROGRESS`, production и multi-PC ещё не приняты.

## Компоненты

| ID | Компонент | Основной путь | Ответственность | Source-статус | Live-статус |
|---|---|---|---|---|---|
| JF3-COMP-001 | Electron/Node приложение | `source/application` | main, preload, renderer, локальный runtime | MAPPED / TESTED PARTIALLY | INSTALLED; OWNER LOGIN PASS; UI IN PROGRESS |
| JF3-COMP-002 | WEB-интерфейс | `source/application/web` | окна, формы, карты, бизнес-функции | 302 FULL / 349 DEMO кнопок; 695 / 776 интерактивных элементов | ORDERS + TRIPS PARTIAL PASS |
| JF3-COMP-003 | Desktop runtime | `source/desktop-runtime` | защищённая упаковка Electron payload | SOURCE + WINDOWS CI PASS | INSTALLED EXE SHA-256 MATCH |
| JF3-COMP-004 | Windows Setup/Recovery | `source/installer` | установка, rollback, repair, uninstall | Windows gate `32625667386` PASS | PHYSICAL-PC INSTALL PASS; RECOVERY LIVE PENDING |
| JF3-COMP-005 | VPS REG API | `source/application/integrations/reg-vps` | бизнес-API, карты, адреса, PostgreSQL V3 | SOURCE TESTED; реальный PostgreSQL 22/22 PASS | CURRENT CHANGE NOT DEPLOYED |
| JF3-COMP-006 | License server | `source/license-server` | компания, лицензия, вход, роли, пользователи, устройства, lease/attestation | UNIT + SCHEMA TESTED | CURRENT CHANGE NOT DEPLOYED |
| JF3-COMP-007 | Telegram Worker | `source/application/integrations/telegram-cloudflare-native` | бот, webhook, группа, уведомления, удаление привязки | UNIT + SCHEMA TESTED | CURRENT CHANGE NOT DEPLOYED |
| JF3-COMP-008 | Company Telegram broker | `source/company-telegram-broker` | company/warehouse Telegram routing и deprovision | UNIT + SCHEMA TESTED | CURRENT CHANGE NOT DEPLOYED |
| JF3-COMP-009 | Update controller | `source/application/update` | политика, каталог, download, проверка и запуск Helper | SOURCE TESTED | DISABLED / NOT TESTED |
| JF3-COMP-010 | Update Helper | `source/update-helper` | транзакционная замена, откат и журнал | SOURCE TESTED | NOT TESTED |
| JF3-COMP-011 | Update catalog service | `source/update-catalog-service` | Cloudflare KV, подписанный каталог и каналы | SOURCE CHECK + PRODUCTION DRY-RUN PASS | CURRENT CHANGE NOT DEPLOYED; CATALOG NOT PUBLISHED |
| JF3-COMP-012 | Аудит/CI | `tools`, `tests`, `.github/workflows` | контракты, безопасность, Windows gate, evidence | 82 теста в каталоге; safe CI 64/64 PASS | Audit `32624837813` PASS; Windows `32624837780` PASS |

## Основной путь бизнес-данных

```text
UI-функция
  → persist*/atomic mutation guard
  → 110-desktop-platform-v750.js
  → preload.js: regVps.*
  → main.js: desktop:reg-entity-*
  → HTTPS VPS /entities/{live|demo}/batch
  → PostgreSQL business_records_v3
                 business_events_v3
                 business_commands_v3
                 business_audit_v3
  → подтверждение version/digest/cursor
  → локальный кэш и повторное чтение
```

Сервер является источником истины. `command_id` даёт идемпотентность, `base_version` останавливает устаревшую запись, RLS ограничивает компанию/склад/среду. LIVE и DEMO бизнес-данные раздельны. Реестр складов закрепляется за канонической LIVE-средой; удаление должно атомарно tombstone-удалять обе среды.

## Карта экранов и функций

| ID | Этап/экран | UI и renderer | IPC/API | Постоянные данные | Главные проверки | Live |
|---|---|---|---|---|---|---|
| JF3-UI-001 | Установка и recovery | `installer/premium-ui/MainWindow.xaml.cs`; `installer/Setup.nsi` | локальные setup/recovery процессы | `%LOCALAPPDATA%\Programs\JustFun\OrdersLogistics`; install metadata | installer source/full acceptance/crash recovery | NOT RUN |
| JF3-UI-002 | Первый запуск | `main.js`; splash; `web/index.html` | `desktop:get-session`, `desktop:renderer-ready` | локальная session/install state | `main-unit.cjs`, startup regression | NOT RUN |
| JF3-UI-003 | Лицензия, владелец, вход, приглашение | `110-desktop-platform-v750.js` auth screens | `/v1/license/check`, `/v1/owner/register`, `/v1/auth/login`, `/v1/invitations/accept` | Cloudflare D1; Electron `safeStorage` | license/auth/startup tests | NOT RUN |
| JF3-UI-004 | Компания, пользователи и устройства | user/company panels в `110-*` | `/v1/users`, invitations, access/status, `/v1/devices` | D1 users/devices/claims/audit | license server + permission tests | NOT RUN |
| JF3-UI-005 | Реестр, архивирование и удаление склада | `100-multi-warehouse-v600.js`; `110-*` reconciliation | `/v1/warehouses`; prepare/lease; V3 cascade | canonical LIVE warehouse entity; LIVE/DEMO tombstones; durable release outbox | source/unit + PostgreSQL 22/22 PASS | NOT RUN LIVE |
| JF3-UI-006 | Заказы и самовывоз | `ordersView`; `saveOrder`, `savePickup`, status/payment/delete | V3 `orders`; named intents | localStorage/IndexedDB + PostgreSQL orders/events | order integrity, atomic mutation, deep business | NOT RUN |
| JF3-UI-007 | Поиск адреса | `04-address-intelligence-v783.js`; order/warehouse address UI | `desktop:address-search`; VPS `/address-search/{env}` | DaData on demand, transient cache, ФИАС IDs/coords; без локальной базы | provider/unit/map/source tests | REAL PROVIDER NOT TESTED |
| JF3-UI-008 | Товары, остатки и движения | products/inventory views and modals | V3 `products`, `inventoryMovements`, `warehouseReservations` | scoped local data + PostgreSQL | inventory conflict/protocol/deep business | NOT RUN |
| JF3-UI-009 | Водители | `driversView`; save/delete/assignment/payment | V3 `drivers`, `routeDriverAssignments` | scoped local data + PostgreSQL | runtime/deep/permission tests | NOT RUN |
| JF3-UI-010 | Маршруты и рейсы | trips view, route composer, approve/pick/start/return/close/cancel | `desktop:maps-route`; VPS OSRM fallback; V3 intents | route entities, executions, archives, reservations | map/protocol/deep business | NOT RUN |
| JF3-UI-011 | Отчётность | reports view, employee/expense forms, print/CSV | клиентский расчёт; V3 `reportingData` | scoped settings/data + exported files | runtime/deep/protocol | NOT RUN |
| JF3-UI-012 | Настройки и оформление | settings/program/company/warehouse panels | V3 `settings`/`company`; separate VPS/Telegram/update IPC | scoped local + PostgreSQL; protected desktop state | experience/tokens/runtime | NOT RUN |
| JF3-UI-013 | Telegram | integration panel, warehouse binding, driver/route actions | broker `/v1/company/telegram/*`; Worker `/v1/*` | broker D1 + Worker D1 + local delivery status | broker/worker/scope tests | NOT RUN |
| JF3-UI-014 | Обновления | `111-update-center-v783.js` | update controller → signed catalog → Update Helper | `%LOCALAPPDATA%\JustFun\OrdersLogistics\Update` | каталог 82 теста; safe CI 64/64 PASS | DISABLED / KEY NOT PROVIDED |
| JF3-UI-015 | Backup/restore/print/export | renderer backup/import/print/CSV functions | local file/print bridge where applicable | JSON/CSV/print artifacts | runtime/source tests | NOT RUN |

## UI-инвентарь начального состояния

| Edition | Кнопки | Интерактивные элементы | Безопасные изолированные кандидаты | Разрушительные/дорогие |
|---|---:|---:|---:|---:|
| FULL | 302 | 695 | 88 | 41 |
| DEMO | 349 | 776 | 90 | 41 |

Это source/JSDOM-инвентарь, а не доказательство реального клика, правильного размера или единого стиля. Полные записи находятся в JSON evidence.

## Подтверждённые незакрытые ворота

1. Production VPS не обновлён и не проверен после текущего lifecycle-инкремента.
2. Изменения License, Telegram Worker, broker и update catalog service не развёрнуты в production и не проверены после миграций.
3. Реальный DaData-ключ и эталонный корпус адресов не проверены.
4. Корневой Ed25519-ключ обновлений отсутствует; каталог и payload не опубликованы.
5. Текущий Windows RC установлен и запущен на одном физическом ПК; полный живой цикл функций на этом ПК ещё не завершён.
6. Не выполнены полная визуальная проверка, второй пользователь и несколько физических ПК.
7. Telegram компании/складов/водителей не принят в production.

## Контракты текущего исходного кода

| Контракт | Версия |
|---|---:|
| Telegram broker | 4 |
| Подготовка удаления склада | 1 |
| Защитный lease удаления | 3 |
| Удаление Telegram-привязки через broker | 3 |
| Удаление нативной Telegram-привязки | 1 |
| VPS attestation | 1 |
| Надёжная очередь освобождения lease | 1 |
| Версия company Telegram broker | `1.3.0` |

## Проверенные доказательства текущего SHA

- GitHub Audit incremental `32625667383`: текущая ветка `9659088`, `PASS`.
- Обязательный PostgreSQL 16 gate в run `32624837813`: 22 из 22 интеграционных тестов прошли без пропусков.
- Постоянный audit-ledger синхронизирован коммитом `1f4f52f` и содержит 82 теста.
- Windows native release gate `32625667386`: `PASS`; сборка, installer UI, hidden visual acceptance, interrupted-update recovery, изолированная установка, ярлык/иконка, SBOM и evidence прошли.
- Artifact `9489746908`: `justfun-windows-ac822fd4e6653496bee58fccc0750be4706d5282`, 1 327 268 715 байт, digest `sha256:b21f5e4941fa3f36e5bf9209ba353dd0aac614b7383296faf336bb0fcab79345`.
- Физический ПК: установленная версия `7.8.3` запущена; SHA-256 `OrdersLogistics.exe` совпал с manifest текущего artifact; вход нового владельца и пустой экран заказов нового склада подтверждены.
- GitHub artifact attestation в pull-request run была штатно пропущена; это нельзя считать подписью финального релиза.

Карта исходников не превращает проект в готовый релиз. Статус меняется только после доказательств соответствующего живого Gate.

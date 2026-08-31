# Исходные проверки ТЗ №3

## Проверенная версия

- Commit: `b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568`
- Время цикла: 2026-08-23, Europe/Moscow
- Режим: локальные изолированные проверки, без production VPS и реального Telegram

## Результаты

| Группа | Результат | Подтверждение |
|---|---|---|
| Release contract | PASS | 78 тестов, 0 failures |
| Security audit | PASS | 172 файла, 0 findings, 0 forbidden artifacts |
| Source hygiene | PASS | exact-commit archive contract, 277 tracked files |
| Static overrides | PASS | 56 bindings, 23 controlled overrides |
| Update core | PASS | 43 проверки |
| Update downloader | PASS | 15 проверок |
| Update controller | PASS | 48 проверок |
| Update UI | PASS | 58 проверок |
| Update Helper runner | PASS | 16 проверок |
| Evidence builder | PASS | 4 группы |
| REG entity source contract | PASS | server entities, idempotency, permissions, conflicts |
| Current cycle | PASS | склад, переключение, карта, водители, маршруты |
| Experience regression | PASS | startup, picker, address cleanup, reports, integrations |
| Visual/release contracts | PASS | оба теста успешны |
| Order save integrity | PASS | create/edit/pickup/delete/restore paths |
| Atomic mutation | PASS | commit и rollback paths |
| Background sync failure | PASS | dirty state и audit preserved |
| Deep business | PASS | 69/69; 70 заказов, 62 товара, 18 водителей |

## Чего эти результаты не доказывают

- работу установленного EXE на компьютере владельца;
- production VPS/PostgreSQL;
- production Cloudflare/Telegram;
- одновременную работу трёх физических ПК;
- каждый реальный клик;
- единый визуальный стиль;
- интеллектуальный поиск адресов Stage 39;
- подписанный живой update/rollback.

## Инкремент адресного поиска `4ba860a25cceb2cef4a43c85ea25a0fc9cd030b3`

| Проверка | Результат | Подтверждение |
|---|---|---|
| Address intelligence unit/integration | PASS | нормализация, опечатки, номер, регион, дедупликация, Top-3, детерминизм, debounce, ручная карта |
| JavaScript syntax | PASS | новый модуль и основной renderer |
| Release contract | PASS | 79 тестов каталога, 0 failures |
| Map diagnostic | PASS | отмена устаревшего поиска и диагностический trace сохранены |
| Runtime smoke | PASS | 24/24 скрипта, 0 runtime errors, 349 кнопок обнаружено |
| Security | PASS | 150 файлов application, 0 findings; security regression PASS |
| Current cycle / experience | PASS | обе регрессии успешны |
| Visual / release / tokens | PASS | контракты успешны, legacy visual risk не закрыт |

Это подтверждает только исходный код и изолированный runtime. Реальная полнота адресной базы и качество на живых адресах пока не доказаны.

## Адресный provider-инкремент после уточнения владельца

| Проверка | Результат | Подтверждение |
|---|---|---|
| REG address provider | PASS | 9 изолированных тестов: строгий контракт, DaData adapter, ФИАС-код, координаты, очистка внешнего ответа, transient cache, explicit Nominatim, отсутствие локальной базы |
| Public Nominatim policy guard | PASS | автоматический режим не может перейти на public Nominatim; явный режим отделён контрактом |
| Desktop address broker | PASS | provider-first, company/warehouse/environment scope, повреждённый ответ отклоняется |
| Updater compatibility | PASS | `address_search=1` обязателен в подписанном update catalog |
| Installer source | PASS | 20/20 после изменения VPS installer |
| Runtime smoke | PASS | 24/24 скрипта, 349 кнопок, 0 runtime errors; стенд дополнен стандартным Chromium API `structuredClone` |
| Security / hygiene / static audit | PASS | 173 файла, 0 findings; 286 tracked files; 56 bindings / 23 overrides |
| Current cycle / experience / release / visual / tokens | PASS | все выборочные регрессии затронутой области успешны |

Зафиксированный source commit: `ad4136d` (`feat: add scoped on-demand address search`).

Не проверено: реальный DaData API, production VPS, фактические лимиты тарифа, точность живых ответов и Windows UI. Ключ в исходный код не добавлялся.

## Инкремент загрузки обновлений `bdce184`

| Проверка | Результат | Подтверждение |
|---|---|---|
| Update downloader | PASS | 19 проверок, включая разрешённый GitHub redirect и запрет перехода на чужой домен |
| Update core / controller / UI | PASS | 44 / 48 / 58 |
| Update Helper runner | PASS | 16 |
| Catalog Worker / operations | PASS | 23 / 15 |
| Cloudflare source check | PASS | Wrangler `4.125.0`, types актуальны, production dry-run успешен |
| Live public Worker health | PASS | staging и production HTTP 200; каталоги ожидаемо `CATALOG_NOT_PUBLISHED` |
| Release contract / security | PASS | 80 тестов; 173 файла, 0 findings |

Всего в update/catalog наборе: 223 успешные проверки. Production-обновление остаётся выключенным: доверенный приватный/публичный Ed25519-ключ отсутствует, каталог и реальный payload не опубликованы.

## JF3-S0075 — source-fix batch после живого прохода

| Проверка | Результ |
|---|---|
| Release contract | PASS, 83/83 |
| Security audit | PASS, 188 файлов, 0 findings, 0 forbidden artifacts |
| Source hygiene | PASS, 312 tracked files |
| Deep business runtime | PASS, 69/69 |
| Accessibility runtime | PASS, 969 controls |
| Print / save / atomic / local durability | PASS |
| Offline restart / retry / idempotency | PASS |
| Address provider | PASS, 10 тестов + реальный typo-запрос |
| Telegram proxy transport | PASS, Electron `net.request` adapter |
| VPS backup permissions / SSH timeout | PASS, source/installer/native tests |
| Diagnostics action dispatch and audit | PASS |
| Experience / visual / release / installer source | PASS |

Эти проверки доказывают состояние исходников. Они не доказывают исправление в старой установленной сборке. До закрытия нужны exact-commit build, полная приёмка установщика и живой production-повтор.

# Карта проекта ТЗ №3

## Статус

Карта создана на Stage 0 и будет заполняться только подтверждёнными связями по мере чтения кода и живой приёмки.

## Верхнеуровневые компоненты

| ID | Компонент | Проверенный путь | Назначение | Статус карты |
|---|---|---|---|---|
| JF3-COMP-001 | Windows/Electron приложение | `source/application` | UI, main/preload, локальный runtime | IN PROGRESS |
| JF3-COMP-002 | Защищённый payload | `source/desktop-runtime` | Упаковка и Electron runtime | IN PROGRESS |
| JF3-COMP-003 | Windows Setup/Recovery | `source/installer` | Установка, восстановление, удаление | IN PROGRESS |
| JF3-COMP-004 | VPS REG API | `source/application/integrations/reg-vps` | Серверная бизнес-модель и PostgreSQL | IN PROGRESS |
| JF3-COMP-005 | Telegram integration | `source/application/integrations/telegram-cloudflare-native` | Telegram/Cloudflare путь | IN PROGRESS |
| JF3-COMP-006 | Company Telegram broker | `source/company-telegram-broker` | Связь компании/склада с Telegram | IN PROGRESS |
| JF3-COMP-007 | License server | `source/license-server` | Авторизация, роли, company scope | IN PROGRESS |
| JF3-COMP-008 | Update Helper | `source/update-helper` | Транзакционное обновление и откат | IN PROGRESS |
| JF3-COMP-009 | Update catalog service | `source/update-catalog-service` | Подписанный каталог обновлений | IN PROGRESS |

## Реестр UI → код → сервер → данные → тест

| ID | Экран/элемент | UI-код | IPC/API | Сервер/хранилище | Тест | Живой результат |
|---|---|---|---|---|---|---|
| JF3-UI-0001 | Создание доставки → поле адреса и «Найти адрес и район» | `web/index.html`; `04-address-intelligence-v783.js`; `searchDeliveryAddress`, `geocodeSearch`, `rankGeocodeResults` в `00-app-bundle-v595.js` | `desktop:maps-geocode`; `resolveDesktopMapGeocode` в `main.js`; fallback `POST /v1/maps/geocode` | Nominatim direct или `proxy_geocode` в REG VPS; постоянного адресного индекса нет | `address-intelligence-unit-v783.cjs`, `main-unit.cjs`, `reg-map-proxy-test.py` | SOURCE PARTIAL PASS; LIVE NOT TESTED; BLOCKER OPEN |
| JF3-UI-0002 | Выбор результата адреса | `selectSearchResult`, `parseNominatimResult`, `setSelectedGeo` | reverse geocode через тот же IPC/API | Координаты/адрес сохраняются в `order.geo` текущего склада | текущие runtime smoke частично | LIVE NOT TESTED |
| JF3-UI-0003 | Клик/перетаскивание маркера карты | `ensureOrderMap`, `placeOrderMarker`, `reverseGeocode` | `desktop:maps-geocode`, mode `reverse` | Nominatim reverse; ручные region/district при отказе | source regression частично | LIVE NOT TESTED |

## Подтверждённые пробелы карты

- Полный первый экран установленной программы ещё не инвентаризирован.
- Не создана карта всех 396+ обнаруживаемых кнопок.
- Не выполнено живое сопоставление UI → IPC/API → VPS → PostgreSQL.
- Текущая адресная цепочка не реализует Stage 39; см. `JF3-BLOCKER-002`.

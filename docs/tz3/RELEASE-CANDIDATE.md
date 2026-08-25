# Кандидат в релиз ТЗ №3

## Текущее состояние после JF3-S0076

Точный защищённый кандидат `f7c6324cad3def8aba6075ab5405cb9098d637d3` собран, прошёл full installer acceptance, установлен на физический ПК и проверен в production VPS, Telegram/Cloudflare и серверной мутации заказа с повторным запуском. Production VPS и основной Telegram provisioning теперь проходят. Открыты привязка реальной Telegram-группы, свежая local→server миграция с pending outbox, совместимый invitation lifecycle для второго пользователя, второй ПК, signed update/rollback и оставшаяся адресная/диагностическая матрица. Текущий общий gate: `NO-GO`.

## Текущий защищённый кандидат RC-7.8.3-f7c6324

| Поле | Значение |
|---|---|
| Статус | УСТАНОВЛЕН — VPS, Telegram provisioning и online sync/restart прошли; финальные cross-device/update gates открыты |
| Git SHA | `f7c6324cad3def8aba6075ab5405cb9098d637d3` |
| Build ID | `jf-7.8.3-f7c6324cad3d` |
| Release contract | `83/83` |
| Security audit | 191 файл, 0 findings |
| Business runtime | `69/69` |
| Full installer acceptance | PASS |
| Установщик | SHA-256 `b0993eff67e60c89fae86cb0a8dbaa7e4f192eee4cf5782eecffdc691770400c`, `209918032` байта |
| Комплект владельца | SHA-256 `6e050ecb86109653f7e52f3b978375c87d3daa8f7c7f612955e70662dd5907f9`, `426634852` байта |
| Установленный ASAR | SHA-256 `b00ded40ee7952e6c990a318f0053118996496818d550c8570283239ee537ad4`, совпадает с кандидатом |
| Production VPS | 7.8.3, PostgreSQL ready, миграция и SSH fingerprint wait PASS |
| Telegram | Worker + shared D1 schema 3 + webhook PASS; временный Cloudflare token не сохранён |
| Серверная команда | `ORD-2026-0005` подтверждён cursor 379; после restart 4 заказа / 10 400 ₽ |
| Authenticode | Не обязателен по решению владельца |

## Новый защищённый кандидат RC-7.8.3-0748a21

| Поле | Значение |
|---|---|
| Статус | СОБРАН И ИЗОЛИРОВАННО ПРОВЕРЕН — живая установка и production-приёмка впереди |
| Git SHA | `0748a21a323eb2adf4f75c5d46854b384e4e501e` |
| Release contract | `82/82` |
| Security audit | 187 файлов, 0 findings |
| Business runtime | `69/69` |
| PDF gate | 5 документов, пройден |
| Full installer acceptance | PASS: setup `0`, uninstall `0`, данные сохранены, исходное состояние восстановлено |
| Установщик | SHA-256 `5b13db0557ffed0c90d2c6e16e41a2ccf9e024247a4cb824719e419fa338c879`, `209843792` байта |
| Комплект владельца | SHA-256 `a0a6ebef0fa2922b58e300fa954cd64c08bae19038e976e738f3b8769ab34faf`, `426542490` байт, 9 элементов |
| Authenticode | Не обязателен по решению владельца |

## Текущий установленный RC-7.8.3-9659088

| Поле | Значение |
|---|---|
| Статус | УСТАНОВЛЕН — живая приёмка выполняется |
| Версия | 7.8.3 |
| Ветка / HEAD | `codex/tz3-execution-baseline` / `965908883996c124c18ce37fe8ff7f4439568128` |
| Product-source | `c45eb07242e59fa3df95724bb283ec6d90ad07ae` |
| PR build merge SHA | `ac822fd4e6653496bee58fccc0750be4706d5282` |
| Windows run | `32625667386`, success |
| Audit run | `32625667383`, success |
| Artifact ID | `9489746908` |
| Artifact digest | `sha256:b21f5e4941fa3f36e5bf9209ba353dd0aac614b7383296faf336bb0fcab79345` |
| Установленный EXE | SHA-256 `c7e943e9b100cbb98f1df9565a851e46904a4bc5df10704c902f6c7034e3f163`, точное совпадение с manifest |
| Authenticode | Не обязателен по решению владельца |

Подтверждены установка на физический ПК, запуск 7.8.3, вход нового владельца, пустой новый склад, целостность runtime и отсутствие секретов в строках журнала текущего запуска.

## Исходный кандидат RC-BASELINE-7.8.3-b3a9e7c0

| Поле | Значение |
|---|---|
| Статус | BASELINE ONLY — не финальный кандидат |
| Версия | 7.8.3 |
| Git SHA | `b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568` |
| GitHub `main` совпадает | Да |
| Windows run | `32600392031`, success |
| Audit run | `32600392032`, success |
| Artifact ID | `9482860446` |
| Artifact name | `justfun-windows-b3a9e7c0f2892b4e3276b51ca5c0ee1760e88568` |
| Artifact size | `1325925788` байт |
| Artifact digest | `sha256:c1c3ef9ca65fbaf05b687ee46bc5f1215025f4683f385ac1a485538900cc8973` |
| Artifact expiry | `2026-09-05T21:54:11Z` |
| Authenticode | Не обязателен по решению владельца |

## Почему текущий RC ещё не финальный

1. `release_status` равен `development`.
2. Автоматическое обновление отключено: корневой Ed25519-ключ и доверенный подписанный каталог отсутствуют.
3. Production VPS, License, Telegram Worker, broker и update catalog ещё не приняты в полном живом цикле.
4. Реальный адресный provider и эталонный корпус адресов не проверены.
5. Полная проверка каждого раздела, кнопки и бизнес-функции на установленном ПК не завершена.
6. Не выполнены второй пользователь/устройство, четыре заказа, маршруты, статусы, водители, отчётность, удаление и восстановление.
7. Не выполнен production-canary обновления с проверенным откатом.

## Правило неизменяемости

После любого изменения релизного кода этот baseline не может быть объявлен финальным установщиком. Новый кандидат должен получить новый Git SHA, новую GitHub Actions-сборку, новые хеши и отдельный полный цикл доказательств.

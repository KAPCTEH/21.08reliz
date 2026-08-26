# Кандидат в релиз ТЗ №3

## Текущее состояние после JF3-S0081

Переходная защищённая 7.8.3 установлена и сохранила рабочие данные. Точный desktop 7.8.4 из `00ee971a6665e848ee20ae9c7ddc2c5528ff74be` собран и прошёл полный setup→uninstall→data preservation; `JF3-DEFECT-044` закрыт. GitHub prerelease и подписанный staging-каталог опубликованы, публичные байты каталога совпали с Git, а штатный updater 7.8.3 реально проверил подпись и полностью скачал payload с точным размером/SHA-256. Применение обновления, перезапуск, health confirmation, доказанный rollback, stable-canary и остальные cross-device/адресные/Telegram gates ещё открыты. Общий gate: `NO-GO`.

## Текущий кандидат RC-7.8.4-00ee971

| Поле | Значение |
|---|---|
| Статус | WINDOWS BUILD + SIGNED STAGING + FULL VERIFIED DOWNLOAD PASS — apply, rollback и stable-canary впереди |
| Git SHA продукта | `00ee971a6665e848ee20ae9c7ddc2c5528ff74be` |
| Build ID | `jf-7.8.4-00ee971a6665` |
| Release contract | `83/83` |
| Security audit | 197 файлов, 0 findings |
| Business runtime | `69/69` |
| Payload manifest | 81/81 файл |
| Setup | SHA-256 `c0c79003db54e0f18e4008e5fad9c00536f2e674e0ae6ffc3d7bf28a5e9959e9`, `209882192` байта |
| Update ZIP | SHA-256 `b5d6e9668fca6d106003413a56034bb518d952d934c7d0fc382fad21a82be6f0`, `183201489` байт |
| Защищённый ASAR | SHA-256 `0d2531a88992018d6dde53aa7f2619b48ebc3258942170edde0330f6c8eb83f1` |
| Full installer acceptance | PASS: setup `0`, uninstall `0`, удаление `24.524` с, данные сохранены, errors `0` |
| Комплект владельца | SHA-256 `d21ff3384907009527de987087733b688eb753c0bc1129bd51134e75b32ecb2f`, `426606543` байта, 9 элементов |
| Authenticode | Не обязателен по решению владельца |

## Отклонённый кандидат RC-7.8.4-4c19539

| Поле | Значение |
|---|---|
| Статус | ОТКЛОНЁН — full uninstall acceptance FAIL, `RELEASE-GATE=false` |
| Git SHA | `4c19539d03d6a9e5e27a7b47b4059f5448fed82c` |
| Build ID | `jf-7.8.4-4c19539d03d6` |
| Release contract | `83/83` |
| Security audit | 195 файлов, 0 findings |
| Business runtime | `69/69` |
| Setup | SHA-256 `af6c9773aab5596a92f987b5a33fdced43fd5f9f19a7d9132c93659c764caa2d`, `209836624` байта |
| Update ZIP | SHA-256 `94dda02047de0f77f80056267d8544f4cc64e5736009bf56f4646917f3239e53`, `183201483` байта |
| Full acceptance | setup `0`; uninstall не удалил файлы за `120.111` с |
| Причина | `application probe returned timeout state=NOT_RUNNING` |

## Текущая переходная сборка RC-7.8.3-8981380

| Поле | Значение |
|---|---|
| Статус | УСТАНОВЛЕНА — updater включён, данные сохранены, проверка каталога выполнена |
| Git SHA | `8981380ea6af11a2d4bd6f58e61a5420b3d1e0e7` |
| Build ID | `jf-7.8.3-8981380ea6af` |
| Release contract | `83/83` |
| Security audit | 193 файла, 0 findings |
| Business runtime | `69/69` |
| Setup | SHA-256 `4c7a3fed57a21e3f3dcb6e0c1e0fa720a16499beaab047f01fbb6ef51c5bfce4`, `209844304` байта |
| Update ZIP | SHA-256 `1bb6103087425e5641a0b01310f47e4ccf05710c9b67cc6c50e14b57bbb9a016`, `183201291` байт |
| Установленный ASAR | SHA-256 `e8bfde1630cc2d70fa122ef22a488fd22fa1713851568ec8eef287d21cc92821` |
| Сохранность данных | 280/280 файлов; после запуска 4 заказа / 10 400 ₽ |
| Update center | 7.8.3 / stable / активен; каталог 404, применение заблокировано |

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

1. Финальный desktop 7.8.4 собран и локально принят, staging-каталог опубликован, но версия ещё не установлена через живое подписанное обновление.
2. Доверенный Ed25519-ключ, GitHub prerelease payload и подписанный staging-каталог подтверждены; stable-каталог и canary ещё не опубликованы.
3. Production VPS и Telegram provisioning прошли, но реальная группа Telegram и полный update/rollback ещё не приняты.
4. Реальный адресный provider и эталонный корпус адресов не проверены.
5. Полная проверка каждого раздела, кнопки и бизнес-функции на установленном ПК не завершена.
6. Не выполнены второй пользователь/устройство, четыре заказа, маршруты, статусы, водители, отчётность, удаление и восстановление.
7. Не выполнен production-canary обновления с проверенным откатом.

## Правило неизменяемости

После любого изменения релизного кода этот baseline не может быть объявлен финальным установщиком. Новый кандидат должен получить новый Git SHA, новую GitHub Actions-сборку, новые хеши и отдельный полный цикл доказательств.

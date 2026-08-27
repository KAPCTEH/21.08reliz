# Эксплуатация каталога обновлений JustFun

## Что реализовано

Cloudflare Worker `source/update-catalog-service` имеет только публичные операции чтения:

- `GET /health`;
- `GET /v1/catalog/internal`;
- `GET /v1/catalog/staging`;
- `GET /v1/catalog/stable`;
- `HEAD` для тех же каталогов.

Worker не подписывает каталоги, не принимает публикации по HTTP и не содержит приватный ключ. Источник доверия — Ed25519-подпись, которую независимо проверяют desktop-клиент и Update Helper.

## Хранилище и резервная копия

Активный документ хранится в Cloudflare KV под ключом `catalog:<channel>`. Перед активацией workflow сохраняет точные байты текущего и нового документов под неизменяемыми по соглашению ключами `history:<channel>:<sequence>:<sha256>`.

Production и staging обязаны использовать разные заранее созданные KV namespaces. Их реальные ID не записываются в репозиторий: до запуска workflow администратор задаёт repository variables `CLOUDFLARE_UPDATE_CATALOG_PRODUCTION_KV_NAMESPACE_ID` и `CLOUDFLARE_UPDATE_CATALOG_STAGING_KV_NAMESPACE_ID`. Оба значения обязательны, должны быть 32-значными hex ID и не могут совпадать. Публикация обращается к выбранному ID через `--namespace-id`, а deploy генерирует временный Wrangler config с обоими явными bindings; автоматическое создание namespace в release workflow не используется.

Cloudflare KV имеет eventual consistency: распространение изменения может занять до 60 секунд. Поэтому каталог отдаётся с обязательной revalidation, а workflow после записи повторно читает и сравнивает точные байты. Два выпуска одного канала сериализованы GitHub concurrency.

## Подпись

Подпись создаётся только оригинальным Ed25519-ключом, соответствующим публичному ключу в `source/application/update/trusted-keys.json`:

```powershell
node tools/release/update-catalog-ops.mjs sign `
  --input release/catalogs/stable-unsigned.json `
  --output release/catalogs/stable.json `
  --trust-store source/application/update/trusted-keys.json `
  --key-id RELEASE_KEY_ID `
  --private-key-path C:\PROTECTED\release-private.pem `
  --build-identity C:\PROTECTED\evidence\build-identity.json `
  --build-manifest C:\PROTECTED\evidence\BUILD-MANIFEST.json
```

Инструмент не принимает приватный ключ текстом, не печатает его и отказывается подписывать, если закрытый ключ не соответствует встроенному публичному.

Для директив `release` и `rollback` оба файла доказательств обязательны. Они должны быть получены из успешного Windows workflow для точного Git SHA и совпадать с каталогом по версии, build ID, commit SHA, контрактам, имени payload, размеру и SHA-256. Директива `halt` этих двух файлов не требует.

## Выпуск

1. Staging публикуется вручную workflow `Publish staging update catalog` через защищённое окружение `update-staging`.
2. Stable начинается с 5%, затем разрешён переход к 25% и только затем к 100%; уменьшение процента обычным `release`-каталогом запрещено.
3. Каждый шаг — новый подписанный каталог с большей `catalog_sequence`.
4. Workflow `Publish stable update catalog` использует защищённое окружение `update-production`.
5. Staging создаёт GitHub prerelease. Первый stable-шаг для того же точного tag/SHA/asset переводит существующий prerelease в full release и помечает его latest; workflow после изменения повторно проверяет `prerelease=false` и `/releases/latest`.

Пакет хранится в GitHub Release. GitHub может вернуть `302` на фактический домен Release Assets. Клиент допускает не более трёх таких переходов, повторно проверяет HTTPS и allowlist на каждом шаге, а затем обязательно сверяет подписанный размер и SHA-256. Переход на любой другой домен блокируется.

В GitHub Environments `update-staging` и `update-production` должны быть настроены ручное подтверждение и две изолированные пары environment secrets:

- `CLOUDFLARE_PUBLISH_API_TOKEN`, `CLOUDFLARE_PUBLISH_ACCOUNT_ID` — токен только для записи Workers KV;
- `CLOUDFLARE_DEPLOY_API_TOKEN`, `CLOUDFLARE_DEPLOY_ACCOUNT_ID` — отдельный токен только для Workers Scripts deploy/version operations.

Общие `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` не используются как fallback, а caller workflows не применяют `secrets: inherit`. Отсутствие любой требуемой пары блокирует операцию до обращения к Cloudflare.

## Остановка и откат

- `halt`: `rollout_percent=0`, проблемный build указан в `withdrawn_build_ids`;
- `rollback`: безопасный payload предыдущей версии является целью, а затронутые установленные версии перечислены в `rollback_from_versions`;
- публикация `halt` или `rollback` обязана отозвать текущий активный build; откат обязан назвать текущую активную версию источником;
- документ обязательно имеет новую последовательность и правильную подпись;
- `rollback` дополнительно загружает доверенные `build-identity.json` и `BUILD-MANIFEST.json` из успешного Windows workflow для точного исторического commit SHA и до записи KV проверяет публичную доступность ZIP, его размер и SHA-256;
- публикация выполняется workflow `Halt or roll back update release`.

Доверенный Windows-артефакт хранится 90 дней. После его истечения workflow намеренно блокирует автоматический `rollback`, если доказательства не перенесены в отдельное долгосрочное защищённое хранилище. Каждая успешная публикация дополнительно создаёт `update-catalog-rollback-<channel>-<run_id>` с точным target/previous catalog digest, планом, build run ID, namespace ID и payload evidence; отсутствие этого файла делает workflow ошибочным.

Если новый каталог отзывает уже скачанный build до применения, контроллер переводит операцию в безопасное неустанавливаемое состояние. Восстановление старого KV-файла не является допустимым клиентским откатом из-за защиты от replay.

## Откат кода Worker

Workflow развертывания сохраняет списки Cloudflare Worker versions до и после операции и обязательный `.worker-rollback-evidence.json` в артефакте `update-catalog-worker-<target>-<run_id>` на 90 дней. Возврат к предыдущей версии выполняется штатным `wrangler rollback <VERSION_ID>` только по зафиксированному идентификатору. Каталоги в KV эта команда не меняет.

## Текущий блокер production

Публичные staging и production Worker работают. Точный payload 7.8.4 собран, опубликован в GitHub prerelease и описан подписанным staging-каталогом. Переходная 7.8.3 реально проверила Ed25519-подпись и полностью скачала payload с точным размером и SHA-256. Код workflows теперь требует отдельные publish/deploy credentials и два различных явных KV namespace ID; наличие и права новых external secrets/variables должны быть подтверждены в GitHub перед следующим запуском. Подготовлен подписанный staging sequence `2` для доказательства реальной записи GitHub Actions.

Открытые блокеры: обновлённый Windows gate (timeout 180 минут), publication/deploy workflows и staging sequence `2` должны пройти новые GitHub runs; новые environment secrets и repository variables ещё не подтверждены; обновление не применено; health confirmation и автоматический rollback не доказаны; stable-каталог и canary 5→25→100 не опубликованы. До завершения этих доказательств выпуск остаётся `NO-GO`.

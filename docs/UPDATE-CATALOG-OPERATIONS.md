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

Cloudflare KV имеет eventual consistency: распространение изменения может занять до 60 секунд. Поэтому каталог отдаётся с обязательной revalidation, а workflow после записи повторно читает и сравнивает точные байты. Два выпуска одного канала сериализованы GitHub concurrency.

## Подпись

Подпись создаётся только оригинальным Ed25519-ключом, соответствующим публичному ключу в `source/application/update/trusted-keys.json`:

```powershell
node tools/release/update-catalog-ops.mjs sign `
  --input release/catalogs/stable-unsigned.json `
  --output release/catalogs/stable.json `
  --trust-store source/application/update/trusted-keys.json `
  --key-id RELEASE_KEY_ID `
  --private-key-path C:\PROTECTED\release-private.pem
```

Инструмент не принимает приватный ключ текстом, не печатает его и отказывается подписывать, если закрытый ключ не соответствует встроенному публичному.

## Выпуск

1. Staging публикуется вручную workflow `Publish staging update catalog` через защищённое окружение `update-staging`.
2. Stable начинается с 5%, затем разрешён переход к 25% и только затем к 100%; уменьшение процента обычным `release`-каталогом запрещено.
3. Каждый шаг — новый подписанный каталог с большей `catalog_sequence`.
4. Workflow `Publish stable update catalog` использует защищённое окружение `update-production`.

В GitHub Environments должны быть настроены ручное подтверждение и секреты `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Остановка и откат

- `halt`: `rollout_percent=0`, проблемный build указан в `withdrawn_build_ids`;
- `rollback`: безопасный payload предыдущей версии является целью, а затронутые установленные версии перечислены в `rollback_from_versions`;
- публикация `halt` или `rollback` обязана отозвать текущий активный build; откат обязан назвать текущую активную версию источником;
- документ обязательно имеет новую последовательность и правильную подпись;
- публикация выполняется workflow `Halt or roll back update release`.

Если новый каталог отзывает уже скачанный build до применения, контроллер переводит операцию в безопасное неустанавливаемое состояние. Восстановление старого KV-файла не является допустимым клиентским откатом из-за защиты от replay.

## Откат кода Worker

Workflow развертывания сохраняет списки Cloudflare Worker versions до и после операции. Возврат к предыдущей версии выполняется штатным `wrangler rollback <VERSION_ID>` только по зафиксированному идентификатору. Каталоги в KV эта команда не меняет.

## Текущий блокер production

В репозитории пока нет доверенного публичного ключа и production-каталога. До предоставления исходного совпадающего приватного ключа, добавления его публичной части, создания реального payload и прохождения staging автообновления остаются выключенными.

# Сопоставление предыдущего реестра

Предыдущие документы использованы только как кандидаты; их статусы не переносились без текущего source/test/live подтверждения.

| Предыдущие ID | Текущий результат |
|---|---|
| JF-DATA-001 | Частично покрыт текущими storage-v3 тестами; новый конкретный дефект выделен как JF-AUDIT-0001. |
| JF-SRC-002, JF-CF-001..003 | Объединены по фактическому live source drift в JF-AUDIT-0004. |
| JF-ARCH-002, JF-UI-003 | Объединены по измеримому CSS ratchet в JF-AUDIT-0005. |
| JF-SRC-001, JF-SRC-003 | Закрыты для нового clean tree и source ZIP точной allowlist-проверкой. |
| JF-QA-001..004 | Большинство regressions проходит; новые дефекты harness выделены как JF-AUDIT-0002 и JF-AUDIT-0003. |
| JF-AUTH-001, JF-ERR-001/002, JF-ROUTE-001..003, JF-ASYNC-001 | Соответствующие source regressions прошли; live/release утверждение не делается. |
| JF-WIN-001, JF-A11Y-002, JF-OPS-001 | Не закрыты текущей source-базой; требуют нового executable/PDF/live evidence. |

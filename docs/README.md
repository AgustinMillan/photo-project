# Documentación

Documentación de producto, arquitectura y modelo de datos de Photo Platform.

- [01 — Documento maestro de producto](01-documento-maestro-producto.md)
- [02 — Arquitectura técnica](02-arquitectura-tecnica.md)
- [03 — Plan de implementación](03-plan-implementacion.md)
- [04 — Modelo de datos / ERD](04-modelo-datos-erd.md)
- [05 — Estado de desarrollo y brecha para el MVP](05-estado-desarrollo-mvp.md)

## ADRs

- [ADR-0001 - Autenticación con JWT access + refresh](adr/0001-autenticacion-jwt-access-refresh.md)
- [ADR-0002 - Autorización y aislamiento por tienda](adr/0002-autorizacion-aislamiento-tenant.md)
- [ADR-0003 - Planes, suscripciones y entitlements](adr/0003-planes-suscripciones-entitlements.md)

## Convenciones

- `04-modelo-datos-erd.md` es la fuente de verdad del modelo.
- Las decisiones que reemplazan supuestos previos se registran como ADR.
- Las migraciones SQL se generan desde Drizzle y se revisan antes de aplicar.
- Ninguna tabla tenant-scoped se consulta solo por `id`; siempre se incluye `store_id` y autorización.

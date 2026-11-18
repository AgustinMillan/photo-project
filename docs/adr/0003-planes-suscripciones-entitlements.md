# ADR-0003: Planes, suscripciones y entitlements

- **Estado:** aceptado con valores comerciales provisionales
- **Fecha:** 2026-11-17
- **Decisores:** equipo de producto y desarrollo
- **Complementa:** ADR-0001, ADR-0002 y las secciones 5.3 y 7.8 del ERD

## Contexto

La Fase 2 necesita aplicar límites y capacidades sin acoplar el código funcional al nombre de un plan. También necesita una suscripción por cuenta, un trial que empiece al crear la primera tienda y guardas reutilizables para equipo y compras. El MVP todavía no tiene pasarela de pago ni flujo de facturación.

## Decisión

1. **Entitlements, no nombres de plan:** `plans` y `plan_entitlements` viven en la base. El código consulta claves estables como `stores.max`, `team.enabled`, `team.max_members` y `purchases.enabled`; nunca compara `plan.code === "business"`.
2. **Suscripción de cuenta:** una cuenta tiene como máximo una suscripción abierta (`ended_at IS NULL`). La cobertura es de toda la cuenta en v1.
3. **Inicio del trial:** la primera tienda crea la suscripción `trial` en la misma transacción que la tienda, la membresía `OWNER` y el subdominio. Si la tienda falla, el trial también se revierte.
4. **Plan inicial configurable:** `TRIAL_PLAN_CODE` (por defecto `base`) y `TRIAL_DURATION_DAYS` (por defecto 30) son configuración de entorno. `POST /api/v1/stores` acepta `planCode` solo cuando se crea el trial; cambiarlo después requiere el flujo de facturación futuro y responde `PLAN_CHANGE_NOT_ALLOWED`.
5. **Estados utilizables:** solo `trial` y `active` habilitan entitlements. `expired`, `cancelled` y `suspended` bloquean nuevas capacidades, pero no eliminan tiendas, archivos, pedidos ni derechos ya adquiridos.
6. **Expiración perezosa:** al leer una suscripción se marca `expired` si terminó el trial o el período. El cambio se registra en `subscription_events`. No se depende de un cron para la corrección funcional.
7. **Límite de tiendas:** se aplica con `stores.max`. La creación bloquea la fila de la cuenta, cuenta las tiendas no eliminadas y crea la nueva tienda en la misma transacción. El error estable es `STORE_LIMIT_REACHED`.
8. **Equipo:** `team.enabled` se verifica en el backend para listar, invitar, aceptar, cambiar roles o remover miembros. Si no está habilitado se responde `TEAM_FEATURE_DISABLED`. `team.max_members` se aplica al invitar y aceptar; el error es `TEAM_MEMBER_LIMIT_REACHED`.
9. **Compras:** la guarda reutilizable `assertStorePurchasesEnabled` exige tienda activa, cuenta activa, suscripción `trial`/`active` y `purchases.enabled`. Si falla, responde `409 STORE_PURCHASES_DISABLED` con un motivo estable. La Fase 5 la usará en el checkout; las compras pagadas anteriores no se tocan.
10. **Configuración inicial provisional:** Base e Intermedio permiten una tienda; Business permite 10 tiendas y 10 miembros de equipo. Todos los planes habilitan compras. Estos valores son filas de `plan_entitlements` y pueden cambiarse sin desplegar código.
11. **Historial:** `subscription_events` es append-only desde la aplicación y registra creación del trial, expiración y futuros cambios de plan o estado.

## Consecuencias

- El frontend puede ocultar módulos, pero el backend siempre vuelve a comprobar la capacidad.
- Un plan retirado no se puede elegir para un trial nuevo, pero las suscripciones existentes conservan su referencia.
- Las cuentas creadas antes de la Fase 2 reciben un trial de base al migrar si tienen tiendas y nunca tuvieron suscripción.
- El bloqueo de compras no altera pedidos, pagos ni descargas ya existentes.
- La facturación real, el cambio de plan y la política de downgrade quedan fuera de la Fase 2.

## Alternativas consideradas

- **Condiciones por nombre de plan:** rápidas de escribir, pero dispersan la regla comercial y obligan a desplegar código para cambiar límites; descartado.
- **Suscripción por tienda:** complica la cobertura multi-tienda y la unidad de facturación; se mantiene por cuenta en v1.
- **Cron exclusivo para expirar:** puede dejar ventanas de inconsistencia si el job falla; se usa expiración perezosa más un historial.
- **Confiar en el frontend para ocultar equipo o compras:** no cumple el aislamiento ni los límites; descartado.

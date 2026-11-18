# ADR-0002: Autorización y aislamiento por tienda

- **Estado:** aceptado
- **Fecha:** 2026-11-16
- **Decisores:** equipo de producto y desarrollo
- **Complementa:** ADR-0001 y la sección 7 del ERD

## Contexto

El MVP es un SaaS multi-tenant. Cada tienda es un tenant operativo y puede tener un equipo con roles distintos. La autorización no puede depender de filtros del frontend ni de identificadores enviados en el body: el backend debe resolver el tenant desde una fuente confiable y comprobar la membresía en cada operación administrativa.

También necesitamos que la creación inicial de una tienda no deje estados parciales y que las invitaciones no permitan escalar privilegios.

## Decisión

1. **Tenant desde la ruta:** las rutas administrativas reciben `storeId` en el path. El backend verifica que el usuario autenticado sea propietario de la cuenta o tenga una membresía activa en esa tienda. El `storeId` del body no se acepta como fuente de autorización.
2. **Propietario implícito:** el propietario de la cuenta (`accounts.owner_user_id`) tiene acceso `OWNER` a todas las tiendas de la cuenta, aunque la membresía explícita falte. La membresía `OWNER` se crea igualmente para trazabilidad.
3. **Respuestas de autorización:** si el usuario no tiene acceso a la tienda se responde `404 STORE_NOT_FOUND`, para no confirmar la existencia de tenants ajenos. Si tiene acceso pero el rol no alcanza, se responde `403 INSUFFICIENT_STORE_ROLE`.
4. **Roles:** `OWNER` tiene control total; `ADMIN` gestiona contenido, operaciones y equipo, pero no puede gestionar administradores ni cambiar el slug; `PHOTOGRAPHER` y `EDITOR` no gestionan equipo ni configuración sensible.
5. **Propiedad inmutable:** la membresía del propietario de la cuenta no se puede cambiar ni remover en 1C. No se pueden crear invitaciones con rol `OWNER`. La transferencia de propiedad será un flujo separado, explícito y auditado.
6. **Creación transaccional:** crear una tienda inserta en una sola transacción la tienda, la membresía `OWNER` y el subdominio de plataforma verificado. Un fallo en cualquier paso revierte todo.
7. **Slugs:** se normalizan a minúsculas, tienen entre 3 y 63 caracteres, solo letras/números/guiones, sin guiones al inicio/fin ni consecutivos. Se rechazan los slugs reservados y la unicidad es case-insensitive. La base de datos refuerza el formato con `stores_slug_format_check`.
8. **Resolución de tenant público:** el storefront se resuelve por hostname contra `store_domains`, exigiendo dominio verificado y tienda activa. El endpoint público devuelve solo datos públicos mínimos.
9. **Invitaciones:** el token es opaco, se guarda hasheado, expira y es de un solo uso. Para aceptar, el email del usuario autenticado debe coincidir con el email invitado. El rol `OWNER` no es asignable por invitación.
10. **Auditoría:** las operaciones de cuenta, tienda, membresía e invitación registran actor, tenant, entidad, acción y cambios relevantes en `audit_logs`.

## Consecuencias

- Todas las consultas de entidades tenant-scoped deben incluir el `storeId` autorizado; un `WHERE id = :id` aislado no es suficiente.
- El frontend puede ocultar acciones, pero la decisión final siempre está en el backend.
- Cambiar el slug requiere actualizar el dominio primario en la misma transacción.
- Las invitaciones pendientes se pueden revocar, pero no reutilizar.
- La resolución pública no expone datos de la cuenta ni del equipo.
- La transferencia de propiedad y la gestión de dominios personalizados quedan fuera de 1C.

## Alternativas consideradas

- **Confiar en un `accountId` o `storeId` del body:** permitiría cruzar tenants; descartado.
- **Resolver la tienda solo desde el JWT:** obligaría a reemitir tokens al cambiar roles y no serviría para storefront público; descartado.
- **Crear la tienda en varios requests:** puede dejar tiendas sin membresía o sin dominio; descartado.
- **Permitir invitaciones `OWNER`:** facilitaría escaladas de privilegio y conflictos de propiedad; descartado para 1C.

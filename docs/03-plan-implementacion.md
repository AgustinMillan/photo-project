# Plan de implementación

**Versión:** 1.2 — 17 de noviembre de 2026  
**Estado:** Plan actualizado; cada fase requiere revisión y aprobación antes de ejecutarse.

## Principios de ejecución

- No pedir a Claude Code y sus agentes que construya todo el sistema en una sola instrucción.
- Cada fase debe producir software ejecutable, pruebas y documentación.
- Antes de modificar código, Claude Code y sus agentes debe inspeccionar el repositorio y reportar estructura, stack, convenciones y riesgos.
- No reemplazar decisiones confirmadas por preferencias del agente.
- No introducir dependencias o servicios externos sin justificar y aprobar.
- Cada fase termina con pruebas, revisión de diff y criterios de aceptación.
- Mantener migraciones pequeñas y reversibles cuando sea posible.
- No avanzar automáticamente a la fase siguiente.
- No implementar entidades o flujos excluidos del MVP aunque parezcan una extensión natural.

## Decisiones de producto que condicionan el plan

- La suscripción pertenece a `Account`, cuyo propietario paga y administra la facturación.
- Business cubre las tiendas de la cuenta propietaria según entitlements; no hay `SubscriptionStore` en v1.
- Los colaboradores invitados no pagan suscripción individual. Acceden por membresía y rol asignado a cada tienda.
- Los roles son `OWNER`, `ADMIN`, `PHOTOGRAPHER` y `EDITOR`, aplicados por tienda.
- Una foto pertenece como máximo a un álbum. Al eliminar un álbum se puede liberar sus fotos o archivar álbum y fotos.
- Reemplazar una foto crea una nueva versión y un nuevo asset inmutable; las compras históricas conservan la versión adquirida.
- Las ventas externas y los trabajos/servicios ya realizados se registran en `ManualWorkRecord`, separado de pedidos y pagos.
- El MVP no incluye catálogo público de servicios, presupuestos, reservas, contratación ni marketplace.
- Los derechos de descarga se generan únicamente al confirmar el pedido y apuntan a la versión exacta adquirida.

## Fase 0 — Descubrimiento, consistencia y aprobación del ERD

**Objetivo:** inspeccionar el entorno real y cerrar decisiones que afectan el diseño de datos antes de crear migraciones.

Tareas:

1. Inspeccionar repositorio, entorno local/VPS y estado de servicios.
2. Confirmar framework backend, ORM, frontend y versiones compatibles.
3. Proponer estructura del monolito modular y límites de dominio.
4. Revisar el ERD completo: Users, Accounts, Stores, Subscriptions, Entitlements, Memberships, catálogo, Media, Orders, Payments, Entitlements de descarga, ManualWorkRecords e historial/Audit.
5. Verificar todas las cardinalidades y FKs compuestas tenant-safe.
6. Resolver la contradicción sobre si `User` puede poseer varias `Account` y la restricción `UNIQUE(accounts.owner_user_id)`.
7. Cerrar política de cobertura Business, máximo de tiendas, downgrade y permisos de equipo.
8. Definir tenant resolution, roles y permisos granulares.
9. Definir el pipeline de media y el swap transaccional de versiones.
10. Definir snapshots de composición de álbum y derechos históricos.
11. Definir política de retención, backups, publicación y despliegue.
12. Crear ADRs para decisiones estructurales.

Entregables:

- Informe de descubrimiento.
- Diagrama de módulos.
- ERD revisado con cardinalidades, índices y FKs compuestas.
- Lista de decisiones pendientes con alternativas y recomendación.
- Esqueleto de OpenAPI inicial, si corresponde.
- ADRs aprobados.

**Criterio de aceptación:** el usuario aprueba el modelo de datos y las decisiones técnicas bloqueantes. No implementar funcionalidades de producto ni migraciones definitivas todavía.

## Fase 1 — Fundaciones, identidad y aislamiento

**Objetivo:** establecer una base segura, multi-tenant y desplegable.

Tareas:

- Configuración del proyecto, entornos y secretos.
- PostgreSQL y migraciones iniciales.
- Logging estructurado y health checks.
- `User`, registro, login, logout, verificación de email, sesiones y recuperación.
- `Account` y perfil comercial.
- `Store`, creación inicial, slugs y dominios de plataforma.
- `StoreMembership`, invitaciones y roles por tienda.
- Acceso OWNER implícito del propietario de la cuenta y membresía explícita para trazabilidad.
- Middleware de autorización y `TenantContext` obligatorio.
- Auditoría inicial append-only.
- Pruebas automatizadas de aislamiento entre tiendas.

Criterios de aceptación:

- Una identidad puede registrarse y verificar email.
- Se crea una cuenta y una tienda sin estados parciales.
- Slugs duplicados/reservados se rechazan.
- Una cuenta sin membresía ni propiedad aplicable no accede a datos privados.
- Los roles se validan en backend por tienda.
- Un colaborador solo accede a tiendas donde tiene membresía activa.
- Tests cross-tenant pasan.

## Fase 2 — Suscripciones, entitlements y límites Business

**Objetivo:** aplicar capacidades comerciales a nivel de cuenta.

Tareas:

- Planes Base, Intermedio y Business.
- `plan_entitlements` configurables.
- Suscripción por `account_id`, estados e historial.
- Inicio de trial al crear primera tienda.
- Una tienda en Base/Intermedio; multi-tienda Business según `stores.max`.
- Entitlement `team.enabled` y límites de miembros si se aprueban.
- Invitaciones a colaboradores sin suscripción individual.
- Guardas de funcionalidades y de nuevas compras.
- Política de cancelación, expiración y downgrade aprobada.

Criterios de aceptación:

- La suscripción y billing pertenecen a la cuenta propietaria.
- Los colaboradores no pagan ni necesitan un plan propio para colaborar.
- Base/Intermedio no crean una segunda tienda.
- Business crea tiendas dentro del límite configurado.
- El módulo Equipo solo opera cuando el entitlement lo permite.
- La expiración bloquea nuevas compras sin borrar derechos previos.

## Fase 3 — Storefront, configuración y publicación

**Objetivo:** publicar la primera tienda configurable.

Tareas:

- Convertir Nocturne Cyanotype en componentes de plantilla.
- Identidad del fotógrafo y configuración de tienda.
- Panel de configuración, sin drag-and-drop.
- Secciones habilitadas, orden según entitlements y contenido validado.
- Borrador y publicación explícita mediante snapshots versionados.
- Resolución pública por subdominio.
- Diseño responsive, estados vacíos y errores.

Criterios de aceptación:

- Dos tiendas usan la misma plantilla con contenido distinto.
- Editar un borrador no altera la versión pública.
- La publicación actual es inmutable y versionada.
- No aparece catálogo público de servicios ni flujos de cotización/reserva/contratación.
- El hostname resuelve la tienda correcta.

## Fase 4 — Catálogo, álbumes y media versionada

**Objetivo:** administrar fotografías/álbumes con procesamiento seguro e historial de versiones.

Tareas:

- CRUD de álbumes y fotografías.
- `Photo.album_id` nullable y FK compuesta para impedir asociación entre tenants.
- Acciones diferenciadas de eliminar álbum liberando fotos y archivar álbum + fotos.
- Estados de catálogo, orden y publicación.
- Carga segura de originales fuera del webroot.
- `MediaAsset`, procesamiento asíncrono, checksum y derivados.
- `PhotoAssetVersion` con una sola versión actual por foto.
- Reemplazo: procesar nuevo asset primero y luego hacer swap transaccional de versión actual.
- Watermark configurable y eliminación de EXIF en derivados públicos, según decisiones aprobadas.
- Reintentos idempotentes y limpieza segura de temporales.

Criterios de aceptación:

- Una foto no pertenece a más de un álbum ni a un álbum de otra tienda.
- Las dos acciones de borrado producen resultados distintos y auditables.
- Originales no accesibles públicamente.
- Fallos de procesamiento no reemplazan la versión actual.
- Reemplazar foto conserva assets/versiones anteriores.
- Un tenant no puede consultar ni modificar media ajena.

## Fase 5 — Carrito, pedidos, pagos y derechos digitales

**Objetivo:** preparar y confirmar compras sin simular pagos.

Tareas:

- Carrito de invitado y cliente autenticado.
- Agregar/quitar fotos y álbumes.
- Deduplicación de contenido cubierto por álbum.
- Checkout con bloqueo de carrito y recálculo de precios.
- Snapshot de precios, composición de álbum y versiones exactas.
- `Order` y `Payment` separados; múltiples intentos, sin `payment_status` duplicado.
- Confirmación manual auditada si se aprueba como método para pedidos de plataforma; integración de pasarela en fase posterior.
- `OrderEntitlement` por foto solo después de confirmar pedido.
- Tokens de acceso a pedido invitado y recuperación verificada.
- Descargas autorizadas y logs.
- Reembolso/revocación con auditoría según política aprobada.

Criterios de aceptación:

- Álbum + foto incluida no genera doble cobro ni doble entitlement.
- Un pedido conserva precio, composición y versión adquirida.
- Un pedido impago no genera derechos.
- Un pago insuficiente no confirma la orden.
- Una compra anterior descarga la versión anterior tras reemplazo.
- No se puede cambiar ID/tenant para descargar archivos ajenos.
- La suscripción vencida bloquea compras nuevas, no derechos previos.

## Fase 6 — Actividad manual: ventas externas y trabajos realizados

**Objetivo:** registrar la actividad comercial que ocurre fuera del checkout de la plataforma.

Tareas:

- CRUD de `ManualWorkRecord` para ventas externas y trabajos/servicios realizados.
- Estados y campos de importe/moneda opcionales según tipo.
- `manual_work_record_history` append-only.
- Auditoría de creación, modificación, archivo y restauración.
- Separación explícita en consultas y métricas respecto de pedidos online.

Criterios de aceptación:

- Los registros pertenecen a una tienda y tienen autor.
- Los cambios generan historial append-only.
- No crean `Order`, `Payment`, `OrderEntitlement` ni tokens de descarga.
- No publican servicios, no reciben cotizaciones, no reservan turnos y no permiten contratar.
- Las estadísticas diferencian ventas online confirmadas de importes externos declarados manualmente.

## Fase 7 — Panel, clientes, estadísticas y equipo

**Objetivo:** consolidar operaciones en el dashboard.

Tareas:

- Inicio con resumen.
- Clientes e historial de pedidos.
- Pedidos y pagos.
- Actividad manual.
- Métricas de visitas y ventas.
- Separación entre ingresos confirmados online y actividad externa declarada.
- Equipo Business: invitaciones, roles y revocaciones.
- Estado de suscripción y límites.

Criterios de aceptación:

- Pedidos impagos no se cuentan como ingresos confirmados.
- Actividad manual no se presenta como pago procesado por la plataforma.
- Métricas y listados están filtrados por tienda.
- Equipo está protegido por rol y entitlement.
- Billing queda reservado al propietario de la cuenta.

## Fase 8 — Endurecimiento y beta

**Objetivo:** preparar el producto para usuarios piloto.

Tareas:

- Revisión de seguridad y pruebas de autorización.
- Pruebas de carga básicas.
- Límites de subida y protección de archivos.
- Backups externos y prueba de restauración.
- Monitorización de disco, CPU, memoria, colas y errores.
- Revisión de privacidad, términos, impuestos, facturación y obligaciones legales.
- Pruebas end-to-end de registro, invitación, publicación, compra, reemplazo y descarga.
- Manual de operación y recuperación.

Criterios de aceptación:

- Flujos críticos funcionan en un entorno similar a producción.
- Existe un procedimiento probado de backup/restore.
- No hay vulnerabilidades críticas conocidas sin mitigación.
- Se documenta cómo desplegar, observar y recuperar el servicio.

## Integración de pagos automatizados

La selección del proveedor y la integración de pasarela/webhooks se ejecutarán como una fase específica posterior a la definición de proveedor, conciliación, idempotencia, reembolsos y obligaciones fiscales. No simular pagos ni dar derechos por redirects.

## Protocolo de trabajo con Claude Code y sus agentes

Para cada fase:

1. Entregar únicamente el alcance de esa fase y los documentos vigentes.
2. Solicitar primero un plan de cambios, archivos afectados y riesgos.
3. Revisar y aprobar el plan antes de permitir modificaciones amplias.
4. Implementar en incrementos pequeños.
5. Ejecutar tests, lint, typecheck y build aplicables.
6. Revisar migraciones, seguridad y diff.
7. Actualizar documentación y registrar decisiones.
8. Aceptar formalmente la fase antes de iniciar la siguiente.

## Orden recomendado

Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6 → Fase 7 → Fase 8.

No avanzar de fase automáticamente. El marketplace y los flujos públicos de servicios quedan fuera de este plan MVP.


## Protocolo de dirección y ejecución con Claude

Claude actúa como responsable ejecutivo operativo del proyecto: propone estrategia, prioriza, coordina agentes y responde por la calidad de sus recomendaciones. El propietario humano conserva la titularidad legal, el control de cuentas y la aprobación de gastos y acciones irreversibles.

### Cadencia de trabajo

1. Mantener un registro de objetivos, métricas, hipótesis, decisiones y riesgos.
2. Al inicio de cada ciclo, presentar el objetivo comercial y técnico más importante, el resultado esperado y el costo estimado.
3. Dividir el trabajo en tareas delegables con responsable/agente, archivos afectados, dependencias y criterios de aceptación.
4. Revisar los resultados de los agentes; no aceptar sus reportes sin inspeccionar diffs, pruebas y evidencia.
5. Mantener el roadmap actualizado y cancelar tareas que no contribuyan al MVP, validación comercial o reducción de riesgos.
6. Al cerrar cada ciclo, informar resultados, métricas, gasto comprometido, saldo del presupuesto y siguiente decisión.

### Regla de inversión

El presupuesto máximo inicial autorizado para gastos externos es **ARS 50.000 acumulados**, excluyendo expresamente el costo de la IA utilizada en esta conversación y cualquier otro costo de IA que el propietario decida excluir por escrito.

- El presupuesto es un techo, no una meta de gasto.
- Claude no tiene autorización para pagar, contratar, suscribir, renovar ni comprometer dinero.
- Antes de cualquier gasto, debe presentar proveedor, importe final en ARS, impuestos/comisiones, recurrencia, duración, cancelación, objetivo, hipótesis, alternativa gratuita/barata y criterio de éxito.
- Solo el propietario puede aprobar cada gasto de forma explícita.
- Sin aprobación, la acción por defecto es no gastar.
- Llevar un registro acumulado de gastos aprobados, ejecutados y pendientes. No asumir que el presupuesto se renueva mensualmente.
- Si una cotización cambia, caduca o excede lo aprobado, solicitar nueva autorización.
- No dividir compras para eludir el límite.
- Cuando el presupuesto restante no alcance, proponer una opción gratuita, negociar alcance o detener la iniciativa.

### Decisiones que siempre requieren aprobación humana

- Cualquier pago o compromiso económico.
- Contratos, términos legales, privacidad, impuestos o promesas comerciales vinculantes.
- Acceso o cambios en producción, DNS, dominios, cuentas bancarias, pasarelas y credenciales.
- Borrado irreversible, migraciones destructivas o cambios de datos reales.
- Publicidad pagada, campañas que comprometan reputación o comunicaciones masivas.
- Cambio de alcance que altere decisiones confirmadas del producto.

Claude puede decidir autónomamente prioridades, experimentos sin costo, asignación de agentes dentro de permisos existentes, propuestas técnicas reversibles y tareas de investigación. Debe explicar sus decisiones y permitir que el propietario las revoque.

### Regla de foco comercial

La prioridad no es terminar todo el roadmap a cualquier costo. Es encontrar el camino más corto y seguro para validar que fotógrafos reales publican su tienda, cargan fotografías y están dispuestos a pagar. No sacrificar aislamiento multi-tenant, seguridad de archivos, integridad de pedidos ni derechos de descarga para acelerar una demo.

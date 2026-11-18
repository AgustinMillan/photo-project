# Estado de desarrollo y brecha para el MVP

**Versión:** 1.1  
**Fecha:** 17 de noviembre de 2026  
**Estado:** Fase 2 completada. Fase 3 no iniciada.  
**Fuentes:** `docs/01-documento-maestro-producto.md`, `docs/02-arquitectura-tecnica.md`, `docs/03-plan-implementacion.md`, `docs/04-modelo-datos-erd.md`, `docs/adr/0003-planes-suscripciones-entitlements.md`, `README.md` y código actual.

---

## 1. Resumen ejecutivo

El proyecto tiene terminado el **núcleo backend de identidad, cuentas, tiendas, equipo, aislamiento multi-tenant, planes, suscripciones y entitlements**. La Fase 2 quedó implementada y verificada con pruebas unitarias, integración contra PostgreSQL real, migraciones, build y un smoke test del servidor compilado.

Todavía **no existe el producto visible para el usuario final**:

- No hay frontend ni storefront.
- No hay catálogo de álbumes/fotografías.
- No hay subida, procesamiento ni entrega de imágenes.
- No hay carrito, pedidos, confirmación de pagos ni derechos de descarga.
- No hay registro de ventas externas o trabajos manuales.
- No hay dashboard.
- No hay endurecimiento de producción, backups ni despliegue.

En términos del plan:

| Fase | Alcance | Estado |
|---|---|---|
| Fase 0 | Descubrimiento, arquitectura, ERD y ADRs | Completada |
| Fase 1 | Fundaciones, autenticación, cuentas, tiendas, equipo y aislamiento | Completada |
| Fase 2 | Planes, suscripciones, trial, entitlements y límites | Completada |
| Fase 3 | Storefront y configuración | No iniciada |
| Fase 4 | Catálogo y media | No iniciada |
| Fase 5 | Carrito, pedidos, pagos manuales y derechos digitales | No iniciada |
| Fase 6 | Servicios profesionales | Fuera del MVP confirmado; post-MVP |
| Fase 7 | Panel, clientes y estadísticas | No iniciada |
| Fase 8 | Endurecimiento y beta | No iniciada |

### Cobertura funcional actual

| Área | Estado | Detalle |
|---|---|---|
| Fundaciones técnicas | Completa | Monorepo, PostgreSQL, migraciones, CI, health checks |
| Identidad y autenticación | Completa | Registro, verificación, login, refresh, logout, recuperación |
| Cuentas, tiendas y equipo | Completa | Creación transaccional, roles, invitaciones, aislamiento |
| Planes y entitlements | Completa | Trial, límites, guardas de equipo y compras |
| Storefront | No iniciado | Sin backend de configuración ni UI pública |
| Catálogo y media | No iniciado | Sin álbumes, fotos, uploads ni derivados |
| Carrito, pedidos y descargas | No iniciado | Sin clientes, carrito, pedidos, pagos ni derechos |
| Dashboard | No iniciado | Sin panel de administración |
| Frontend | No iniciado | `frontend/` no tiene una aplicación implementada |
| Endurecimiento y beta | No iniciado | Sin backups, monitorización, TLS ni despliegue |

**Lectura correcta:** están completas 3 de las 8 fases del plan. Para el MVP confirmado faltan las fases **3, 4, 5, 7 y 8**. La Fase 6 no debe ejecutarse como parte del MVP.

---

## 2. Qué se considera MVP en este documento

El MVP es un SaaS multi-tenant para que un fotógrafo pueda:

1. Registrarse, verificar su email y crear una cuenta.
2. Crear una tienda con subdominio de plataforma.
3. Configurar y publicar una tienda pública.
4. Subir fotografías y organizarlas en álbumes.
5. Vender fotografías individuales y álbumes.
6. Recibir pedidos y confirmar pagos sin pasarela, sin simular confirmaciones.
7. Entregar descargas digitales de los originales comprados.
8. Administrar el negocio desde un panel básico.
9. Mantener aislamiento estricto entre tiendas y aplicar límites de plan en backend.

### Fuera del MVP

- Marketplace o directorio público.
- Servicios profesionales, solicitudes de presupuesto, mensajes, reservas y calendario.
- Reseñas.
- Pasarela de pagos y webhooks de proveedores.
- Aplicación móvil.
- Editor visual drag-and-drop.
- Nuevas plantillas.
- Panel de administración global de la plataforma.
- Comisiones de marketplace y funciones avanzadas de estudio no definidas.

> **Nota de alcance:** `docs/03-plan-implementacion.md` conserva una Fase 6 de servicios profesionales, pero ya está marcada como post-MVP. Según el alcance confirmado, esa fase no debe ejecutarse como parte del MVP.

---

## 3. Qué está implementado hoy

### 3.1 Fundaciones técnicas

- Monorepo con pnpm workspaces.
- Backend Node.js 22, TypeScript, Fastify 5, Zod, Drizzle ORM.
- PostgreSQL 17 y Mailpit mediante Docker Compose.
- Migraciones SQL versionadas.
- Configuración de entorno validada con Zod.
- Logging estructurado, manejo centralizado de errores, CORS, Helmet, cookies y rate limiting.
- Health checks:
  - `GET /api/v1/health/live`
  - `GET /api/v1/health/ready`
- CI con instalación, lint, typecheck, migraciones, tests y build.

### 3.2 Identidad y autenticación

- Registro con Argon2id y email único case-insensitive.
- Verificación de email con tokens opacos de un solo uso.
- Login con JWT de acceso y refresh token rotativo en cookie `HttpOnly`.
- Detección de reutilización de refresh tokens y revocación de la familia.
- Logout de la sesión actual y de todos los dispositivos.
- Recuperación de contraseña con tokens de un solo uso.
- Rate limiting específico por endpoint.
- Auditoría de eventos de autenticación.
- Endpoints principales:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/verify-email`
  - `POST /api/v1/auth/resend-verification`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/forgot-password`
  - `POST /api/v1/auth/reset-password`
  - `GET /api/v1/auth/me`

### 3.3 Cuentas, tiendas, equipo y aislamiento

- Una cuenta comercial por usuario en v1.
- Creación transaccional de tienda, membresía `OWNER` y subdominio verificado.
- Slugs normalizados, validados y únicos sin distinguir mayúsculas.
- Resolución pública por hostname.
- Roles `OWNER`, `ADMIN`, `PHOTOGRAPHER` y `EDITOR`.
- Autorización por membresía y rol en backend.
- Respuesta `404` para usuarios sin acceso, evitando revelar tiendas ajenas.
- Invitaciones con token opaco, email, expiración, aceptación y revocación.
- Protección de la membresía del propietario y reglas para administradores.
- Auditoría de cuentas, tiendas, miembros e invitaciones.
- Endpoints principales:
  - `POST /api/v1/accounts`
  - `GET /api/v1/accounts/me`
  - `PATCH /api/v1/accounts/me`
  - `POST /api/v1/stores`
  - `GET /api/v1/stores`
  - `GET /api/v1/stores/:storeId`
  - `PATCH /api/v1/stores/:storeId`
  - `GET /api/v1/stores/:storeId/members`
  - `PATCH /api/v1/stores/:storeId/members/:userId`
  - `DELETE /api/v1/stores/:storeId/members/:userId`
  - `GET /api/v1/stores/:storeId/invitations`
  - `POST /api/v1/stores/:storeId/invitations`
  - `DELETE /api/v1/stores/:storeId/invitations/:invitationId`
  - `POST /api/v1/invitations/accept`
  - `GET /api/v1/public/stores/resolve`

### 3.4 Planes, suscripciones y entitlements

- Tablas:
  - `plans`
  - `plan_entitlements`
  - `subscriptions`
  - `subscription_events`
- Planes seed: `base`, `intermediate`, `business`.
- Entitlements iniciales:
  - `stores.max`
  - `team.enabled`
  - `team.max_members`
  - `custom_domain.enabled`
  - `sections.reorder`
  - `purchases.enabled`
- Trial creado en la misma transacción que la primera tienda.
- Selección opcional de plan inicial con `planCode` en `POST /api/v1/stores`.
- Expiración perezosa de suscripciones con historial.
- Límite de tiendas aplicado en backend con bloqueo de la fila de la cuenta.
- Guardas de equipo por entitlement y capacidad de miembros.
- Guarda reutilizable de compras para el futuro checkout.
- Endpoints:
  - `GET /api/v1/accounts/me/subscription`
  - `GET /api/v1/accounts/me/entitlements`
  - `GET /api/v1/stores/:storeId/features`
  - `GET /api/v1/stores/:storeId/sales-status`
- La resolución pública incluye `purchasesEnabled`.
- Códigos estables:
  - `STORE_LIMIT_REACHED`
  - `SUBSCRIPTION_INACTIVE`
  - `TEAM_FEATURE_DISABLED`
  - `TEAM_MEMBER_LIMIT_REACHED`
  - `STORE_PURCHASES_DISABLED`
  - `PLAN_NOT_FOUND`
  - `PLAN_CHANGE_NOT_ALLOWED`

### 3.5 Tablas existentes en base

Actualmente existen 14 tablas:

`users`, `user_sessions`, `email_verification_tokens`, `password_reset_tokens`, `accounts`, `stores`, `store_memberships`, `store_invitations`, `store_domains`, `plans`, `plan_entitlements`, `subscriptions`, `subscription_events`, `audit_logs`.

No existen todavía tablas de storefront, catálogo, media, clientes, carrito, pedidos, pagos, derechos de descarga ni registros manuales.

### 3.6 Verificación realizada

Última verificación de Fase 2:

- `pnpm format`: correcto.
- `pnpm lint`: correcto.
- `pnpm typecheck`: correcto.
- `pnpm test`: **22 pruebas unitarias aprobadas**.
- `pnpm test:integration`: **43 pruebas de integración aprobadas**.
- `pnpm build`: correcto.
- `pnpm db:migrate`: aplicado en desarrollo y test.
- `pnpm db:seed`: correcto.
- Smoke test del servidor compilado:
  - `health/live` → `ok`
  - `health/ready` → `database: ok`

### 3.7 Flujo end-to-end disponible hoy

El siguiente recorrido funciona por API, sin frontend:

1. Registrar usuario.
2. Verificar email desde el enlace enviado a Mailpit.
3. Iniciar sesión y obtener access token.
4. Crear cuenta comercial.
5. Crear tienda; se crea el trial, la membresía `OWNER` y el subdominio.
6. Consultar suscripción, entitlements y estado de ventas.
7. Invitar miembros y aceptar invitaciones, si el plan lo permite.
8. Resolver la tienda por hostname y consultar `purchasesEnabled`.

Lo que todavía no existe en ese recorrido: configurar la tienda, subir fotos, armar un catálogo, comprar, pagar, descargar o administrar desde un panel.

---

## 4. Qué falta para completar el MVP

### 4.1 Fase 3 — Storefront y configuración

**Estado:** no iniciada.

**Backend faltante:**

- Tablas:
  - `store_settings`
  - `store_profiles`
  - `store_themes`
  - `store_sections`
  - `store_publications`
- CRUD de configuración de tienda.
- Identidad pública del fotógrafo: nombre visible, biografía, logo, portada, contacto y redes.
- Configuración de secciones: habilitar/deshabilitar, orden y contenido.
- Validación de `sections.reorder` según plan.
- Borrador separado de versión publicada.
- Publicación explícita con snapshot inmutable.
- Endpoint público completo por hostname, no solo datos mínimos.
- Activación/desactivación de secciones según entitlements.
- Validación de `custom_domain.enabled` si los dominios propios entran en el MVP.
- Flujo de verificación de dominio personalizado y TLS, si se decide incluirlo.

**Frontend faltante:**

- El directorio `frontend/` no contiene una aplicación implementada.
- Scaffold React + Vite + TypeScript + Tailwind.
- Design system inicial basado en Nocturne Cyanotype.
- Storefront público responsive.
- Estados vacíos, errores y carga.
- Panel de configuración de tienda.
- Vista previa de borrador.
- Separación visual entre borrador y publicado.

**Dependencias y decisiones:**

- Definir si los dominios personalizados son MVP o post-MVP.
- Resolver el uso de logo/portada antes de que exista el módulo de media; puede hacerse con placeholders o adelantar parte de Fase 4.
- Definir el payload público exacto de la tienda.

**Criterio de salida:**

- Dos tiendas pueden usar la misma plantilla con contenido distinto.
- Editar un borrador no altera la versión pública.
- Los límites de personalización se aplican en backend.
- El hostname correcto resuelve la tienda correcta.
- La tienda pública funciona con datos de tienda y plantilla, no con contenido hardcodeado.

---

### 4.2 Fase 4 — Catálogo y media

**Estado:** no iniciada.

**Backend faltante:**

- Tablas:
  - `albums`
  - `photos`
  - `media_assets`
  - `photo_asset_versions`
  - `media_variants`
- CRUD de álbumes.
- CRUD de fotografías.
- Relación opcional `Photo.album_id`.
- Restricción estricta: una fotografía pertenece como máximo a un álbum.
- Orden, publicación, ocultamiento y archivo.
- Subida segura de archivos.
- Validación de MIME real, extensión, tamaño, dimensiones y decodificación.
- Original privado fuera del webroot.
- Derivados públicos: miniatura, web, preview con marca de agua.
- Procesamiento asíncrono con estado y reintentos.
- Checksum y metadatos saneados.
- Configuración de marca de agua por tienda.
- Abstracción de almacenamiento (`local` inicialmente, preparada para object storage).
- Protección contra acceso directo a originales.
- Pruebas de aislamiento de media entre tiendas.

**Frontend faltante:**

- Panel de álbumes.
- Panel de fotografías.
- Subida con progreso y errores.
- Selección de portada.
- Previsualización con marca de agua.
- Galería pública de álbumes y fotografías.

**Decisiones pendientes:**

- Librería/worker de procesamiento de imágenes.
- Formato y tamaños de derivados.
- Límites de subida y almacenamiento.
- Uso de almacenamiento local en MVP y estrategia de migración futura.
- Si el watermark personalizado es MVP o solo el watermark básico.

**Criterio de salida:**

- Una foto no puede asociarse a dos álbumes.
- Un tenant no puede consultar ni modificar media ajena.
- Los originales no son accesibles públicamente.
- Las versiones públicas tienen marca de agua cuando corresponde.
- Los fallos de procesamiento no dejan registros inconsistentes.

---

### 4.3 Fase 5 — Carrito, pedidos, pagos manuales y derechos digitales

**Estado:** no iniciada.

Esta es la fase que convierte el backend actual en un producto vendible. Es la brecha funcional más importante después del frontend.

**Backend faltante:**

- Tablas:
  - `customers`
  - `carts`
  - `cart_items`
  - `orders`
  - `order_items`
  - `order_item_photos`
  - `payments`
  - `order_entitlements`
  - `download_tokens`
  - `download_logs`
  - `order_access_tokens`
  - `manual_work_records`
  - `manual_work_record_history`
- Carrito para invitado y cliente autenticado.
- Agregar/quitar fotografías y álbumes.
- Deduplicación: comprar un álbum y una foto contenida no genera doble cobro.
- Snapshot de títulos, precios, moneda y composición del álbum al crear el pedido.
- Separación estricta entre estado de pedido y estado de pago.
- Creación de pedido idempotente.
- Confirmación de pago manual/administrativa auditada, sin pasarela y sin simular pagos.
- Registro de ventas externas en `manual_work_records`, nunca como `Order.source = manual`.
- Generación de derechos de descarga solo para pedidos pagados.
- Referencia a la versión exacta del archivo comprado.
- Descargas autorizadas con tokens firmados y temporales.
- Verificación de tenant, pedido pagado, derecho vigente, fotografía y asset.
- Registro de descargas y detección básica de abuso.
- Conexión real de `assertStorePurchasesEnabled` al checkout.
- Conservación de derechos de pedidos pagados aunque la tienda deje de aceptar compras.
- Pruebas de deduplicación, snapshots, impago sin descarga y aislamiento.

**Frontend faltante:**

- Carrito.
- Checkout.
- Confirmación de pedido.
- Acceso a pedido para invitado.
- Descarga de archivos comprados.
- Panel de pedidos y pagos.
- Registro de ventas manuales.

**Decisiones pendientes críticas:**

- Cómo se confirma un pago online sin pasarela: acción administrativa, transferencia manual, efectivo u otro flujo.
- Quién puede confirmar pagos y con qué evidencia.
- Si el MVP incluye ZIP para descargas múltiples.
- Política de expiración de carritos y pedidos pendientes.
- Política de reembolsos y revocación de derechos.
- Cómo se vincula un cliente invitado a una cuenta sin asumir identidad por email.

**Criterio de salida:**

- Comprar álbum y foto contenida no genera doble cobro.
- Un pedido conserva el precio acordado aunque cambie el catálogo.
- No se concede descarga por un pedido impago.
- No se puede cambiar un ID o tenant para descargar archivos ajenos.
- Un cliente puede descargar todos los álbumes adquiridos sin límite comercial artificial.
- Suspender nuevas ventas no elimina derechos de pedidos pagados.

---

### 4.4 Fase 7 — Panel, clientes y estadísticas

**Estado:** no iniciada.

**Backend faltante:**

- Resumen de actividad.
- Listado de clientes e historial.
- Listado de pedidos y estados.
- Métricas de visitas y ventas.
- Separación entre ingresos confirmados y pedidos impagos.
- Distinción entre ventas web y manuales.
- Endpoints de estadísticas filtrados por tienda.

**Frontend faltante:**

- Dashboard.
- Navegación por módulos.
- Gestión de equipo.
- Estado de suscripción.
- Configuración de tienda.
- Pedidos, clientes y métricas.

**Nota:** la API de equipo y suscripción ya existe; lo que falta es la interfaz y la capa de resumen/estadísticas.

**Criterio de salida:**

- Las métricas derivan de datos consistentes.
- Los pedidos impagos no se cuentan como ingresos.
- Los listados están filtrados por tienda.
- El equipo está protegido por rol y entitlement.

---

### 4.5 Fase 8 — Endurecimiento y beta

**Estado:** no iniciada.

**Faltante:**

- Revisión de seguridad y pruebas de autorización adversariales.
- Pruebas de carga básicas.
- Límites de subida y protección de archivos.
- Backups externos y prueba de restauración.
- Monitorización de disco, CPU, memoria y errores.
- Métricas y alertas.
- Revisión de privacidad, términos y obligaciones legales.
- Pruebas end-to-end de registro, publicación, compra y descarga.
- Manual de operación y recuperación.
- Estrategia de despliegue en VPS.
- Wildcard DNS y certificado TLS para subdominios.
- Proxy reverso y configuración de `Host`/forwarded headers.
- Configuración de email de producción.
- OpenAPI o documentación de API equivalente.
- Procedimiento de migración y rollback.

**Criterio de salida:**

- Los flujos críticos funcionan en un entorno similar a producción.
- Existe un procedimiento probado de backup y restore.
- No hay vulnerabilidades críticas conocidas sin mitigación.
- Está documentado cómo desplegar, observar y recuperar el servicio.

---

## 5. Backlog priorizado para llegar al MVP

### Prioridad 0 — Cerrar decisiones antes de construir

1. Aprobar formalmente el alcance MVP y la exclusión de servicios profesionales (ya marcada como post-MVP en `docs/03`).
2. Definir el flujo de pago manual para pedidos online.
3. Definir si los dominios personalizados son MVP o post-MVP.
4. Elegir librería/worker de imágenes y estrategia de almacenamiento.
5. Definir si ZIP de descargas es MVP.
6. Aprobar los límites comerciales provisionales de planes.
7. Definir el alcance exacto del dashboard mínimo.

### Prioridad 1 — Storefront mínimo

- Scaffold del frontend.
- Backend de configuración y publicación.
- Plantilla Nocturne Cyanotype.
- Storefront público por subdominio.
- Panel de configuración y publicación.

### Prioridad 2 — Catálogo y media

- Álbumes y fotografías.
- Subida y procesamiento.
- Originales privados y derivados públicos.
- Galería pública.
- Watermark.

### Prioridad 3 — Compra y descarga

- Carrito.
- Pedido con snapshots.
- Pago manual auditado.
- Derechos por versión exacta.
- Descargas autorizadas.
- Ventas manuales separadas.

### Prioridad 4 — Dashboard mínimo

- Pedidos, clientes, equipo, suscripción y resumen.
- Métricas básicas.

### Prioridad 5 — Beta

- Seguridad, backups, monitorización, despliegue, legal y E2E.

---

## 6. Decisiones y riesgos abiertos

| Tema | Situación actual | Impacto |
|---|---|---|
| Frontend | No hay aplicación implementada | Bloquea la experiencia MVP |
| Pago sin pasarela | Solo existe la guarda de compras; no hay flujo de confirmación | Bloquea el cierre de pedidos |
| Dominios personalizados | Entitlement existe, implementación no | Puede ser post-MVP o requerir fase adicional |
| Media | Sin tablas, storage ni procesamiento | Bloquea catálogo y ventas |
| ZIP de descargas | No definido | Puede simplificar o complicar Fase 5 |
| Límites de planes | Valores provisionales | Requiere aprobación comercial |
| Plan inicial | `planCode` elegible al crear el trial | Requiere validación para evitar abuso |
| Servicios profesionales | Documento de plan los incluye, alcance confirmado los excluye | Riesgo de ejecutar trabajo fuera de alcance |
| Producción | Sin DNS, TLS, backups ni monitorización | Bloquea beta real |
| Legal | Sin términos, privacidad ni retención definidos | Bloquea lanzamiento comercial |

---

## 7. Criterios de aceptación del MVP

El MVP se considera completo cuando se cumplen todos estos puntos:

- [ ] Un usuario puede registrarse, verificar email, iniciar sesión y recuperar contraseña.
- [ ] Un usuario puede crear una cuenta y una tienda sin estados parciales.
- [ ] Los slugs duplicados y reservados se rechazan.
- [ ] Una cuenta sin membresía no accede a datos privados de una tienda.
- [ ] Los permisos y entitlements se validan en backend.
- [ ] Base e Intermedio no pueden crear una segunda tienda.
- [ ] Business puede crear tiendas hasta el límite configurado.
- [ ] El equipo solo opera en planes habilitados.
- [ ] Una tienda puede configurar y publicar un storefront.
- [ ] Editar un borrador no altera la versión pública.
- [ ] El hostname correcto resuelve la tienda correcta.
- [ ] Una fotografía pertenece como máximo a un álbum.
- [ ] Un tenant no puede consultar ni modificar media ajena.
- [ ] Los originales no son accesibles públicamente.
- [ ] Las versiones públicas tienen marca de agua cuando corresponde.
- [ ] Un cliente puede agregar fotografías y álbumes al carrito.
- [ ] Comprar álbum y foto contenida no genera doble cobro.
- [ ] El pedido conserva snapshots de precio, título y composición.
- [ ] Los estados de pedido y pago están separados.
- [ ] No se concede descarga por un pedido impago.
- [ ] Un pedido pagado conserva derechos aunque la tienda suspenda nuevas ventas.
- [ ] Una tienda sin ventas habilitadas rechaza nuevas compras con código estable.
- [ ] Las ventas externas se registran como trabajo manual, no como pedido online.
- [ ] El cliente puede descargar los originales comprados con autorización temporal.
- [ ] Existe un dashboard mínimo de pedidos, clientes, equipo y suscripción.
- [ ] Hay backups, restore probado, monitorización y despliegue documentado.
- [ ] Los flujos críticos tienen pruebas end-to-end.

---

## 8. Próximo paso recomendado

Antes de escribir código de Fase 3:

1. Aprobar este documento y corregir el alcance de Fase 6.
2. Cerrar las decisiones de pago manual, dominios personalizados, media y ZIP.
3. Definir el alcance exacto del frontend y del dashboard mínimo.
4. Crear el plan de Fase 3 con:
   - tablas y migración;
   - endpoints;
   - contratos de datos;
   - scaffold del frontend;
   - pruebas;
   - criterios de aceptación.

**Recomendación:** iniciar Fase 3 por el backend de configuración/publicación y el scaffold del frontend en paralelo, manteniendo la tienda pública como un contrato de datos separado del panel administrativo.


---

## 9. Handoff a Claude: regla de verificación del estado

Este documento es una fotografía del estado informado al 17 de noviembre de 2026, no una garantía de que el repositorio siga exactamente igual al momento de abrirlo en otro entorno.

Claude debe, antes de modificar código:

1. Inspeccionar el repositorio completo y el historial reciente de Git.
2. Comparar el código, migraciones, tests y configuración con las afirmaciones de este documento.
3. Ejecutar las verificaciones seguras disponibles y registrar comandos/resultados reales.
4. Identificar divergencias entre documentación y código; no resolverlas silenciosamente.
5. Proponer correcciones documentales o técnicas con evidencia y pedir aprobación cuando cambien decisiones confirmadas o impliquen riesgo.
6. No asumir que Fase 3 comenzó por el mero hecho de recibir este handoff.

El estado inicial documentado es: Fases 0, 1 y 2 completadas; Fase 3 no iniciada. El frontend, storefront, catálogo/media, checkout/pagos/descargas, dashboard y endurecimiento de producción figuran como pendientes en la fecha de referencia.

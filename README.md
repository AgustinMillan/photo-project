# Photo Platform

SaaS multi-tenant para fotógrafos que venden fotografías individuales, álbumes y descargas digitales.

El proyecto está en **Fase 2 (Suscripciones y entitlements)**, construido por incrementos. El incremento 1A deja lista la base técnica, el 1B agrega identidad y autenticación (registro, verificación de email, login, refresh rotativo, logout, recuperación de contraseña y rate limiting específico) y el 1C incorpora cuentas, tiendas, membresías, invitaciones y aislamiento multi-tenant. La Fase 2 agrega planes y entitlements configurables, suscripción con trial, límites de tiendas, guardas de equipo y compras, y estado de suscripción.

## Stack

- Node.js 22 + TypeScript
- Fastify 5 + Zod
- PostgreSQL 17
- Drizzle ORM + migraciones SQL versionadas
- pnpm workspaces
- Biome para lint y formato
- Vitest para pruebas
- Docker Compose para PostgreSQL y Mailpit

## Estructura

```text
.
├── backend/                 API Fastify + Drizzle
│   ├── drizzle/             Migraciones SQL generadas y metadatos
│   ├── src/
│   │   ├── config/          Validación de variables de entorno
│   │   ├── db/              Cliente, esquema y runner de migraciones
│   │   ├── modules/         Rutas por dominio
│   │   └── shared/          Errores, logging y utilidades HTTP
│   └── test/                Pruebas unitarias e integración
├── docs/                    Producto, arquitectura, plan, ERD y ADRs
├── frontend/                Panel del fotógrafo (React 19 + Vite + Tailwind v4)
└── infra/                   Docker Compose y scripts de PostgreSQL
```

## Requisitos

- Node.js 22.14 o superior
- pnpm 10
- Docker Desktop o Docker Engine con Compose

## Puesta en marcha

```powershell
pnpm install
pnpm infra:up
Copy-Item backend/.env.example backend/.env
# Editar backend/.env y generar un JWT_ACCESS_SECRET real:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# o, si está disponible: openssl rand -base64 48
pnpm db:migrate
pnpm dev
```

La API queda en `http://localhost:3000`.

Los subdominios de tienda de desarrollo se construyen como `slug.PLATFORM_DOMAIN`. Con el valor por defecto `PLATFORM_DOMAIN=localhost`, una tienda con slug `mi-estudio` queda disponible en `http://mi-estudio.localhost:3000` (el puerto depende del proxy/frontend). Las invitaciones usan `STORE_INVITATION_TTL_DAYS` (7 días por defecto). El trial usa `TRIAL_PLAN_CODE` (`base` por defecto) y `TRIAL_DURATION_DAYS` (`30` por defecto).

Health checks:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready` (comprueba PostgreSQL)

Mailpit queda en `http://localhost:8025` y captura los emails de desarrollo en el puerto SMTP `1025`.

> `backend/.env` está ignorado por Git. No commitear secretos.

## Scripts

| Comando | Descripción |
|---|---|
| `pnpm dev` | API en modo watch |
| `pnpm build` | Compila la API a `backend/dist` |
| `pnpm typecheck` | Verifica TypeScript sin emitir |
| `pnpm lint` | Ejecuta Biome |
| `pnpm format` | Formatea con Biome |
| `pnpm test` | Pruebas unitarias |
| `pnpm test:integration` | Pruebas contra PostgreSQL real |
| `pnpm db:generate` | Genera una migración desde el esquema Drizzle |
| `pnpm db:migrate` | Aplica migraciones pendientes y siembra los planes iniciales |
| `pnpm db:seed` | Vuelve a sembrar planes/entitlements faltantes y backfill de trials |
| `pnpm db:studio` | Abre Drizzle Studio |
| `pnpm infra:up` | Levanta PostgreSQL y Mailpit |
| `pnpm infra:down` | Detiene los servicios |
| `pnpm infra:logs` | Sigue los logs de infraestructura |

### Pruebas de integración

Las pruebas de integración usan la base `photo_platform_test` creada por el script de inicialización de PostgreSQL. La primera vez:

```powershell
$env:DATABASE_URL='postgres://photo_platform:photo_platform_dev@localhost:5432/photo_platform_test'
pnpm db:migrate
pnpm test:integration
Remove-Item Env:DATABASE_URL
```

El CI ejecuta migraciones y ambas suites antes del build.

## Base de datos

Las migraciones incluyen las tablas de Fase 1 y Fase 2:

- `users`
- `user_sessions`
- `email_verification_tokens`
- `password_reset_tokens`
- `accounts`
- `stores`
- `store_memberships`
- `store_invitations`
- `store_domains`
- `plans`
- `plan_entitlements`
- `subscriptions`
- `subscription_events`
- `audit_logs`

La migración `0001_fuzzy_bushwacker.sql` agrega la restricción de formato de slug (`stores_slug_format_check`) además de la unicidad case-insensitive existente. La migración `0002_unusual_gauntlet.sql` agrega planes, entitlements, suscripciones e historial. `pnpm db:migrate` siembra los planes `base`, `intermediate` y `business` de forma idempotente y crea un trial de base para cuentas históricas con tiendas que nunca tuvieron suscripción. Las tablas de catálogo, media, pedidos, pagos y descargas se agregan en sus fases correspondientes.

Para reiniciar la base local desde cero:

```powershell
docker compose -f infra/docker-compose.yml down -v
pnpm infra:up
pnpm db:migrate
```

Esto borra el volumen local. No usarlo contra datos que se quieran conservar.

## Autenticación

Se adoptó **JWT access + refresh rotativo**. El access token es de corta duración (15 minutos por defecto) y se envía en `Authorization: Bearer`; el refresh token es opaco, se guarda hasheado en `user_sessions` y viaja en una cookie `HttpOnly` con `SameSite=Lax`, limitada a `/api/v1/auth`. La rotación y la detección de reutilización están documentadas en el ADR.

Los usuarios deben verificar su email antes de poder iniciar sesión. Los emails de desarrollo se capturan en Mailpit (`http://localhost:8025`). Los enlaces usan `APP_URL` y apuntan a `/verify-email?token=...` y `/reset-password?token=...`; el frontend (`frontend/`) llama a los endpoints correspondientes con ese token.

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Crea un usuario pendiente de verificación y envía el email. |
| `POST` | `/api/v1/auth/verify-email` | Verifica el email con `{ token }`. |
| `POST` | `/api/v1/auth/resend-verification` | Reenvía la verificación sin revelar si el email existe. |
| `POST` | `/api/v1/auth/login` | Valida credenciales y devuelve un access token; setea la cookie de refresh. |
| `POST` | `/api/v1/auth/refresh` | Rota el refresh token y devuelve un nuevo access token. |
| `POST` | `/api/v1/auth/logout` | Revoca la sesión actual; acepta `{ "allDevices": true }`. |
| `POST` | `/api/v1/auth/forgot-password` | Envía un enlace de recuperación sin revelar si el email existe. |
| `POST` | `/api/v1/auth/reset-password` | Cambia la contraseña, invalida el token y revoca todas las sesiones. |
| `GET` | `/api/v1/auth/me` | Devuelve el usuario autenticado. Requiere `Authorization: Bearer`. |

La respuesta de login/refresh incluye `accessToken`, `tokenType`, `expiresIn` y `user`. El refresh token no se expone en el body.

- [ADR-0001: Autenticación con JWT access + refresh](docs/adr/0001-autenticacion-jwt-access-refresh.md)
- [ADR-0002: Autorización y aislamiento por tienda](docs/adr/0002-autorizacion-aislamiento-tenant.md)

## Cuentas, tiendas y membresías

Cada usuario puede crear una cuenta comercial (una por usuario en v1). La cuenta es la titular de las tiendas y la suscripción; no es una tienda ni una identidad de login. El propietario de la cuenta tiene acceso implícito `OWNER` a todas sus tiendas.

La creación de una tienda es transaccional: inserta la tienda, la membresía `OWNER` del propietario y el subdominio de plataforma verificado (`slug.PLATFORM_DOMAIN`). Si falla cualquier paso, no queda estado parcial. Los slugs se normalizan a minúsculas, validan formato de 3 a 63 caracteres, se rechazan si están reservados y son únicos sin distinguir mayúsculas.

La autorización administrativa se resuelve siempre contra el `storeId` de la ruta y el usuario autenticado. Los usuarios sin membresía activa reciben `404` para no revelar la existencia de tiendas ajenas. Los roles iniciales son `OWNER`, `ADMIN`, `PHOTOGRAPHER` y `EDITOR`. Solo `OWNER` puede cambiar el slug y gestionar administradores; `OWNER` y `ADMIN` pueden gestionar el equipo. Las invitaciones no permiten el rol `OWNER`; la transferencia de propiedad será un flujo separado y auditado.

Las invitaciones se envían por email con un token opaco de un solo uso, guardado hasheado en la base. El email autenticado del usuario debe coincidir con el email invitado. El enlace usa `APP_URL` y apunta a `/accept-invitation?token=...`; el frontend debe llamar a `POST /api/v1/invitations/accept`.

### Endpoints de cuentas y tiendas

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/accounts` | Crea la cuenta comercial del usuario autenticado. |
| `GET` | `/api/v1/accounts/me` | Devuelve la cuenta del usuario autenticado. |
| `PATCH` | `/api/v1/accounts/me` | Actualiza nombre, email de facturación o tipo de cuenta. |
| `POST` | `/api/v1/stores` | Crea una tienda bajo la cuenta actual de forma transaccional. Acepta `planCode` solo al crear el trial. |
| `GET` | `/api/v1/stores` | Lista las tiendas propias o con membresía activa. |
| `GET` | `/api/v1/stores/:storeId` | Devuelve una tienda autorizada. |
| `PATCH` | `/api/v1/stores/:storeId` | Actualiza nombre o slug; el slug solo lo cambia el `OWNER`. |
| `GET` | `/api/v1/stores/:storeId/members` | Lista el equipo. Requiere `OWNER` o `ADMIN`. |
| `PATCH` | `/api/v1/stores/:storeId/members/:userId` | Cambia el rol de un miembro. |
| `DELETE` | `/api/v1/stores/:storeId/members/:userId` | Remueve a un miembro sin borrar su historial. |
| `GET` | `/api/v1/stores/:storeId/invitations` | Lista invitaciones de la tienda. |
| `POST` | `/api/v1/stores/:storeId/invitations` | Invita a un email con rol `ADMIN`, `PHOTOGRAPHER` o `EDITOR`. |
| `DELETE` | `/api/v1/stores/:storeId/invitations/:invitationId` | Revoca una invitación pendiente. |
| `POST` | `/api/v1/invitations/accept` | Acepta una invitación con `{ token }`. |
| `GET` | `/api/v1/accounts/me/subscription` | Devuelve el plan, estado, fechas y entitlements del plan; `null` si el trial aún no empezó. |
| `GET` | `/api/v1/accounts/me/entitlements` | Devuelve solo los entitlements efectivos (vacíos si la suscripción no es usable). |
| `GET` | `/api/v1/stores/:storeId/features` | Devuelve los entitlements efectivos para los miembros de una tienda. |
| `GET` | `/api/v1/stores/:storeId/sales-status` | Indica si la tienda acepta compras nuevas y el motivo si no. |
| `GET` | `/api/v1/public/stores/resolve` | Resuelve una tienda activa por el hostname del request e incluye `purchasesEnabled`. |

Todas las rutas administrativas requieren `Authorization: Bearer`. La resolución pública usa el header `Host` y devuelve únicamente datos públicos mínimos de la tienda. Las respuestas de creación de tienda incluyen `primaryHostname`, `role`, `status` y `publicationStatus`.

## Planes, suscripciones y límites

Los planes y sus entitlements son filas configurables en la base. El código funcional consulta capacidades (`stores.max`, `team.enabled`, `team.max_members`, `purchases.enabled`), no nombres de plan. Los seeds iniciales son `base`, `intermediate` y `business`; sus límites son provisionales y se pueden cambiar en `plan_entitlements` sin desplegar código.

- El trial empieza al crear la primera tienda y se crea en la misma transacción. Si la cuenta ya tiene una suscripción abierta, no se crea otra.
- `TRIAL_PLAN_CODE` y `TRIAL_DURATION_DAYS` definen el plan y la duración. `POST /api/v1/stores` acepta `planCode` solo mientras se crea el trial; después el cambio de plan requiere el flujo de facturación futuro.
- Solo `trial` y `active` habilitan funcionalidades. `expired`, `cancelled` y `suspended` bloquean nuevas capacidades, pero no borran tiendas, archivos, pedidos ni derechos adquiridos.
- La expiración es perezosa: al leer la suscripción se marca `expired` y se registra el evento. No se depende de un cron para que las guardas sean correctas.
- Base e Intermedio permiten una tienda. Business usa el límite configurado (10 por defecto). La creación bloquea la fila de la cuenta y cuenta las tiendas dentro de la transacción.
- El equipo requiere `team.enabled`; sin esa capacidad las operaciones responden `TEAM_FEATURE_DISABLED`. `team.max_members` se aplica al invitar y aceptar.
- La guarda de compras `assertStorePurchasesEnabled` exige tienda activa, cuenta activa, suscripción usable y `purchases.enabled`. La Fase 5 la conectará al checkout; por ahora `GET /stores/:storeId/sales-status` expone el resultado y la resolución pública incluye `purchasesEnabled`.
- Los códigos estables de Fase 2 son `STORE_LIMIT_REACHED`, `SUBSCRIPTION_INACTIVE`, `TEAM_FEATURE_DISABLED`, `TEAM_MEMBER_LIMIT_REACHED`, `STORE_PURCHASES_DISABLED`, `PLAN_NOT_FOUND` y `PLAN_CHANGE_NOT_ALLOWED`.
- Los pedidos y pagos aún no existen en el modelo. Cuando se implementen, la expiración de suscripción solo bloqueará compras nuevas; los pedidos pagados y las descargas ya otorgadas conservarán sus derechos.

La configuración inicial está documentada en [ADR-0003](docs/adr/0003-planes-suscripciones-entitlements.md).

## Documentación

- [01 — Documento maestro de producto](docs/01-documento-maestro-producto.md)
- [02 — Arquitectura técnica](docs/02-arquitectura-tecnica.md)
- [03 — Plan de implementación](docs/03-plan-implementacion.md)
- [04 — Modelo de datos / ERD](docs/04-modelo-datos-erd.md)
- [05 — Estado de desarrollo y brecha para el MVP](docs/05-estado-desarrollo-mvp.md)
- [ADR-0003 — Planes, suscripciones y entitlements](docs/adr/0003-planes-suscripciones-entitlements.md)
- [Índice de documentación](docs/README.md)

## Estado

Completado en 1A:

- Scaffold del monorepo y configuración de entornos.
- PostgreSQL 17 y Mailpit con Docker Compose.
- Esquema Drizzle de Fase 1 y primera migración.
- Fastify con logging estructurado, manejo de errores, CORS, Helmet, rate limit y cookies.
- Health checks de liveness y readiness.
- Pruebas unitarias e integración.
- CI para instalar, lint, typecheck, migrar, testear y compilar.

Completado en 1B:

- Registro con Argon2id y email único case-insensitive.
- Verificación de email con tokens opacos de un solo uso.
- Login con JWT de acceso y refresh token rotativo en cookie `HttpOnly`.
- Detección de reutilización de refresh tokens y revocación de la familia de sesiones.
- Logout de la sesión actual y de todos los dispositivos.
- Recuperación de contraseña con tokens de un solo uso y revocación de sesiones.
- Rate limiting específico por endpoint, validación con Zod y auditoría inicial de eventos de autenticación.
- Pruebas unitarias e integración de los flujos de autenticación.

Completado en 1C:

- Cuenta comercial por usuario, con perfil editable y email de facturación.
- Creación transaccional de tienda, membresía `OWNER` y subdominio de plataforma verificado.
- Validación de formato, reservados y unicidad case-insensitive de slugs.
- Resolución de tienda por hostname para desarrollo.
- Autorización por membresía y rol en backend, con aislamiento entre tiendas.
- Invitaciones con token opaco, email, expiración, aceptación por email coincidente y revocación.
- Protección de la membresía del propietario y reglas de administración de administradores.
- Auditoría de cuentas, tiendas, miembros e invitaciones.
- Pruebas unitarias e integración, incluyendo aislamiento entre dos tiendas.

Completado en Fase 2:

- Planes y entitlements configurables en base, sin condiciones por nombre de plan.
- Suscripción por cuenta con estados, trial y expiración perezosa.
- Inicio del trial al crear la primera tienda y backfill para cuentas históricas.
- Límite de tiendas aplicado en backend con bloqueo por cuenta y error estable.
- Guardas de equipo por entitlement y capacidad de miembros.
- Guarda reutilizable de compras y estado de ventas por tienda.
- Endpoints de estado de suscripción, entitlements, features y ventas.
- Pruebas unitarias e integración de límites, trial, expiración y compras.

Fase 2 completa. Siguiente: **Fase 3 — Storefront y configuración**.

## Frontend (panel del fotógrafo)

React 19 + Vite + TypeScript + Tailwind v4, con los tokens "Nocturne Cyanotype" de `docs/DESIGN.md`. Consume la API existente; no agrega endpoints.

```bash
pnpm install
pnpm infra:up && pnpm db:migrate     # PostgreSQL + Mailpit
pnpm dev                             # API en http://localhost:3000
pnpm dev:web                         # UI en http://localhost:5173
```

- Vite hace proxy de `/api` hacia la API (`VITE_API_TARGET`), sin cambiar el `Host`; `CORS_ORIGIN` debe incluir el origen de la UI (por defecto `http://localhost:5173`).
- El access token vive solo en memoria; la sesión se recupera con el refresh token (cookie HttpOnly) al cargar.
- Pantallas: registro, verificación de email, login, recuperación y restablecimiento de contraseña, onboarding (cuenta + primera tienda), aceptar invitación, resumen, equipo e invitaciones, plan/entitlements y ajustes de cuenta y tienda.
- Un hostname `<slug>.<VITE_PLATFORM_DOMAIN>` muestra la vitrina pública (placeholder) en lugar del panel. Ejemplo: `http://mi-estudio.localhost:5173`.
- Scripts: `pnpm web:lint`, `pnpm web:typecheck`, `pnpm web:test`, `pnpm web:build`.

# ADR-0001: Autenticación con JWT access + refresh rotativo

- **Estado:** aceptado
- **Fecha:** 2026-11-16
- **Decisores:** equipo de producto y desarrollo
- **Reemplaza:** el supuesto de sesiones server-side con cookie de sesión y CSRF del documento `02-arquitectura-tecnica.md` §7

## Contexto

El MVP es una aplicación web multi-tenant. Necesitamos autenticar usuarios, revocar accesos, cerrar sesión en todos los dispositivos y detectar el uso repetido de un token robado. También queremos evitar consultar la base de datos en cada request autenticado.

La alternativa de sesiones server-side es válida, pero se descartó para este MVP porque el equipo prevé clientes adicionales sobre la misma API y prefiere separar el token de acceso de la sesión de refresh.

## Decisión

1. **Access token:** JWT firmado con HS256 usando `JWT_ACCESS_SECRET` (mínimo 32 caracteres), vida de 15 minutos por defecto, configurable con `ACCESS_TOKEN_TTL_SECONDS`.
2. **Refresh token:** token opaco aleatorio de 32 bytes, codificado en base64url. Se envía en una cookie `HttpOnly`, `Secure` en producción y `SameSite=Lax`, con `Path=/api/v1/auth`.
3. **Persistencia:** se guarda únicamente el SHA-256 del refresh token en `user_sessions.refresh_token_hash`. Nunca se guarda el token en claro ni el access token.
4. **Rotación:** cada refresh válido revoca la sesión anterior y emite un refresh nuevo dentro de la misma `family_id`.
5. **Detección de reutilización:** si se presenta un refresh ya revocado, se revoca toda la familia y se fuerza un nuevo login.
6. **Logout:** revoca la sesión actual y limpia la cookie. El access token deja de ser útil al expirar; las operaciones sensibles pueden validar `sid` contra la sesión si se necesita revocación inmediata.
7. **Almacenamiento en el cliente:** el access token vive en memoria; el refresh token solo en la cookie `HttpOnly`. No se usa `localStorage` para credenciales.
8. **Verificación de email y recuperación de contraseña:** tokens de un solo uso, aleatorios, almacenados hasheados y con expiración corta.
9. **Contraseñas:** Argon2id mediante una librería mantenida. Nunca se registran contraseñas ni tokens en logs.

## Consecuencias

- La autorización por tienda se resuelve en cada request a partir del `sub` del access token y de `store_memberships`; el token no contiene permisos que puedan quedar obsoletos.
- El access token puede seguir siendo válido hasta 15 minutos después de un logout. Para el MVP se acepta; si se requiere revocación inmediata, se valida la sesión en operaciones sensibles.
- La cookie de refresh requiere configuración correcta de CORS, `SameSite` y HTTPS en producción.
- El endpoint de refresh debe validar `Origin` y limitar intentos para reducir CSRF y fuerza bruta.
- `user_sessions` deja de ser una tabla de sesiones web con CSRF y pasa a ser la cadena de refresh tokens.
- Se necesita una tarea periódica de limpieza de sesiones expiradas y tokens usados.

## Alternativas consideradas

- **Sesión server-side con cookie y CSRF:** más simple de revocar, pero requiere estado y CSRF en cada flujo; se descartó por la intención de exponer una API a otros clientes.
- **JWT de larga duración sin refresh:** no permite revocación práctica ni rotación; descartado.
- **Refresh token en `localStorage`:** expuesto a XSS; descartado.

# Documento maestro del producto

**Versión:** 1.2 — 17 de noviembre de 2026  
**Estado:** Borrador consolidado con decisiones comerciales y de alcance actualizadas; pendiente de aprobación formal del modelo completo.

## 1. Visión

Construir una plataforma SaaS multi-tenant para fotógrafos y estudios que les permita crear una tienda pública propia, vender fotografías individuales y álbumes digitales, y administrar desde un panel tanto las operaciones de la plataforma como las ventas externas y los trabajos ya realizados.

La evolución futura podrá contemplar un directorio o marketplace para descubrir fotógrafos y contratar servicios. Ese producto futuro no debe confundirse con el registro interno de actividad del MVP.

## 2. Principios del producto

- SaaS multi-tenant desde el inicio.
- Monolito modular inicialmente; no introducir microservicios prematuramente.
- Separar identidad de acceso (`User`), cuenta comercial (`Account`), tiendas (`Store`), membresías, suscripciones y clientes compradores.
- La suscripción pertenece a la cuenta propietaria y cubre las tiendas de esa cuenta según los entitlements del plan.
- Los colaboradores invitados reciben acceso por tienda y no pagan una suscripción individual por colaborar.
- Separar la venta digital de fotografías/álbumes de los registros de actividad externa.
- La seguridad y el aislamiento entre tiendas se aplican en backend, no solo en la interfaz.
- Mantener snapshots históricos e inmutabilidad donde existan compras, pagos o derechos.
- No implementar anticipadamente funcionalidades fuera del MVP.

## 3. Actores y conceptos

- **User:** identidad de autenticación de una persona. Tiene credenciales, sesiones y verificación de email.
- **Account:** cuenta comercial propietaria de una o más tiendas y sujeto de facturación de la plataforma. Tiene un único propietario (`owner_user_id`) en v1.
- **Store:** espacio comercial independiente y tenant operativo. Pertenece a una `Account`.
- **Colaborador:** `User` invitado a una tienda mediante una membresía. No necesita ser propietario de una `Account` ni contratar su propio plan para colaborar.
- **Cliente comprador:** persona que compra como invitado o mediante una identidad verificada. No obtiene permisos de equipo por ser cliente.
- **Administrador de plataforma:** operador interno, separado de los roles de tienda y fuera del alcance funcional inicial.

Una misma persona puede tener roles diferentes en tiendas diferentes. La posibilidad de que un mismo `User` sea propietario de varias `Account` debe resolverse antes de fijar la restricción global de `Account.owner_user_id` en la base de datos.

## 4. Modelo comercial y suscripciones

### 4.1 Planes

- **Base:** una tienda por cuenta; subdominio de la plataforma; permite activar/desactivar secciones, pero no reordenarlas.
- **Intermedio:** una tienda por cuenta; admite dominio propio y permite activar/desactivar/reordenar secciones.
- **Business:** habilita múltiples tiendas bajo la misma cuenta propietaria y funciones de equipo. Hereda las capacidades de personalización de Intermedio.

Los precios, el máximo exacto de tiendas y miembros y otras cuotas cuantitativas siguen pendientes. Deben representarse mediante `plan_entitlements`; no se hardcodean en la aplicación.

### 4.2 Sujeto de facturación y colaboradores

- La suscripción se contrata y factura a nivel de `Account`, no por `Store` ni por colaborador.
- Una suscripción Business cubre las tiendas que pertenecen a la cuenta propietaria, dentro del límite configurado por sus entitlements.
- El propietario de la cuenta es responsable de la suscripción y de la facturación.
- Los colaboradores invitados no pagan una suscripción propia por acceder a una tienda. Su acceso depende de una invitación aceptada, una membresía activa, el rol asignado y los entitlements habilitados para la cuenta.
- No se incorpora `SubscriptionStore` en v1: la cobertura se deriva de `Store.account_id = Subscription.account_id`.
- Base e Intermedio permiten una tienda por cuenta. Business habilita multi-tienda; su máximo concreto queda pendiente.

### 4.3 Trial y estados

El alta directa permite crear la cuenta y la primera tienda sin aprobación manual. El trial comienza al crear la primera tienda. Su duración y el plan exacto de trial se configurarán cuando se cierre la oferta comercial.

Estados previstos de suscripción: `trial`, `active`, `expired`, `cancelled` y `suspended`.

Cuando la cuenta no tiene una suscripción habilitada, o una tienda tiene `sales_paused = true`, se bloquean nuevas compras con un error estable como `STORE_PURCHASES_DISABLED`. Si la tienda está publicada y operativa, puede seguir mostrando su catálogo. La expiración de la suscripción no elimina ni revoca por sí sola derechos de descarga ya adquiridos.

## 5. Tiendas, dominios y publicación

- Cada tienda tendrá un subdominio automático: `slug.plataforma.com`.
- Los dominios personalizados estarán disponibles según entitlement; su activación puede quedar fuera de la primera entrega.
- El slug debe ser único y no podrá usar nombres reservados.
- La resolución del hostname identifica centralmente la tienda.
- Cada tienda mantiene identidad, catálogo, configuración, contenido y operaciones comerciales independientes.
- La cuenta propietaria puede administrar varias tiendas cuando su plan lo habilite.
- El contenido editable se guarda como borrador. La publicación crea un snapshot/versionado explícito; editar un borrador no altera el storefront publicado.

## 6. Plantilla y personalización

Se comienza con una plantilla altamente editable basada en **Nocturne Cyanotype**. Se incorporarán otras plantillas más adelante.

Separar:

1. **Design System:** tokens, tipografías, componentes y reglas visuales.
2. **Identidad del fotógrafo:** nombre, logo, biografía, imágenes, contacto y redes.
3. **Configuración de tienda:** secciones admitidas, orden, portada, álbumes destacados y contenido.

El MVP incluye un panel de configuración, no un editor visual drag-and-drop. Los cambios se guardan como borrador y se publican explícitamente. No se permite CSS arbitrario; la personalización se limita a opciones y tokens validados.

## 7. Catálogo fotográfico y reglas de álbumes

- Una fotografía puede existir sin álbum o pertenecer a un único álbum.
- Un álbum contiene cero o muchas fotografías; una foto no puede pertenecer simultáneamente a más de un álbum.
- Una fotografía tiene precio individual. Un álbum puede tener precio por el conjunto de fotografías que contiene.
- Álbumes y fotografías pueden estar en borrador, publicados, ocultos o archivados.
- La base de datos debe impedir que una foto se asocie a un álbum de otra tienda.
- La composición de un álbum se congela en el pedido al comprarlo. Las fotos agregadas después no se incorporan retroactivamente a esa compra.

### 7.1 Acciones de borrado de álbum

El panel debe distinguir dos acciones, con confirmación clara:

1. **Eliminar el álbum y liberar las fotos:** el álbum deja de estar disponible y las fotos que lo integraban quedan independientes (`album_id = NULL`), conservando sus registros y estados de catálogo según la acción solicitada.
2. **Archivar el álbum y sus fotos:** el álbum y las fotos asociadas pasan a archivados y dejan de ofrecerse en el catálogo.

Ninguna de estas acciones borra físicamente versiones o archivos referenciados por pedidos o derechos de descarga. El borrado físico queda sujeto a retención, referencias y política legal.

## 8. Versionado de fotografías y archivos

`Photo` representa la identidad lógica/comercial de una fotografía. Cada reemplazo genera una nueva `PhotoAssetVersion`, asociada a un `MediaAsset` original inmutable. Las variantes (`MediaVariant`) son derivados regenerables.

- Una foto puede tener muchas versiones, pero como máximo una versión actual.
- Cada versión pertenece a una única foto y referencia exactamente un asset original.
- Un asset no se reutiliza para varias versiones.
- El reemplazo nunca sobrescribe el archivo anterior ni su `storage_key`.
- Una nueva versión solo pasa a ser actual cuando su procesamiento terminó correctamente.
- Los pedidos y `OrderEntitlement` guardan la versión exacta adquirida; no apuntan a “la versión actual”.
- Reemplazar o archivar una foto no modifica derechos históricos. Una compra antigua descarga la versión que compró.
- Las variantes públicas pueden regenerarse sin modificar el original.

## 9. Compra digital, pagos y descargas

- El cliente puede comprar fotografías individuales o álbumes completos.
- Si una foto ya está cubierta por un álbum en el carrito, no se cobra dos veces. El checkout recalcula y deduplica en backend.
- El checkout vuelve a validar publicación, pertenencia a la tienda, precios vigentes y habilitación comercial.
- Los pedidos guardan snapshots de precio, título, composición del álbum y versión exacta de cada foto.
- `Order` y `Payment` son entidades separadas. El estado de pago no se duplica como campo independiente en `Order`.
- No se confirma un pedido por una redirección de navegador ni por un email. La confirmación requiere un pago verificado o una acción administrativa explícita y auditada, según el método habilitado.
- Los intentos de pago pueden ser múltiples; un pago confirmado debe cubrir el total del pedido. Pagos parciales y reembolsos parciales no forman parte del MVP salvo decisión posterior.
- No se crea un `Payment` ficticio para pedidos de importe cero. El flujo gratuito queda pendiente de aprobación.
- Los entitlements se generan solo al confirmar el pedido y permiten descargar la versión adquirida.
- No habrá un límite comercial artificial de descargas. Se aplican tokens de corta duración, autorización, rate limiting y controles técnicos de abuso.
- La suscripción vencida bloquea nuevas compras, pero no elimina los derechos ya otorgados.

### 9.1 Compras de invitados

El invitado recibe acceso al pedido mediante un token de acceso persistido como hash, de alcance limitado y con expiración. Si posteriormente crea una cuenta, se exige verificación de email antes de vincular compras. La coincidencia de email por sí sola nunca prueba identidad ni permite fusionar clientes automáticamente.

## 10. Registro interno de actividad: ventas externas y trabajos realizados

El MVP incluye un módulo privado de **Actividad manual** para registrar:

- ventas realizadas fuera de la plataforma (por ejemplo, ventas coordinadas o cobradas por otro canal);
- trabajos y servicios que el fotógrafo ya realizó, con su estado e importe cuando corresponda.

Estos registros se almacenan en `ManualWorkRecord` y su historial append-only asociado. Pueden alimentar estadísticas diferenciadas, por ejemplo ingresos confirmados en la plataforma frente a ventas externas registradas manualmente.

**Un `ManualWorkRecord` no es un pedido de la plataforma:** no crea `Order`, `Payment`, `OrderEntitlement`, token de descarga ni acceso a archivos. Tampoco confirma una transacción de la pasarela. La actividad manual debe poder identificarse claramente como declarada por un miembro y auditar sus cambios.

## 11. Alcance de servicios y exclusiones del MVP

Quedan expresamente fuera del MVP:

- catálogo público de servicios profesionales;
- publicación comercial de paquetes de servicios;
- solicitudes de presupuesto/cotizaciones;
- reservas, calendario de disponibilidad o turnos;
- contratación de servicios desde la plataforma;
- pagos de servicios contratados;
- marketplace/directorio público de fotógrafos.

La palabra “servicio” en el módulo de Actividad manual se refiere a un trabajo ya realizado que el fotógrafo registra internamente; no implica que pueda ofrecerse, cotizarse, reservarse o contratarse públicamente desde la plataforma.

## 12. Panel del fotógrafo

Módulos previstos para el MVP:

- Inicio y resumen de actividad.
- Álbumes y fotografías.
- Pedidos y pagos registrados en la plataforma.
- Clientes compradores.
- Actividad manual: ventas externas y trabajos/servicios realizados.
- Estadísticas, distinguiendo ventas online de ventas externas declaradas.
- Configuración de tienda y publicación.
- Suscripción de la cuenta.
- Equipo e invitaciones, habilitado por entitlement Business.

No debe existir en el MVP una sección de catálogo público de servicios, presupuestos, reservas ni contratación.

## 13. Roles por tienda

Roles iniciales:

- **OWNER:** control total sobre la tienda. El propietario de la `Account` tiene acceso OWNER implícito a todas sus tiendas; se crea igualmente una membresía para trazabilidad. Solo el propietario de la cuenta administra la suscripción y la facturación de la cuenta.
- **ADMIN:** administración operativa de la tienda y del equipo dentro de los permisos concedidos; no adquiere por ello la propiedad comercial ni la facturación de la cuenta.
- **PHOTOGRAPHER:** operaciones de fotografía, álbumes y trabajo de producción según la matriz de permisos.
- **EDITOR:** edición de contenido y presentación sin operaciones comerciales o administrativas sensibles no autorizadas.

Los roles se asignan por `StoreMembership`, no globalmente al usuario. Una misma persona puede tener roles distintos en tiendas diferentes. La matriz granular de permisos debe definirse y validarse en backend. Para operar se requieren, de forma independiente, membresía activa, permiso suficiente y entitlement comercial aplicable.

## 14. Registro y onboarding

1. Registro de `User` con email y contraseña.
2. Verificación de email.
3. Creación de `Account` comercial y primera tienda.
4. Selección de nombre y subdominio disponible.
5. Creación de configuración inicial, perfil, plantilla y secciones.
6. Inicio del trial al crear la primera tienda.
7. Acceso al panel.
8. Edición como borrador y publicación explícita.

El alta debe ser transaccional o idempotente para evitar cuentas o tiendas parcialmente creadas. Las invitaciones de equipo se aceptan mediante un token verificado, crean o vinculan un `User` y activan la membresía con el rol asignado. El colaborador no contrata ni paga un plan individual para aceptar la invitación.

## 15. Fuera del MVP

- Marketplace/directorio público y reseñas verificadas.
- Catálogo público de servicios, presupuestos, reservas y contratación.
- Pagos automatizados hasta seleccionar proveedor y aprobar la integración.
- Editor visual drag-and-drop.
- Aplicación móvil.
- Nuevas plantillas.
- CSS arbitrario.
- Descargas masivas ZIP, salvo que se aprueben como requisito posterior.
- Comisiones de marketplace y funciones avanzadas de estudio no definidas.

## 16. Criterios generales de aceptación

- Ningún usuario accede a datos privados de una tienda sin resolución de tenant, membresía activa y permisos suficientes.
- La suscripción se factura a la cuenta propietaria; los colaboradores invitados no pagan suscripciones individuales por colaborar.
- Los roles se evalúan por tienda y no se heredan entre tiendas.
- El plan Business habilita multi-tienda/equipo según entitlements configurados.
- Una fotografía no puede pertenecer a más de un álbum ni a un álbum de otra tienda.
- Las dos acciones de borrado de álbum producen resultados diferentes y auditables.
- Reemplazar una fotografía crea una nueva versión y conserva la versión adquirida históricamente.
- Comprar álbum + foto incluida no duplica el cobro ni el entitlement.
- Un pedido conserva snapshots de precio, composición y versiones adquiridas.
- Un pedido impago no genera derechos de descarga.
- Una suscripción vencida no revoca derechos previos.
- Los registros manuales no generan pedidos, pagos ni entitlements.
- No existe flujo público de servicios, cotizaciones, reservas o contratación en el MVP.
- La interfaz pública se sirve desde la publicación vigente y no desde borradores.


## 17. Dirección comercial y objetivo de negocio

La prioridad de dirección del proyecto es convertir el MVP en un negocio sostenible, no maximizar funcionalidades ni complejidad técnica. La estrategia comercial debe validarse con clientes reales y datos antes de invertir en desarrollos o publicidad de escala.

### 17.1 Objetivo comercial

- Conseguir los primeros fotógrafos que utilicen la plataforma de forma recurrente.
- Validar disposición real a pagar, no solo interés declarado.
- Reducir el tiempo desde el registro hasta la primera tienda publicada y la primera venta.
- Priorizar funcionalidades que mejoren adquisición, activación, conversión, retención o margen.
- Mantener bajo el costo fijo hasta demostrar demanda.

### 17.2 Métricas de negocio

Claude debe proponer y mantener un tablero de métricas con definiciones consistentes. Como mínimo:

- Leads cualificados y origen.
- Conversión de lead a demo/prueba y de prueba a cuenta activa.
- Activación: tienda publicada y catálogo cargado.
- Tiempo hasta primera publicación y primera venta.
- Fotógrafos activos semanal/mensualmente.
- Conversión de visitas de storefront a checkout y de checkout a compra confirmada.
- MRR/ARR cuando existan suscripciones pagas, churn y retención.
- Ingresos procesados por la plataforma separados de ventas externas declaradas.
- Coste de adquisición, gasto comercial y margen de contribución cuando haya datos suficientes.

No inventar métricas, ingresos, clientes ni tasas. Diferenciar datos observados, estimaciones e hipótesis.

### 17.3 Disciplina de validación

Antes de proponer una funcionalidad costosa, Claude debe explicar qué hipótesis comercial valida, qué evidencia existe, cuál es la alternativa más barata y qué métrica decidirá si continuar. Priorizar entrevistas, landing pages, demos y pilotos manuales cuando permitan validar demanda antes de construir.

El precio, los límites definitivos de planes y la política de monetización no se consideran cerrados por este apartado. Deben proponerse con evidencia y aprobarse por el propietario antes de comprometerlos públicamente.

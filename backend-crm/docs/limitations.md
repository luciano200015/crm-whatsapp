# Limitaciones y pendientes

Estado con autenticación, planes, equipo, contactos, canales y bandeja de mensajes. Detalles y pruebas locales en [inbox.md](inbox.md).

## No implementado todavía

- **Workspaces**: crear workspaces adicionales, editarlos, abandonarlos y transferir la propiedad. Las **invitaciones por enlace** tampoco existen: hoy los agentes se dan de alta con contraseña temporal ([team.md](team.md)).
- **Equipo**: las líneas asignadas y la autoasignación están disponibles. La contraseña temporal no caduca hasta que se cambia o se reenvía. Los correos del equipo están en inglés.
- **Autorización por workspace**: `WorkspaceAccessGuard`, `@RequirePermissions()` y `@CurrentWorkspace()` protegen billing y equipo. No hay caché de permisos: se consultan en cada petición.
- **Rate limiting distribuido**: el actual (`@nestjs/throttler`) guarda los contadores en memoria, por proceso. Con varias instancias hay que pasarlo a Redis (Fase 7).
- **Bloqueo por cuenta**: 5 fallos seguidos bloquean la cuenta 15 minutos. Esto permite que un tercero bloquee temporalmente una cuenta ajena; el throttling por IP lo limita. Pendiente valorar CAPTCHA o bloqueo progresivo.
- **Lista de contraseñas filtradas**: la política no consulta listas de contraseñas comprometidas (p. ej. HIBP k-anonymity).
- **Limpieza de sesiones y tokens caducados**: las filas caducadas quedan en la base de datos (se rechazan por fecha). Falta un job periódico de limpieza y de marcado `EXPIRED`.
- **Rotación de claves JWT**: hay un solo par de claves; rotarlas invalida todos los access tokens (máx. 15 min de impacto). Falta soporte de `kid`/JWKS con varias claves.
- **Billing**: no hay pasarela de pago real (`BILLING_PAYMENTS_MODE` solo admite `disabled` y `simulated`), ni job que expire pruebas o periodos (el estado se recalcula y persiste al leerlo), ni emails de aviso de fin de prueba. Los límites solo se aplican a los agentes al bajar de plan; el resto se aplicará cuando existan contactos, líneas y créditos IA. Detalle en [billing.md](billing.md#pendiente).
- **Mensajería**: pendientes las plantillas (escribir fuera de las 24 h) y Embedded Signup. Los archivos se conservan en GridFS sin caducidad, y no se borran al eliminar una línea o un contacto. El límite propio de envío es 16 MB. SSE funciona en una instancia; varias instancias requieren Redis. No hay cola persistente/outbox para recuperar fallos parciales entre PostgreSQL y MongoDB. Las notificaciones solo funcionan con la aplicación abierta (no hay push).

## Decisiones con contrapartidas

- **NestJS 11 en lugar de 12**: NestJS 12 se publica solo como ESM, lo que complica Jest (exigido por el plan). Se migrará cuando el tooling de pruebas lo soporte bien o si se adopta otro runner.
- **TypeScript 5.9 en lugar de 7**: `typescript-eslint` y `ts-jest` aún no soportan TypeScript 7.
- **Prisma 7.10.1 en lugar de 8**: la etiqueta `latest` de npm apunta a una RC de Prisma 8.
- **Índices parciales con preview feature** (`partialIndexes`) de Prisma: puede cambiar de sintaxis en versiones futuras. Si se retira, mover los tres índices a SQL manual en una migración.
- **MongoDB sin replica set** en desarrollo: no hay transacciones multi-documento en Mongo todavía. Si se necesitan, configurar replica set de un nodo en `docker-compose.yml`.
- **Jest con `--experimental-vm-modules`** en `test:int` y `test:e2e`: el cliente de Prisma 7 carga su compilador WASM mediante `import()` dinámico. Node muestra un `ExperimentalWarning` inofensivo.
- `test:int` y `test:e2e` comparten la base `crm_test` y vacían sus tablas: ejecutarlos uno detrás de otro, no en paralelo.
- **Redis** está en Docker Compose (perfil `cache`) pero la aplicación no lo usa.

## Seguridad pendiente de revisar en fases siguientes

- Parámetros de Argon2id frente al hardware de producción (objetivo: menos de 500 ms por hash).
- `audit_logs` es append-only por convención; no hay aún permisos de base de datos que impidan `UPDATE`/`DELETE` (usar un rol de BD sin esos privilegios en producción).
- TLS hacia PostgreSQL/MongoDB en producción (`sslmode=require`, `tls=true`), backups y pruebas de restauración: Fase 7.

## Vulnerabilidades conocidas en dependencias

- `npm audit --omit=dev`: 0 vulnerabilidades en dependencias de producción (se fuerza `js-yaml ^5.5.0` para `@nestjs/swagger` mediante `overrides`).
- Dependencias de desarrollo: `sprintf-js` (DoS, moderada) a través de `jest → babel-plugin-istanbul → js-yaml@3 → argparse@1`. No hay versión corregida publicada; solo afecta a la ejecución local de pruebas con datos controlados.

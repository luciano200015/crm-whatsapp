# Autorización

## Modelo

```
User ──< WorkspaceMembership >── Workspace
              │
              └──< MembershipRole >── Role ──< RolePermission >── Permission
```

- Un usuario tiene una membresía por workspace; cada membresía tiene uno o más roles.
- Los guards comprueban **claves de permiso**, nunca nombres de rol. Así se pueden crear roles nuevos sin tocar la lógica.
- Los permisos efectivos se resuelven en el servidor en cada petición protegida (Fase 4). No se confía en roles/permisos incluidos en el JWT ni enviados por el cliente.

## Catálogo

Fuente única: [`src/modules/authorization/domain/permission-catalog.ts`](../src/modules/authorization/domain/permission-catalog.ts). `npm run db:seed` lo sincroniza con la base de datos.

| Permiso            | Propietario (`OWNER`) | Administrador (`ADMIN`) | Agente regular (`AGENT`) |
| ------------------ | :---: | :---: | :---: |
| `workspace.read`   | ✓ | ✓ | ✓ |
| `workspace.update` | ✓ | ✓ |   |
| `members.read`     | ✓ | ✓ | ✓ |
| `members.invite`   | ✓ | ✓ |   |
| `members.manage`   | ✓ | ✓ |   |
| `roles.read`       | ✓ | ✓ |   |
| `roles.manage`     | ✓ |   |   |
| `contacts.read`    | ✓ | ✓ | ✓ |
| `contacts.write`   | ✓ | ✓ | ✓ |
| `tags.manage`      | ✓ | ✓ |   |
| `channels.read`    | ✓ | ✓ |   |
| `channels.manage`  | ✓ | ✓ |   |
| `messages.read`    | ✓ | ✓ | ✓ |
| `messages.send`    | ✓ | ✓ | ✓ |
| `conversations.assign`   | ✓ | ✓ |   |
| `conversations.view_all` | ✓ | ✓ |   |
| `quick_replies.manage` | ✓ | ✓ |   |
| `chatbots.manage`  | ✓ | ✓ |   |
| `funnels.read`     | ✓ | ✓ | ✓ |
| `funnels.write`    | ✓ | ✓ | ✓ |
| `funnels.manage`   | ✓ | ✓ |   |
| `billing.read`     | ✓ | ✓ |   |
| `billing.manage`   | ✓ |   |   |

Las pruebas unitarias del catálogo verifican:

- OWNER tiene todos los permisos.
- `billing.manage` y `roles.manage` son exclusivos de OWNER.
- AGENT no puede invitar ni gestionar miembros.
- Cada permiso pertenece a un grupo conocido (`PERMISSION_GROUPS`), que la interfaz usa para construir roles.

**Roles del sistema y roles personalizados.** `roles.workspace_id` decide el alcance:

- `NULL`: rol del sistema, compartido y de solo lectura.
- Con valor: rol personalizado de ese workspace.

Un `CHECK` mantiene `is_system` coherente. El rol `VIEWER` se retiró en la migración `team_members_roles`: cada workspace que lo usaba recibió un rol personalizado «Solo lectura» con los mismos permisos. Ver [team.md](team.md).

## Añadir un permiso

1. Añadir la clave y descripción a `PERMISSIONS`.
2. Concederla a los roles de sistema que correspondan en `SYSTEM_ROLES`.
3. `npm run db:seed` (idempotente).
4. Usarla en el endpoint con `@RequirePermissions('<clave>')` (Fase 4).

Si se elimina un permiso del catálogo, el seed **no** lo borra de la base de datos (podría estar asignado a roles personalizados); lo informa como "desconocido". Su eliminación requiere una migración revisada.

## Seed idempotente

`prisma/seed-authorization.ts`, en una sola transacción:

1. `upsert` de cada permiso por `key`.
2. Roles de sistema: búsqueda por `key` con `workspace_id IS NULL` y creación/actualización (el índice único parcial impide duplicados incluso con ejecuciones concurrentes).
3. Sincroniza `role_permissions` de los roles de sistema con la matriz: añade los que faltan y elimina los sobrantes.

## Guard por workspace

Las rutas `/workspaces/:workspaceId/...` usan `WorkspaceAccessGuard` junto con `@RequirePermissions(...)`:

```ts
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/subscription', version: '1' })
export class WorkspaceSubscriptionController {
  @Get()
  @RequirePermissions('billing.read')
  get(@CurrentWorkspace() workspace: WorkspaceAccess) { … }
}
```

- Se ejecuta después del `JwtAuthGuard` global, con el usuario ya autenticado.
- `AuthorizationService.resolveAccess` lee de la base de datos, **en cada petición**, la membresía (debe estar `ACTIVE`, en un workspace no archivado), sus roles y los permisos efectivos (unión de los roles). Nunca se fía de un rol o permiso enviado por el cliente o guardado en el JWT.
- Un usuario que no es miembro, o un `workspaceId` mal formado: **404** (no se revela si el workspace existe). Un miembro sin el permiso: **403**.
- `@CurrentWorkspace()` entrega `{ workspaceId, membershipId, roles, permissions }` al controlador.

## Regla del último propietario

Todo workspace activo debe tener al menos una membresía `ACTIVE` con rol `OWNER`. Ya la aplican el cambio de rol y la desactivación del módulo de equipo; abandonar el workspace y transferir la propiedad la aplicarán cuando existan. Cada operación se ejecuta en una transacción que:

1. Bloquea la fila del workspace (`SELECT … FROM workspaces WHERE id = $1 FOR UPDATE`) para serializar cambios concurrentes sobre sus propietarios.
2. Cuenta los propietarios activos restantes tras el cambio.
3. Rechaza la operación (`409 LAST_OWNER`) y deshace la transacción si el resultado es 0.

La transferencia de propiedad será explícita: añadir OWNER al destinatario y, en la misma transacción, opcionalmente retirárselo al emisor.

## Anti-escalada de privilegios

Un miembro con `members.*` o `roles.manage` solo puede:

- asignar, crear o editar roles cuyos permisos tenga él mismo;
- actuar sobre miembros cuyos permisos tenga.

Si no, recibe `403 ROLE_ESCALATION`. Por eso un Administrador gestiona agentes pero no puede tocar a un Propietario ni darle a nadie el rol Propietario. Detalle en [team.md](team.md#reglas-de-autorización).

## Roles personalizados

Implementados en el módulo de equipo: requieren `roles.manage` y un plan con `features.custom_roles`. Un rol de un workspace solo se ve y se asigna dentro de ese workspace (`404 ROLE_NOT_FOUND` desde otro), y los roles del sistema no son editables. Ver [team.md](team.md).

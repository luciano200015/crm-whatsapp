# Equipo: agentes y roles

Código en [`src/modules/team`](../src/modules/team). Equivale a la sección **Equipo** de wasapi (pestañas *Agentes* y *Roles*): el propietario o un administrador registra agentes, les asigna un rol, los desactiva y crea roles propios a partir de los permisos existentes. Todo ocurre dentro de un workspace y respetando los límites del plan.

## Roles

| Tipo | `roles.workspace_id` | Quién los ve | ¿Editables? |
| ---- | -------------------- | ------------ | ----------- |
| **Del sistema**: Propietario (`OWNER`), Administrador (`ADMIN`), Agente regular (`AGENT`) | `NULL` | Todos los workspaces | No: solo lectura (`403 SYSTEM_ROLE_READ_ONLY`) |
| **Personalizados** | El id del workspace | Solo ese workspace | Sí: crear, editar y eliminar |

`workspace_id` es la regla: nulo = rol del sistema, con valor = rol creado por un workspace. La columna `is_system` se mantiene por compatibilidad, y un `CHECK` (`roles_system_scope_check`) impide que contradiga a `workspace_id`.

Los permisos de cada rol del sistema están en [`permission-catalog.ts`](../src/modules/authorization/domain/permission-catalog.ts) (ver la tabla en [authorization.md](authorization.md)). El rol `VIEWER` se retiró: la migración `team_members_roles` lo convirtió en un rol personalizado «Solo lectura» en cada workspace que lo usaba, con los mismos permisos y sin quitar acceso a nadie.

### Roles personalizados

- Se construyen con los permisos del catálogo, agrupados por módulo (`GET …/permissions`).
- La `key` se deriva del nombre (`Supervisor de Ventas` → `supervisor-de-ventas`) y es única por workspace: dos nombres que solo difieren en mayúsculas o tildes chocan (`409 ROLE_NAME_TAKEN`).
- Editar un rol cambia al instante lo que pueden hacer sus miembros: los permisos se leen de la base de datos en cada petición.
- **No se puede eliminar un rol asignado** (`409 ROLE_IN_USE`, `details.members`). Primero hay que asignar otro rol a esos miembros.
- **Plan:** crear, editar o asignar roles personalizados requiere `features.custom_roles` (planes Empresa y Corporativo). Si no está incluida: `403 FEATURE_NOT_IN_PLAN`. Tras bajar al plan Equipo, los roles existentes siguen funcionando y se pueden eliminar o reasignar, pero no editar.

## Agentes (miembros)

Un agente es una **membresía** (`workspace_memberships`) con un rol. El servicio mantiene **un rol por miembro**: la tabla admite varios, pero cambiar el rol reemplaza el anterior.

### Alta con contraseña temporal

`POST /workspaces/:id/members { email, displayName, roleId }`

1. Comprueba el rol (del sistema o de este workspace), la regla anti-escalada y el plan:
   - la suscripción debe dar acceso completo (prueba en curso o pagada), si no `402 SUBSCRIPTION_INACTIVE`;
   - tiene que caber en `limits.agents`, si no `409 AGENT_LIMIT_REACHED` con `details: { feature, plan, limit, usage }`.
2. Si el email **no tiene cuenta**:
   - se genera una contraseña temporal aleatoria con el CSPRNG (16 caracteres sin ambiguos, ~92 bits) y se guarda solo su hash Argon2id;
   - se crean el usuario `ACTIVE` y la membresía en una sola transacción, con `user_credentials.must_change_password = true`;
   - se envía por email **una vez** (en desarrollo, a Mailpit).
3. Si el email **ya tiene cuenta**: solo se añade la membresía y se envía un aviso. Su contraseña no se toca.
4. Si ya es miembro: `409 MEMBER_ALREADY_EXISTS`, o `MEMBER_DEACTIVATED` si está desactivado (hay que reactivarlo).

La contraseña temporal nunca aparece en la respuesta de la API, en los logs ni en la auditoría.

### Primer inicio de sesión

Mientras `must_change_password` sea `true`, el `JwtAuthGuard` global responde `403 PASSWORD_CHANGE_REQUIRED` en todas las rutas salvo las marcadas con `@AllowPendingPasswordChange()`:

- `GET /users/me` (incluye `mustChangePassword: true`);
- `POST /auth/password/change`;
- las sesiones;
- `refresh` y `logout`, que son públicas.

El login también devuelve `user.mustChangePassword`. El frontend lleva al usuario a `/account/password-required`.

Al cambiarla con `POST /auth/password/change`:

- se limpia el indicador;
- **se marca el email como verificado**, porque solo quien lee ese buzón conoce la contraseña temporal;
- se cierran las demás sesiones.

Un restablecimiento por «¿Olvidaste tu contraseña?» también limpia el indicador.

Si el agente no recibió el correo o lo perdió: `POST …/members/:memberId/resend-access` genera una contraseña temporal nueva e invalida la anterior. Solo funciona mientras no haya elegido la suya; después responde `409 ACCESS_ALREADY_SET` y debe usar «¿Olvidaste tu contraseña?».

### Desactivar y reactivar

- **Desactivar** pone la membresía en `DEACTIVATED`. El acceso a ese workspace termina en la siguiente petición del agente (`404`, como si no fuera miembro). Su cuenta, sus sesiones y sus otros workspaces no se tocan.
- **Reactivar** vuelve a contar para `limits.agents` y necesita un plan activo.
- Los miembros desactivados no cuentan para el límite del plan.

## Reglas de autorización

| Regla | Error |
| ----- | ----- |
| El `workspaceId` sale siempre del guard; un miembro o rol de otro workspace se trata como inexistente | `404 MEMBER_NOT_FOUND` / `ROLE_NOT_FOUND` |
| **Anti-escalada:** solo se puede asignar, crear o editar un rol cuyos permisos tengas. Solo puedes actuar sobre miembros cuyos permisos tengas. Así un Administrador no puede tocar a un Propietario ni dar el rol Propietario | `403 ROLE_ESCALATION` (`details.missing`) |
| Nadie cambia su propio rol ni se desactiva a sí mismo | `403 CANNOT_MODIFY_SELF` |
| El workspace siempre conserva al menos un Propietario activo | `409 LAST_OWNER` |

**Concurrencia:** el alta, la reactivación, el cambio de rol y la desactivación se ejecutan en una transacción que bloquea la fila del workspace (`SELECT … FOR UPDATE`). Dos altas simultáneas no superan el límite del plan y dos cambios simultáneos no dejan el workspace sin propietario.

## API

Todas bajo `/api/v1/workspaces/:workspaceId`, con `WorkspaceAccessGuard`.

| Método y ruta | Permiso | Qué hace |
| ------------- | ------- | -------- |
| `GET members?status&roleId&search&limit&offset` | `members.read` | Lista y uso del plan (`usage: { activeMembers, limit }`) |
| `GET members/:memberId` | `members.read` | Un miembro |
| `POST members` | `members.invite` | Registrar agente |
| `PATCH members/:memberId { roleId }` | `members.manage` | Cambiar rol |
| `POST members/:memberId/deactivate` | `members.manage` | Desactivar |
| `POST members/:memberId/reactivate` | `members.manage` | Reactivar |
| `POST members/:memberId/resend-access` | `members.invite` | Nueva contraseña temporal |
| `GET permissions` | `roles.read` | Catálogo de permisos agrupado |
| `GET roles` · `GET roles/:roleId` | `roles.read` | Roles del sistema y del workspace, con número de miembros |
| `POST roles { name, description?, permissions }` | `roles.manage` | Crear rol personalizado |
| `PATCH roles/:roleId` | `roles.manage` | Editar rol personalizado |
| `DELETE roles/:roleId` | `roles.manage` | Eliminar rol personalizado sin miembros |

Con los roles del sistema: OWNER puede todo. ADMIN gestiona agentes (`members.*`) y ve los roles, pero no los crea ni edita (`roles.manage`). AGENT solo ve el equipo.

## Auditoría

- `team.member.created` (cuenta nueva), `team.member.added` (cuenta existente), `team.member.role_changed`, `team.member.deactivated`, `team.member.reactivated` y `team.member.access_resent`.
- `team.role.created`, `team.role.updated` y `team.role.deleted`.

## Datos demo

- **Acme Corp** (plan Empresa): roles personalizados «Solo lectura» (`viewer@example.com`) y «Supervisor».
- **Globex** (plan Equipo, sin roles personalizados): la membresía desactivada de `viewer@example.com` tiene el rol Agente regular.
- Una base de datos local que ya tenía datos conserva el rol «Solo lectura» que la migración creó en Globex: no se borra nada.

## Pendiente

- **Teléfonos asignados:** se añadirán con la fase de mensajería, cuando existan las líneas de WhatsApp (`limits.whatsapp_lines`).
- La contraseña temporal no caduca: sigue valiendo hasta que el agente la cambie o se reenvíe el acceso. Falta una caducidad configurable.
- Los correos del equipo están en inglés, igual que los de autenticación. Falta localizarlos.
- Transferir la propiedad y abandonar un workspace.
- Invitaciones por enlace (la tabla `workspace_invitations` existe, pero no se usa todavía).

# CRM SaaS

CRM multi-tenant. Este repositorio reúne la API y la aplicación web.

| Carpeta | Qué es | Stack |
| ------- | ------ | ----- |
| [`backend-crm/`](backend-crm) | API REST | NestJS 11, TypeScript, PostgreSQL + Prisma, MongoDB + Mongoose, Jest |
| [`frontend-crm/`](frontend-crm) | Aplicación web | React 19, TypeScript, Vite, MUI, TanStack Query, Vitest |

Cada proyecto tiene sus propias dependencias (`package.json`), su `.env` y su README con el detalle.

## Requisitos

- Node.js ≥ 22.12 (recomendado 24).
- Docker Desktop (PostgreSQL, MongoDB y Mailpit corren en contenedores).

## Arrancar todo en local

La primera vez, crea `backend-crm/.env` y `backend-crm/.env.test` a partir de sus `*.example` y genera los secretos ([sección 2 del README del backend](backend-crm/README.md#2-puesta-en-marcha-primera-vez)). Después:

```bash
# 1. API (terminal 1)
cd backend-crm
npm ci
npm run docker:up               # PostgreSQL, MongoDB y Mailpit
npm run prisma:migrate:deploy
npm run db:seed                 # roles, planes y datos demo
npm run start:dev               # http://localhost:3000 · Swagger: /docs

# 2. Web (terminal 2)
cd frontend-crm
npm ci
npm run dev                     # http://localhost:5173
```

Los correos (verificación, recuperación, accesos de agentes) llegan a **Mailpit**: http://localhost:8025.

Los pasos completos, las variables de entorno y los usuarios demo están en [backend-crm/README.md](backend-crm/README.md) y [frontend-crm/README.md](frontend-crm/README.md).

## Documentación

- [Arquitectura](backend-crm/docs/architecture.md)
- [Autenticación](backend-crm/docs/authentication.md) · [Autorización y roles](backend-crm/docs/authorization.md)
- [Equipo: agentes y roles](backend-crm/docs/team.md)
- [Contactos y etiquetas](backend-crm/docs/contacts.md) · [Canales WhatsApp](backend-crm/docs/channels.md) · [Bandeja y autoasignación](backend-crm/docs/inbox.md)
- [Planes y suscripciones](backend-crm/docs/billing.md)
- [Modelo de datos](backend-crm/docs/data-model.md) · [Limitaciones](backend-crm/docs/limitations.md)

## Seguridad

Ningún `.env` se versiona: solo los `*.example` con valores de ejemplo. Los secretos locales se generan con `npm run secrets:generate` en `backend-crm`.

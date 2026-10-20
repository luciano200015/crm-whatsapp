import { z } from 'zod'
import { es } from '../i18n/es'

/** Mirrors the backend policy (src/modules/auth/domain/password-policy.ts). */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

export const emailSchema = z
  .string()
  .trim()
  .min(1, es.common.required)
  .max(320, es.validation.maxLength(320))
  .pipe(z.email(es.validation.email))

export const newPasswordSchema = z
  .string()
  .min(1, es.common.required)
  .refine((value) => [...value.normalize('NFKC')].length >= PASSWORD_MIN, {
    message: es.validation.passwordMin(PASSWORD_MIN),
  })
  .refine((value) => [...value.normalize('NFKC')].length <= PASSWORD_MAX, {
    message: es.validation.passwordMax(PASSWORD_MAX),
  })

const requiredText = (max: number) =>
  z.string().trim().min(1, es.common.required).max(max, es.validation.maxLength(max))

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, es.common.required),
})
export type LoginValues = z.infer<typeof loginSchema>

export const signUpSchema = z
  .object({
    displayName: requiredText(120),
    email: emailSchema,
    confirmEmail: z.string().trim().min(1, es.common.required),
    workspaceName: requiredText(120),
    password: newPasswordSchema,
  })
  .refine((v) => v.email.toLowerCase() === v.confirmEmail.toLowerCase(), {
    path: ['confirmEmail'],
    message: es.validation.emailsMismatch,
  })
  .refine((v) => v.password.trim().toLowerCase() !== v.email.toLowerCase(), {
    path: ['password'],
    message: es.validation.passwordIsEmail,
  })
export type SignUpValues = z.infer<typeof signUpSchema>

export const forgotSchema = z.object({ email: emailSchema })
export type ForgotValues = z.infer<typeof forgotSchema>

export const resetSchema = z
  .object({ password: newPasswordSchema, confirm: z.string().min(1, es.common.required) })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: es.validation.passwordsMismatch,
  })
export type ResetValues = z.infer<typeof resetSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, es.common.required),
    newPassword: newPasswordSchema,
    confirm: z.string().min(1, es.common.required),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: es.validation.passwordsMismatch,
  })
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>

export const profileSchema = z.object({
  displayName: requiredText(120),
  locale: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[a-z]{2,3}(-[A-Z]{2})?$/.test(v), 'Ejemplo: es o es-BO'),
  timezone: z.string(),
})
export type ProfileValues = z.infer<typeof profileSchema>

import { usePermissions } from '../../auth/usePermissions'

/** Whoever may change the contact's tags may tag the chat. */
export function useCanTagChat() {
  const { has } = usePermissions()
  return has('contacts.write') && has('contacts.read')
}

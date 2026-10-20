export abstract class ContactQuota {
  abstract reserve(
    workspaceId: string,
    contactId: string,
    month: Date,
    limit: number | null,
  ): Promise<boolean>;
}

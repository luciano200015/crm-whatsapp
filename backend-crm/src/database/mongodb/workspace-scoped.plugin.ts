import type { Query, Schema } from 'mongoose';

/** Query operations that must always be filtered by workspace. */
const SCOPED_QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
] as const;

export class MissingWorkspaceFilterError extends Error {
  constructor(collection: string, operation: string) {
    super(
      `Refusing ${operation} on "${collection}" without a workspaceId filter`,
    );
    this.name = 'MissingWorkspaceFilterError';
  }
}

/**
 * Multi-tenant guard for MongoDB collections:
 * - every document has a required `workspaceId`;
 * - every query and aggregation must filter by `workspaceId`, so a missing
 *   filter fails loudly instead of reading or changing other workspaces.
 */
export function workspaceScoped(schema: Schema): void {
  schema.add({ workspaceId: { type: String, required: true } });

  for (const operation of SCOPED_QUERY_OPS) {
    schema.pre(operation, function (this: Query<unknown, unknown>) {
      const filter = this.getFilter() as Record<string, unknown>;
      if (typeof filter.workspaceId !== 'string' || !filter.workspaceId) {
        throw new MissingWorkspaceFilterError(
          this.model.collection.collectionName,
          operation,
        );
      }
    });
  }

  schema.pre('aggregate', function () {
    const [first] = this.pipeline() as unknown as Record<string, unknown>[];
    const match = first?.$match as Record<string, unknown> | undefined;
    if (typeof match?.workspaceId !== 'string' || !match.workspaceId) {
      throw new MissingWorkspaceFilterError(
        this.model().collection.collectionName,
        'aggregate',
      );
    }
  });
}

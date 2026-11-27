import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

/** Drizzle v2 relations. drizzle-graphql generates nested read fields from these. */
export const relations = defineRelations(schema, (relate) => ({
  servers: { memberships: relate.many.workspaceMembers() },
  workspaces: { members: relate.many.workspaceMembers() },
  workspaceMembers: {
    workspace: relate.one.workspaces({ from: relate.workspaceMembers.workspaceId, to: relate.workspaces.id }),
    server: relate.one.servers({ from: relate.workspaceMembers.serverId, to: relate.servers.id }),
  },
}));

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof postgres> | undefined;
};

function getClient() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    return undefined;
  }

  if (globalForDb.client) return globalForDb.client;

  const client = postgres(connectionString, {
    ssl: "require",
    // A request runs at most two queries at once; a few connections cover an
    // instance serving several requests without hogging pooler slots.
    max: 5,
    // Close idle connections so suspended function instances don't hold
    // slots on the Supabase pooler.
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  if (process.env.NODE_ENV !== "production") globalForDb.client = client;
  return client;
}

const client = getClient();

export const db = client ? drizzle(client, { schema }) : null;
export { schema };

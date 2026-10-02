// LOCAL-FIRST: the device-level meta store -- things that belong to THIS BROWSER on THIS LAPTOP rather than to one signed-in
// person: the installed release and its file table, the device id, the persistence outcome, the mirrored identity.
//
// It is the local database's default-named store ("projexa-local", LOCAL_DB_NAME) opened through its public openLocalDb() and only
// getMeta()/setMeta() are used, so it follows the database wherever its schema goes. Each person's replica lives in its own
// database (localDbNameFor(userId)); nothing person-specific beyond the identity mirror is kept here.

import { openLocalDb } from "./local-db";
import type { MetaStore } from "./release/installer";

export type OpenedMeta = { meta: MetaStore; close: () => void };

/** Opens the device meta store. The caller must call close(). */
export async function openDeviceMeta(idb?: IDBFactory): Promise<OpenedMeta> {
  const db = await openLocalDb(idb);
  return { meta: db, close: () => db.close() };
}

/** A MetaStore that opens and closes the device database around every single call, for long-lived holders (a hook, a timer). */
export function deviceMetaStore(idb?: IDBFactory): MetaStore {
  return {
    async getMeta<T = unknown>(key: string) {
      const { meta, close } = await openDeviceMeta(idb);
      try {
        return await meta.getMeta<T>(key);
      } finally {
        close();
      }
    },
    async setMeta(key, value) {
      const { meta, close } = await openDeviceMeta(idb);
      try {
        await meta.setMeta(key, value);
      } finally {
        close();
      }
    },
  };
}

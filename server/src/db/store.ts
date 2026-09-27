import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export interface QueryResult { rows: Record<string, unknown>[]; changes: number }
export interface Store {
  dialect: 'sqlite' | 'postgres';
  prepare(sql: string): {
    all(...values: SQLInputValue[]): Promise<Record<string, unknown>[]>;
    get(...values: SQLInputValue[]): Promise<Record<string, unknown> | undefined>;
    run(...values: SQLInputValue[]): Promise<{ changes: number }>;
  };
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export function sqliteStore(db: DatabaseSync): Store {
  const scope = new AsyncLocalStorage<boolean>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    dialect: 'sqlite',
    prepare(sql) {
      return {
        async all(...values) { return db.prepare(sql).all(...values); },
        async get(...values) { return db.prepare(sql).get(...values); },
        async run(...values) { return { changes: Number(db.prepare(sql).run(...values).changes) }; },
      };
    },
    transaction(work) {
      if (scope.getStore()) return work();
      // A SQLite connection must never interleave two asynchronous transactions.
      const result = tail.then(() => scope.run(true, async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const value = await work(); db.exec('COMMIT'); return value; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      }));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

export function postgresSql(sql: string): string {
  let parameter = 0;
  return sql
    .replace(/\b([\w.]+) COLLATE NOCASE/g, 'lower($1)')
    .replace(/\bLIKE\b/g, 'ILIKE')
    .replace(/json_each\(entries.details_json\)/g, 'jsonb_each_text(entries.details_json::jsonb) AS json_each')
    .replace(/catalog_rating DESC/g, 'catalog_rating DESC NULLS LAST')
    // Preserve quoted SQL strings; only bind actual placeholders.
    .replace(/'(?:''|[^'])*'|\?/g, (token) => token === '?' ? '$' + ++parameter : token);
}

export type Query = (sql: string, values: SQLInputValue[]) => Promise<QueryResult>;
export type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>;

export function postgresStore(transaction: Transaction): Store {
  const scope = new AsyncLocalStorage<Query>();
  return {
    dialect: 'postgres',
    prepare(sql) {
      const execute = (values: SQLInputValue[]) => {
        const query = scope.getStore();
        if (!query) throw new Error('Database queries require a transaction');
        return query(postgresSql(sql), values);
      };
      return {
        async all(...values) { return (await execute(values)).rows; },
        async get(...values) { return (await execute(values)).rows[0]; },
        async run(...values) { return { changes: (await execute(values)).changes }; },
      };
    },
    transaction(work) {
      if (scope.getStore()) return work();
      return transaction((query) => scope.run(query, work));
    },
  };
}

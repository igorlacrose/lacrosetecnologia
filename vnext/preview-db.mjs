import { readFile, readdir } from 'node:fs/promises';

// Only in-memory PGlite databases created by this fixture factory may use
// the synthetic preview identity; a persistent database never gets this mark.
const syntheticPreviewDatabases = new WeakSet();
export const isSyntheticPreviewDatabase = db => syntheticPreviewDatabases.has(db);

export const fixture = Object.freeze({
  tenant: '00000000-0000-4000-8000-000000000001',
  secondTenant: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000011',
  viewer: '00000000-0000-4000-8000-000000000012',
  secondAdmin: '00000000-0000-4000-8000-000000000013',
});

export async function createPreviewDatabase() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      grant usage on schema auth to authenticated;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select (auth.jwt()->>'sub')::uuid $$;
    `);
    const directory = new URL('./db/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    }
    await db.query("insert into lkz_vnext.tenants values ($1, 'Lacrose Tecnologia'), ($2, 'Empresa de teste B')",
      [fixture.tenant, fixture.secondTenant]);
    await db.query('insert into auth.users values ($1), ($2), ($3)', [fixture.admin, fixture.viewer, fixture.secondAdmin]);
    await db.query(`insert into lkz_vnext.memberships values
      ($1,$3,'admin',true), ($1,$4,'viewer',true), ($2,$5,'admin',true)`,
    [fixture.tenant, fixture.secondTenant, fixture.admin, fixture.viewer, fixture.secondAdmin]);
    await withIdentity(db, { sub: fixture.admin, aal: 'aal2' }, async (tx) => {
      await tx.query(`insert into lkz_vnext.products (tenant_id,slug,name,kind) values
        ($1,'barbaros','BarbarOS','saas'), ($1,'libertyos','LibertyOS','saas')`, [fixture.tenant]);
    });
    syntheticPreviewDatabases.add(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export function withIdentity(db, claims, operation) {
  return db.transaction(async (tx) => {
    await tx.exec(claims ? 'set local role authenticated' : 'set local role anon');
    if (claims) {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    }
    return operation(tx);
  });
}

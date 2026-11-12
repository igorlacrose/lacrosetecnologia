import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const productionRef = 'icrtewhazpfauuroswri';
const managedStagingHost = 'db.nijsafzwxzcfqdevlsxe.supabase.co';
const managedStagingConnections = new WeakSet();

export function openStagingDatabase(connectionString) {
  const target = new URL(connectionString);
  // The dedicated managed Supabase staging project has the standard
  // "postgres" database name. Accept it only on the pinned staging host,
  // never on arbitrary Supabase projects, poolers, or the production project.
  const standaloneDatabase = /^\/lkz_vnext_stage(?:_[a-z0-9]+)?$/.test(target.pathname);
  const managedStaging = target.hostname === managedStagingHost
    && target.pathname === '/postgres' && (!target.port || target.port === '5432');
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || (!standaloneDatabase && !managedStaging)
    || decodeURIComponent(connectionString).toLowerCase().includes(productionRef)
    || target.search || target.hash) {
    throw new Error('Expected a dedicated LKZ VNext staging database URL without query options');
  }
  const local = ['127.0.0.1', '[::1]'].includes(target.hostname);
  const pool = new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: true },
    max: 6,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
  });
  pool.on('error', () => console.error('Idle PostgreSQL connection closed'));
  const connection = {
    async transaction(operation) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('begin');
        const result = await operation({
          query: (sql, values) => client.query(sql, values),
          exec: (sql) => client.query(sql),
        });
        await client.query('commit');
        return result;
      } catch (error) {
        try { await client.query('rollback'); } catch { discard = true; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
  if (managedStaging) managedStagingConnections.add(connection);
  return connection;
}

async function assertRowSecurity(tx, schemas) {
  const { rows: [status] } = await tx.query(`
    select count(distinct n.nspname) = cardinality($1::text[])
      and coalesce(bool_and(pg_catalog.row_security_active(c.oid)), false) as enforced
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('r','p')
  `, [schemas]);
  if (status?.enforced !== true) throw new Error('VNext requires active row-level security');
}

export async function assertWorkspaceRole(db) {
  await db.transaction(async tx => {
    const { rows: [role] } = await tx.query(`
      select current_user as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit,
        pg_has_role(current_user, 'authenticated', 'MEMBER') as can_auth,
        pg_has_role(current_user, 'authenticated', 'USAGE') as inherits_auth,
        (select count(*) from pg_roles elevated where
          elevated.rolname in ('lkz_vnext_asaas_ingest','lkz_vnext_asaas_reconcile','lkz_vnext_asaas_issue')
          and pg_has_role(current_user,elevated.oid,'MEMBER')) as billing_roles,
        (select count(*) from pg_namespace n join pg_roles r on r.oid=n.nspowner
          where n.nspname in ('lkz_vnext', 'lkz_vnext_billing')
            and pg_has_role(current_user,r.oid,'MEMBER')) as owned_schemas
      from pg_roles where rolname = current_user
    `);
    if (role.name !== 'lkz_vnext_runtime' || role.rolsuper || role.rolbypassrls
      || role.rolcreaterole || role.rolcreatedb || role.rolinherit || !role.can_auth || role.inherits_auth || Number(role.billing_roles) || Number(role.owned_schemas)) {
      throw new Error('Invalid VNext runtime database role');
    }
    await tx.exec('set local role authenticated');
    await assertRowSecurity(tx, ['lkz_vnext', 'lkz_vnext_billing']);
  });
}

const asaasIntegrationRoles = new Set([
  'lkz_vnext_asaas_ingest',
  'lkz_vnext_asaas_issue',
  'lkz_vnext_asaas_reconcile',
]);

// Integration work never inherits provider privileges in a session.
// SET LOCAL ROLE lasts only until this transaction closes.
export function withAsaasRole(db, role) {
  if (!asaasIntegrationRoles.has(role)) throw new Error('Unknown Asaas integration role');
  return {
    transaction: operation => db.transaction(async tx => {
      await tx.exec('set local role ' + role);
      return operation(tx);
    }),
  };
}

export async function assertIntegrationRole(db, expected) {
  if (!asaasIntegrationRoles.has(expected)) throw new Error('Unknown Asaas integration role');
  await db.transaction(async tx => {
    const { rows: [role] } = await tx.query(`
      select session_user as name, rolinherit,
        rolsuper or rolbypassrls or rolcreaterole or rolcreatedb as privileged,
        pg_has_role(session_user, $1::name, 'MEMBER') as permitted,
        pg_has_role(session_user, $1::name, 'USAGE') as inherited,
        (select count(*) from pg_roles r where r.rolname <> $1
          and r.rolname in ('authenticated','lkz_vnext_asaas_ingest','lkz_vnext_asaas_reconcile','lkz_vnext_asaas_issue',
            'lkz_vnext_meta_bridge','lkz_vnext_reminder_bridge',
            'pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files','pg_write_server_files')
          and pg_has_role(session_user,r.oid,'MEMBER')) as other_roles,
        (select count(*) from pg_namespace n where n.nspname in ('lkz_vnext','lkz_vnext_billing')
          and pg_has_role(session_user,n.nspowner,'MEMBER')) as owned_schemas
      from pg_roles where rolname = session_user
    `, [expected]);
    if (role?.name !== expected + '_runtime' || role.rolinherit || !role.permitted
      || role.inherited || role.privileged || Number(role.other_roles)
      || Number(role.owned_schemas)) {
      throw new Error('Invalid VNext integration database role');
    }
    await tx.exec('set local role ' + expected);
    const schemas = expected === 'lkz_vnext_asaas_issue'
      ? ['lkz_vnext', 'lkz_vnext_billing'] : ['lkz_vnext_billing'];
    await assertRowSecurity(tx, schemas);
  });
}

export async function migrateStaging(db) {
  if (managedStagingConnections.has(db)) {
    throw new Error('Managed Supabase staging already uses Supabase migrations; never rerun standalone migrations');
  }
  const directory = new URL('./db/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d{3}-[a-z0-9-]+\.sql$/.test(file)).sort();
  await db.transaction(async tx => {
    await tx.query('select pg_advisory_xact_lock($1)', [6072030]);
    await tx.exec(`
      create schema if not exists lkz_vnext_migrations;
      revoke all on schema lkz_vnext_migrations from public;
      create table if not exists lkz_vnext_migrations.history (
        filename text primary key, sha256 text not null, applied_at timestamptz not null default now()
      );
    `);
    const { rows } = await tx.query('select filename, sha256 from lkz_vnext_migrations.history');
    const prior = new Map(rows.map(row => [row.filename, row.sha256]));
    if (rows.some(row => !files.includes(row.filename))) throw new Error('Database is ahead of the checkout');
    for (const file of files) {
      const source = (await readFile(new URL(file, directory), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(source).digest('hex');
      if (prior.has(file)) {
        if (prior.get(file) !== checksum) throw new Error('Migration checksum mismatch: ' + file);
        continue;
      }
      const statements = source.trim().match(/^begin;\s*([\s\S]+?)\s*commit;$/i)?.[1];
      if (!statements) throw new Error('Expected transactional migration: ' + file);
      await tx.exec(statements);
      await tx.query('insert into lkz_vnext_migrations.history (filename, sha256) values ($1,$2)', [file, checksum]);
    }
  });
}

export async function assertMetaRole(db) {
  await db.transaction(async tx => {
    const { rows: [role] } = await tx.query(
      "select current_user as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, " +
      "pg_has_role(current_user,'lkz_vnext_meta_bridge','MEMBER') as can_meta, " +
      "pg_has_role(current_user,'lkz_vnext_meta_bridge','USAGE') as inherits_meta, " +
      "(select count(*) from pg_roles other where other.rolname in " +
      "('authenticated','lkz_vnext_asaas_ingest','lkz_vnext_asaas_issue','lkz_vnext_asaas_reconcile'," +
      "'pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files','pg_write_server_files') " +
      "and pg_has_role(current_user,other.oid,'MEMBER')) as other_roles, " +
      "(select count(*) from pg_namespace n where n.nspname in ('lkz_vnext','lkz_vnext_billing') " +
      "and pg_has_role(current_user,n.nspowner,'MEMBER')) as owned_schemas " +
      "from pg_roles where rolname=current_user"
    );
    if (role?.name !== 'lkz_vnext_meta_runtime' || role.rolsuper || role.rolbypassrls
      || role.rolcreaterole || role.rolcreatedb || role.rolinherit
      || !role.can_meta || role.inherits_meta
      || Number(role.other_roles) || Number(role.owned_schemas)) {
      throw new Error('Meta connector requires a dedicated least-privilege database identity');
    }
    await tx.exec('set local role lkz_vnext_meta_bridge');
    await assertRowSecurity(tx, ['lkz_vnext']);
  });
}


export async function assertReminderRole(db) {
  await db.transaction(async tx => {
    const { rows: [role] } = await tx.query(
      "select current_user as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, " +
      "pg_has_role(current_user,'lkz_vnext_reminder_bridge','MEMBER') as allowed, " +
      "pg_has_role(current_user,'lkz_vnext_reminder_bridge','USAGE') as inherited, " +
      "(select count(*) from pg_roles r where r.rolname in " +
      "('authenticated','lkz_vnext_meta_bridge','lkz_vnext_asaas_ingest'," +
      "'lkz_vnext_asaas_issue','lkz_vnext_asaas_reconcile','pg_read_all_data'," +
      "'pg_write_all_data','pg_execute_server_program','pg_read_server_files'," +
      "'pg_write_server_files') and pg_has_role(current_user,r.oid,'MEMBER')) as others, " +
      "(select count(*) from pg_namespace n where n.nspname in ('lkz_vnext','lkz_vnext_billing') " +
      "and pg_has_role(current_user,n.nspowner,'MEMBER')) as owned_schemas " +
      "from pg_roles where rolname=current_user"
    );
    if (role?.name !== 'lkz_vnext_reminder_runtime' || role.rolsuper || role.rolbypassrls
      || role.rolcreaterole || role.rolcreatedb || role.rolinherit
      || !role.allowed || role.inherited || Number(role.others)
      || Number(role.owned_schemas)) {
      throw new Error('Reminder service requires a dedicated least-privilege database identity');
    }
    await tx.exec('set local role lkz_vnext_reminder_bridge');
    await assertRowSecurity(tx, ['lkz_vnext']);
  });
}

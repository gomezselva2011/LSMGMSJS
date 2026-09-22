export const ROLE_ADMIN = 'admin'
export const ROLE_VIEWER = 'viewer'
export const ROLE_USER = 'usuario'

/** Dummy local-only passwords. Never use on a public URL. Prefer GASTOS_ADMIN_PASSWORD. */
export const DEV_DUMMY_ADMIN_PASSWORD = 'dev-only-local-mgomez'
/** Dummy local-only password for the second admin. Prefer GASTOS_ADMIN2_PASSWORD. */
export const DEV_DUMMY_ADMIN2_PASSWORD = 'dev-only-local-lsotelon'

export const SEED_ADMIN_USERNAME = 'mgomez'
export const SEED_ADMIN_2_USERNAME = 'lsotelon'

function readSeedPassword(env, name, dummy) {
  const value = env?.[name]
  if (value != null && String(value).length > 0) return String(value)
  return dummy
}

export function getHouseholdSeeds(env = process.env) {
  return [
    {
      name: 'Melissa',
      username: SEED_ADMIN_USERNAME,
      password: readSeedPassword(env, 'GASTOS_ADMIN_PASSWORD', DEV_DUMMY_ADMIN_PASSWORD),
      role: ROLE_ADMIN,
    },
    {
      name: 'Lenin',
      username: SEED_ADMIN_2_USERNAME,
      password: readSeedPassword(env, 'GASTOS_ADMIN2_PASSWORD', DEV_DUMMY_ADMIN2_PASSWORD),
      role: ROLE_ADMIN,
    },
  ]
}

export const SEED_ADMIN = getHouseholdSeeds()[0]
export const SEED_ADMIN_2 = getHouseholdSeeds()[1]
export const HOUSEHOLD_SEEDS = getHouseholdSeeds()
export const PLACEHOLDER_USERNAMES = new Set(['melissa', 'lenin'])

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Readable, PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  COOKIE_NAME,
  MAX_USERS,
  SEED_ADMIN,
  SEED_ADMIN_2,
  createAuthStore,
  handleAuthRequest,
  hashPassword,
  verifyPassword,
} from './auth.js'
import { closeGastosDb, listUsers, openGastosDb, readHouseholdState } from './db.js'
import { handleGastosApi } from './gastos-api.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    setHeader(key, value) {
      if (key === 'Set-Cookie') {
        this.headers[key] = this.headers[key] ? [].concat(this.headers[key], value) : value
        return
      }
      this.headers[key] = value
    },
    writeHead(status, headers = {}) {
      this.statusCode = status
      Object.assign(this.headers, headers)
    },
    end(value = '') {
      this.body = String(value)
      this.ended = true
    },
    pipeFrom() {},
  }
}

function jsonReq(method, url, body, cookie) {
  const req = Readable.from([Buffer.from(body == null ? '' : JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (cookie) req.headers.cookie = cookie
  return req
}

function getReq(url, cookie, accept = 'application/json') {
  return {
    method: 'GET',
    url,
    headers: { accept, cookie: cookie || '' },
  }
}

describe('password hashing', () => {
  it('hashes with scrypt and never stores the plaintext', async () => {
    const secret = 'not-a-stored-password'
    const stored = await hashPassword(secret)
    assert.match(stored, /^scrypt:[0-9a-f]+:[0-9a-f]+$/)
    assert.equal(stored.includes(secret), false)
    assert.equal(await verifyPassword(secret, stored), true)
    assert.equal(await verifyPassword('wrong', stored), false)
  })
})

describe('auth store and HTTP', () => {
  let dir
  let store
  let markPath

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-auth-'))
    markPath = path.join(dir, 'public', 'lm-mark.jpg')
    await fs.mkdir(path.dirname(markPath), { recursive: true })
    await fs.writeFile(markPath, Buffer.from('fake-lm-mark'))
    store = createAuthStore({ root: dir, markPath })
    await store.ensureSeeded()
  })

  afterEach(async () => {
    closeGastosDb(store.dbPath)
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function loginAs(seed) {
    const res = mockRes()
    await handleAuthRequest(
      jsonReq('POST', '/api/auth/login', { username: seed.username, password: seed.password }),
      res,
      () => {},
      store,
    )
    const setCookie = String(res.headers['Set-Cookie'] || '')
    const match = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
    return { res, cookie: match ? `${COOKIE_NAME}=${match[1]}` : '' }
  }

  it('seeds mgomez and lsotelon as admins in sqlite when none exist', async () => {
    const users = store.listUsers()
    assert.equal(users.length, 2)
    assert.equal(users[0].username, 'mgomez')
    assert.equal(users[0].name, 'Melissa')
    assert.equal(users[0].role, 'admin')
    assert.equal(users[0].canEdit, true)
    assert.equal(users[1].username, 'lsotelon')
    assert.equal(users[1].name, 'Lenin')
    assert.equal(users[1].role, 'admin')
    assert.equal(users[1].canEdit, true)
    const rows = listUsers(openGastosDb({ dbPath: store.dbPath }))
    for (const user of rows) {
      assert.equal('password' in user, false)
      assert.match(user.passwordHash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/)
      assert.equal(JSON.stringify(user).includes(SEED_ADMIN.password), false)
      assert.equal(JSON.stringify(user).includes(SEED_ADMIN_2.password), false)
    }
  })

  it('replaces placeholder melissa/lenin accounts with the household logins', async () => {
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-auth-migrate-'))
    const dbPath = path.join(fresh, 'data', 'gastos.sqlite')
    try {
      const mark = path.join(fresh, 'public', 'lm-mark.jpg')
      await fs.mkdir(path.dirname(mark), { recursive: true })
      await fs.writeFile(mark, Buffer.from('fake-lm-mark'))
      await fs.mkdir(path.join(fresh, 'data'), { recursive: true })
      await fs.writeFile(
        path.join(fresh, 'data', 'users.json'),
        JSON.stringify({
          users: [
            {
              id: 'usr_old_admin',
              name: 'Melissa',
              username: 'melissa',
              role: 'admin',
              passwordHash: 'scrypt:00:00',
              photo: null,
            },
            {
              id: 'usr_old_viewer',
              name: 'Lenin',
              username: 'lenin',
              role: 'usuario',
              passwordHash: 'scrypt:00:00',
              photo: null,
            },
          ],
        }),
      )
      const other = createAuthStore({ root: fresh, markPath: mark })
      await other.ensureSeeded()
      const users = other.listUsers()
      assert.equal(users.length, 2)
      assert.deepEqual(
        users.map((user) => user.username).sort(),
        ['lsotelon', 'mgomez'],
      )
      assert.equal(
        users.every((user) => user.role === 'admin'),
        true,
      )
    } finally {
      closeGastosDb(dbPath)
      await fs.rm(fresh, { recursive: true, force: true })
    }
  })

  it('logs in both household admins and sets an HttpOnly session cookie', async () => {
    for (const seed of [SEED_ADMIN, SEED_ADMIN_2]) {
      const { res } = await loginAs(seed)
      assert.equal(res.statusCode, 200)
      const body = JSON.parse(res.body)
      assert.equal(body.user.username, seed.username)
      assert.equal(body.user.role, 'admin')
      const cookie = String(res.headers['Set-Cookie'] || '')
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /SameSite=Lax/)
      assert.equal(cookie.includes(seed.password), false)
    }
  })

  it('keeps the session in sqlite after a store reload', async () => {
    const { cookie } = await loginAs(SEED_ADMIN)
    const reloaded = createAuthStore({ root: dir, markPath, dbPath: store.dbPath })
    await reloaded.load()
    const meRes = mockRes()
    await handleAuthRequest(getReq('/api/auth/me', cookie), meRes, () => {}, reloaded)
    assert.equal(meRes.statusCode, 200)
    assert.equal(JSON.parse(meRes.body).user.username, 'mgomez')
  })

  it('rejects a bad password', async () => {
    const res = mockRes()
    await handleAuthRequest(
      jsonReq('POST', '/api/auth/login', { username: 'mgomez', password: 'nope' }),
      res,
      () => {},
      store,
    )
    assert.equal(res.statusCode, 401)
  })

  it('redirects anonymous HTML to /login', async () => {
    const res = mockRes()
    const handled = await handleAuthRequest(getReq('/', '', 'text/html'), res, () => {}, store)
    assert.equal(handled, true)
    assert.equal(res.statusCode, 302)
    assert.equal(res.headers.Location, '/login')
  })

  it('lets an admin create a third profile and then hits the cap', async () => {
    const { cookie } = await loginAs(SEED_ADMIN)
    const created = mockRes()
    await handleAuthRequest(
      jsonReq(
        'POST',
        '/api/users',
        { name: 'Invitada', username: 'invitada', password: 'secreto1', role: 'usuario' },
        cookie,
      ),
      created,
      () => {},
      store,
    )
    assert.equal(created.statusCode, 201)
    assert.equal(JSON.parse(created.body).user.username, 'invitada')
    assert.equal(JSON.parse(created.body).user.role, 'viewer')
    assert.equal(store.userCount(), MAX_USERS)

    const blocked = mockRes()
    await handleAuthRequest(
      jsonReq(
        'POST',
        '/api/users',
        { name: 'Cuarta', username: 'cuarta', password: 'secreto1', role: 'usuario' },
        cookie,
      ),
      blocked,
      () => {},
      store,
    )
    assert.equal(blocked.statusCode, 409)
  })

  it('forbids a viewer from creating profiles or writing gastos', async () => {
    const { cookie: adminCookie } = await loginAs(SEED_ADMIN)
    const created = mockRes()
    await handleAuthRequest(
      jsonReq(
        'POST',
        '/api/users',
        { name: 'Invitada', username: 'invitada', password: 'secreto1', role: 'viewer' },
        adminCookie,
      ),
      created,
      () => {},
      store,
    )
    assert.equal(created.statusCode, 201)

    const { cookie } = await loginAs({ username: 'invitada', password: 'secreto1' })
    const createRes = mockRes()
    await handleAuthRequest(
      jsonReq(
        'POST',
        '/api/users',
        { name: 'Otra', username: 'otra', password: 'secreto1', role: 'usuario' },
        cookie,
      ),
      createRes,
      () => {},
      store,
    )
    assert.equal(createRes.statusCode, 403)

    const writeRes = mockRes()
    let forwarded = false
    await handleAuthRequest(
      jsonReq('PUT', '/api/gastos', { months: {} }, cookie),
      writeRes,
      () => {
        forwarded = true
      },
      store,
    )
    assert.equal(writeRes.statusCode, 403)
    assert.equal(forwarded, false)
  })

  it('lets an admin PUT /api/gastos through to sqlite', async () => {
    const { cookie } = await loginAs(SEED_ADMIN)
    const dbPath = store.dbPath
    const payload = { version: 1, currentMonth: '2026-10', months: { '2026-10': { expenses: [] } } }
    const req = jsonReq('PUT', '/api/gastos', payload, cookie)
    const res = mockRes()
    const forwarded = await handleAuthRequest(
      req,
      res,
      async () => {
        await handleGastosApi(req, res, () => {}, { dbPath })
      },
      store,
    )
    assert.equal(forwarded, false)
    assert.equal(res.statusCode, 200)
    const onDisk = readHouseholdState(openGastosDb({ dbPath }))
    assert.equal(onDisk.currentMonth, '2026-10')
  })

  it('lets lsotelon write gastos as a second admin', async () => {
    const { cookie } = await loginAs(SEED_ADMIN_2)
    const dbPath = store.dbPath
    const payload = { version: 1, currentMonth: '2026-10', months: { '2026-10': { expenses: [] } } }
    const req = jsonReq('PUT', '/api/gastos', payload, cookie)
    const res = mockRes()
    await handleAuthRequest(
      req,
      res,
      async () => {
        await handleGastosApi(req, res, () => {}, { dbPath })
      },
      store,
    )
    assert.equal(res.statusCode, 200)
  })

  it('serves the L&M mark as the default profile photo', async () => {
    const { cookie } = await loginAs(SEED_ADMIN)
    const meRes = mockRes()
    await handleAuthRequest(getReq('/api/auth/me', cookie), meRes, () => {}, store)
    const id = JSON.parse(meRes.body).user.id
    const chunks = []
    const res = new PassThrough()
    res.headers = {}
    res.statusCode = 0
    res.setHeader = function setHeader(key, value) {
      this.headers[key] = value
    }
    res.writeHead = function writeHead(status, headers = {}) {
      this.statusCode = status
      Object.assign(this.headers, headers)
    }
    res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    const done = new Promise((resolve) => res.on('end', resolve))
    await handleAuthRequest(getReq(`/api/users/${id}/photo`, cookie), res, () => {}, store)
    await done
    assert.equal(res.headers['Content-Type'], 'image/jpeg')
    assert.equal(Buffer.concat(chunks).toString(), 'fake-lm-mark')
  })
})

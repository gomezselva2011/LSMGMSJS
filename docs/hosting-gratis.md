# Hosting permanente de Gastos del hogar

Este runbook es para Melissa. El túnel actual (`https://highs-voting-finance-preferred.trycloudflare.com`) solo vive mientras la máquina Cloud Agent esté encendida. El presupuesto está en SQLite (`data/gastos.sqlite`), un archivo que **no está en git**. Si esa VM se borra, se pierde la base salvo que la hayas copiado a un disco persistente.

No hay una URL `https://gastos-hogar.onrender.com` hasta que *tú* crees el servicio en Render y el deploy termine. El patrón, cuando exista, es `https://NOMBRE.onrender.com`.

---

## 1. Hechos (2026): Render Free no guarda SQLite

Documentación de Render ([Deploy for Free](https://render.com/docs/free), [Persistent Disks](https://render.com/docs/disks), [Pricing](https://render.com/pricing)):

| Cosa | Free (Web Service) | Starter (pago) + disco |
| --- | --- | --- |
| Precio del compute | 0 USD | ~7 USD/mes (prorrateado) |
| Tarjeta para crear la cuenta | **No** hace falta para el plan Hobby / Free | **Sí**, para un Web Service de pago y para el disco |
| Disco persistente | **No existe.** Render lo dice: *Paid services can preserve local filesystem changes by attaching a persistent disk, but Free web services cannot.* | Sí. ~0,25 USD/GB/mes (1 GB ≈ 0,25 USD) |
| SQLite en el contenedor | Se borra en cada redeploy, restart o spin-down | Solo sobrevive lo que esté **bajo el mount** del disco |
| Spin-down | A los 15 min sin tráfico; el arranque tarda ~1 min | No se duerme |
| Horas | 750 h Free por workspace y mes; al gastarse, se suspende hasta el mes siguiente | 24/7 |
| Shell SSH en el dashboard | No | Sí (hace falta para subir el `.sqlite` a mano) |
| Postgres Free | Caduca a los 30 días; no es SQLite | No lo usamos |

**Conclusión:** no se puede tener “Render Free + archivo SQLite permanente”. Quien elija Free verá la app, pero cada vez que Render apague o redespliegue el servicio la base vuelve a nacer vacía (usuarios semilla otra vez, presupuesto perdido).

El `render.yaml` de este repo está pensado para **Starter + disco de 1 GB montado en `/var/data`**, con `GASTOS_DATA_DIR=/var/data`. Ahí es donde debe vivir `gastos.sqlite`. El código de la app (`/opt/render/project/src`) sigue siendo efímero; no dejes la base solo en `data/` del checkout.

---

## 2. Alternativas si no quieres pagar ~7 USD

Ningún PaaS “de un clic” para Node (cuentas nuevas, 2026) da **disco persistente de verdad a coste 0**:

- **Fly.io:** el Hobby gratis ya no existe para cuentas nuevas. Prueba = 2 h de máquina o 7 días. Los volúmenes se cobran (~0,15 USD/GB/mes) y hay que poner tarjeta para seguir.
- **Koyeb:** el instance Free **no puede** montar Volumes. Los volúmenes (preview) piden instance Standard de pago.
- **Neon / Render Postgres:** persistiría datos, pero habría que **migrar de SQLite a Postgres**. No es el camino corto.
- **Turso / libSQL (gratis, sin tarjeta, ~5 GB):** la base sí es persistente, pero el servidor usa hoy `node:sqlite` (archivo local). Pasar a Turso implica cambiar el cliente SQL. Es la mejor opción *gratis para los datos* si más adelante se reescribe esa capa. **No está hecha en este repo.**
- **Cloudflare D1:** gratis para datos; obliga a Workers, no a este proceso Node + Vite.

**Recomendación (cambio mínimo, mismo archivo SQLite):** Render Starter + disco 1 GB. Coste aproximado **7,25 USD/mes**. Tarjeta sí.

Si solo quieres *probar* Render a 0 USD: Web Service Free, **sin disco**, sabiendo que SQLite se pierde. No subas el presupuesto real ahí.

---

## 3. GitHub: este repo de Cursor no le sirve a Render

Render despliega desde **GitHub, GitLab o Bitbucket**. El remoto de la máquina del agente es Origin (`origin.cursor.com`, repo temporal tipo `agent_temp`). **Render no puede conectar eso.**

Tú tienes que:

1. En Cursor, **Create repo** (crear el repositorio en tu GitHub).
2. Empujar esta rama o `main` a ese GitHub.
3. Recién entonces Render puede ver el código (`render.yaml`, `package.json`, etc.).

Si GitHub ya está conectado y el código está ahí, sáltate Create repo. Si no, **hazlo antes de abrir Render**.

Rama de trabajo en el agente: `cursor/gastos-hogar-05fc`. En GitHub puedes usar esa rama o fusionar a `main` y desplegar `main`.

---

## 4. Qué hace el código en producción

- `npm run build` genera `dist/`.
- `npm start` lanza **Vite preview** (no un static site): mismos plugins de API (`server/auth.js`, `server/gastos-api.js`) + estáticos. Escucha `0.0.0.0` y `process.env.PORT`.
- SQLite: `GASTOS_DATA_DIR/gastos.sqlite` si esa variable existe; si no, `data/gastos.sqlite` relativo al proceso.
- En `NODE_ENV=production` hace falta `SESSION_SECRET`. Al **crear** una base vacía también `GASTOS_ADMIN_PASSWORD` (Melissa / `mgomez`) y `GASTOS_ADMIN2_PASSWORD` (Lenin / `lsotelon`). Si el sqlite ya tiene esos usuarios, el arranque **no cambia** las claves.
- Cookie `gastos_session`: HttpOnly, SameSite=Lax, y **Secure** cuando la petición va por HTTPS (`x-forwarded-proto`, como en Render).

En esta VM de desarrollo **no toques** Vite `0.0.0.0:4731` ni el túnel; siguen para Chrome en el portátil.

---

## 5. Paso a paso en Render (con disco: lo que sí persiste)

### 5.1 Cuenta

1. Entra a [https://dashboard.render.com/register](https://dashboard.render.com/register).
2. Lo más simple: “Sign up with GitHub”.
3. **Free / Hobby:** no pide tarjeta. **Starter + disco:** Render pedirá método de pago antes de crear el servicio de pago.

### 5.2 Conectar GitHub

1. Dashboard → **Account Settings** → *Git Deployment Credentials* → autoriza GitHub si no lo hiciste al registrarte.
2. Elige el repo que creaste en Cursor (paso 3). No el URL de `origin.cursor.com`.

### 5.3 Crear el Web Service (Blueprint o a mano)

**Opción A — Blueprint (recomendado)**

1. Dashboard → **New** → **Blueprint**.
2. Repo de GitHub → rama (`main` o `cursor/gastos-hogar-05fc`) → archivo `render.yaml` en la raíz.
3. Render va a crear un Web Service `gastos-hogar`, plan **starter**, disco `gastos-sqlite` en `/var/data` (1 GB).
4. Te pedirá los secretos marcados `sync: false`:
   - `GASTOS_ADMIN_PASSWORD`
   - `GASTOS_ADMIN2_PASSWORD`
   - `SESSION_SECRET` puede autogenerarse; si el Blueprint lo genera, no lo inventes a mano.
5. Aplica el Blueprint. El primer deploy **no** incluye tu sqlite de esta VM: el disco empieza vacío.

**Opción B — A mano (si no usas Blueprint)**

1. **New** → **Web Service** → el repo.
2. Runtime: **Node**. Build: `npm ci && npm run build`. Start: `npm start`.
3. Instance: **Starter** (no Free).
4. **Disk** → Add disk:
   - Name: `gastos-sqlite`
   - Mount path: **`/var/data`** (tiene que ser exactamente donde apunta `GASTOS_DATA_DIR`)
   - Size: 1 GB
5. Environment:
   - `NODE_ENV=production`
   - `NODE_VERSION=22`
   - `GASTOS_DATA_DIR=/var/data`
   - `SESSION_SECRET` = una cadena larga aleatoria (no la contraseña de login)
   - `GASTOS_ADMIN_PASSWORD` = la de Melissa
   - `GASTOS_ADMIN2_PASSWORD` = la de Lenin
6. Deploy.

Si montaras el disco en `/opt/render/project/src/data` en vez de `/var/data`, el sqlite caería en el `data/` del checkout y podrías omitir `GASTOS_DATA_DIR`. Este repo usa **`/var/data` + `GASTOS_DATA_DIR`** para no mezclar el código con el disco. **No montes en `/opt/render/project/src` entero** (Render lo prohíbe); un subdirectorio sí se puede, pero entonces cambia el env para que coincida.

### 5.4 URL estable

Cuando el deploy ponga “Live”, Render muestra la URL. El patrón es:

`https://<nombre-del-servicio>.onrender.com`

Si el servicio se llama `gastos-hogar` y el nombre está libre, será `https://gastos-hogar.onrender.com`. Si está ocupado, Render añade un sufijo. **Copia la URL real del dashboard**; no asumas el nombre.

Custom domain (opcional): en el servicio → Custom Domains. En Hobby hay un cupo limitado de dominios.

Abre `/login` (no hace falta poner `index.html`). La primera visita a un Starter no debería dormir; si en algún momento usaste Free, espera ~1 min al despertar.

---

## 6. Exportar el SQLite de esta máquina y subirlo al disco

**No subas `gastos.sqlite` a git.** Tiene el presupuesto del hogar y hashes de contraseña.

### 6.1 En la máquina donde corre Vite (o en tu PC si copiaste el archivo)

```bash
npm run export-sqlite
```

Crea `exports/gastos-FECHA/` con `gastos.sqlite` (copia consistente; no mata Vite). El directorio `exports/` está en `.gitignore`.

También puedes:

```bash
bash scripts/export-sqlite.sh /tmp/gastos-hogar-export
```

### 6.2 Subirlo a Render (disco ya montado)

El disco **no está disponible en el build**, solo en runtime. Tampoco en un job one-off. Hay que copiar con el servicio ya levantado.

1. Dashboard del Web Service → **Shell** (solo planes de pago).
2. Comprueba el disco:

   ```bash
   echo "$GASTOS_DATA_DIR"
   ls -la /var/data
   ```

3. Sube el archivo. Render no te da `scp` desde casa de forma directa. Caminos prácticos:

   **A. Desde el PC (con el sqlite en la mano)**  
   Súbelo a un sitio privado temporal (Drive, un gist **privado** no es ideal; mejor un objeto de un rato) y en el Shell:

   ```bash
   curl -L -o /var/data/gastos.sqlite "URL_PRIVADA_DEL_ARCHIVO"
   ls -la /var/data/gastos.sqlite
   ```

   Luego borra esa URL. Reinicia el servicio (Manual Deploy → Restart) para que Node abra el archivo nuevo.

   **B. Pegar por Base64** (archivo chico, ~100 KB–pocos MB) desde tu terminal local:

   ```bash
   base64 exports/gastos-FECHA/gastos.sqlite | wc -c
   ```

   En el Shell de Render:

   ```bash
   base64 -d > /var/data/gastos.sqlite
   # pega el texto, Ctrl-D
   ```

   **C. Si el disco está vacío y aceptas re-sembrar usuarios**  
   Entra con las contraseñas de las variables de entorno y usa **Descargar copia / Restaurar desde archivo** en la app (JSON del mes, no el sqlite completo). Los meses que no descargues no viajan. Para el historial entero, usa el `.sqlite`.

4. Permisos: el archivo debe ser escribible por el proceso Node. Si el Shell lo creó como root y Node no puede escribir, `chmod 664 /var/data/gastos.sqlite` (o el dueño que use Render).

5. Avatares: si exportaste `avatars/`, cópialos a `/var/data/avatars/`.

**No pongas la base solo en `/opt/render/project/src/data`** sin disco: el siguiente deploy la borra.

### 6.3 Si subes el sqlite *después* del primer arranque

El primer boot con disco vacío crea usuarios semilla con las env vars. Si luego sustituyes el archivo por el de esta VM, mandan **los usuarios de esa copia** (hashes de aquí), no las env. Las env **no pisan** una base que ya tiene `mgomez` / `lsotelon`.

---

## 7. Si insistes en Render Free (demo, datos desechables)

1. Misma cuenta, **sin tarjeta**.
2. Web Service → instance **Free**. **No** añadas disco (la UI no te deja).
3. Mismas build/start/env **excepto** `GASTOS_DATA_DIR` (o déjala vacía: usará `data/` efímero).
4. A los 15 min sin visitas se duerme. 750 h/mes.
5. Cada sleep/restart/deploy **borra SQLite**. No lo uses para el presupuesto real.

El Blueprint del repo **no** usa Free a propósito: un `disk:` en `render.yaml` exige plan de pago.

---

## 8. Comprobar que persistió

1. Entra, guarda un gasto de prueba, cierra sesión.
2. En Render: **Manual Deploy** → Restart (no hace falta Rebuild).
3. Vuelve a `/login` y mira si el gasto sigue.
4. Si desapareció, el sqlite no está en el mount (`/var/data`) o el servicio es Free.

---

## 9. Checklist rápido

- [ ] Create repo en GitHub y push (si Render no ve el código).
- [ ] Cuenta Render; tarjeta **solo** si vas a Starter + disco.
- [ ] Web Service Node, **no** Static Site.
- [ ] Disco montado en `/var/data` y `GASTOS_DATA_DIR=/var/data`.
- [ ] `SESSION_SECRET`, `GASTOS_ADMIN_PASSWORD`, `GASTOS_ADMIN2_PASSWORD` en el dashboard, nunca en git.
- [ ] `npm run export-sqlite` y copia al disco; no commits del `.sqlite`.
- [ ] URL copiada del dashboard (`https://….onrender.com`).
- [ ] Restart de prueba: los datos siguen.

Fuentes: [render.com/docs/free](https://render.com/docs/free), [render.com/docs/disks](https://render.com/docs/disks), [render.com/pricing](https://render.com/pricing), [fly.io/docs/about/free-trial](https://fly.io/docs/about/free-trial/), [turso.tech/pricing](https://turso.tech/pricing).

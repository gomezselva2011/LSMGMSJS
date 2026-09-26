# Hosting permanente de Gastos del hogar

## Sacar la app de la VM del agente

Melissa: **esta computadora (Cloud Agent VM) no sirve como casa permanente.** El disco es efímero. Si el agente se apaga o se borra, se acaba el túnel y se pierde `data/gastos.sqlite` (ese archivo no está en git).

Hay que dejar **la app y los datos en la nube**, no en tu PC (tú no vas a hospedar en casa) y no en el agente.

**Render no es la computadora del agente.** Son máquinas distintas. El agente es el entorno de Cursor. Render es un PaaS donde corre `npm start`. Turso es otra nube otra vez: ahí vive el SQLite remoto (libSQL).

No uses trycloudflare como hosting permanente. El túnel actual (`https://highs-voting-finance-preferred.trycloudflare.com`) solo vive mientras el agente esté encendido. **No abras otro túnel.**

No hay una URL `https://gastos-hogar.onrender.com` hasta que *tú* crees el servicio en Render y el deploy termine. El patrón, cuando exista, es `https://NOMBRE.onrender.com`. Copia la URL real del dashboard.

### Tres caminos

| Camino | Coste | Dónde viven los datos | Dónde corre Node | Tarjeta |
| --- | --- | --- | --- | --- |
| **A. Turso + Render Free** (recomendado, gratis) | 0 USD | Turso (libSQL, ~5 GB, persiste) | Render Free (disco **efímero**, da igual) | **No** (Turso Free y Render Hobby/Free) |
| **B. Render Starter + disco 1 GB** | ~7,25 USD/mes | Archivo `gastos.sqlite` en `/var/data` | Render Starter 24/7 | **Sí** |
| **C. Oracle Cloud Always Free** (VM propia) | 0 USD de compute Always Free | Disco / block volume en la VM (el stack actual, sin Turso) | Tu VM Ampere o AMD | **Sí, de verificación** (Oracle no cobra si no actualizas a pago; ver §6) |

**Recomendación:** camino A. El código ya habla con Turso si existen `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. En el portátil / `npm run dev` sin esas variables sigue usando `node:sqlite` en `data/gastos.sqlite`.

---

## 0. GitHub (repo ya creado)

Repo: **https://github.com/melissa2021hmr/LSMGMSJS**

Render despliega desde GitHub. El agente de Cursor empuja a Origin (`origin.cursor.com`); **esta VM no tiene credenciales de GitHub**, así que el push a `LSMGMSJS` hay que hacerlo desde tu cuenta.

Rama de trabajo en el agente: `cursor/gastos-hogar-05fc`. En GitHub queremos **`main`** (rama por defecto de Render).

### Empujar el código (en tu PC o en Cursor, con tu login de GitHub)

Si ya estás en el proyecto Gastos en Cursor:

```bash
git remote add github https://github.com/melissa2021hmr/LSMGMSJS.git
git push -u github cursor/gastos-hogar-05fc:main
```

Desde GitHub CLI (en tu máquina, no en el agente):

```bash
gh auth login
cd /ruta/del/proyecto-gastos
git push -u https://github.com/melissa2021hmr/LSMGMSJS.git cursor/gastos-hogar-05fc:main
```

En Render, conecta **melissa2021hmr/LSMGMSJS**, rama **`main`**. Archivos que deben verse: `package.json`, `render.yaml`, `render-free-turso.yaml`, `server/`, `docs/hosting-gratis.md`.

No subas `.env` ni `data/gastos.sqlite`.

---

## 1. Camino A — Turso + Render Free (pasos de Melissa)

Turso Free (docs 2026, [turso.tech/pricing](https://turso.tech/pricing)): 0 USD, **sin tarjeta**, 100 bases, 5 GB, 500 M lecturas / 10 M escrituras al mes. Si te pasas en el plan Free, la base se bloquea; no hay cargo sorpresa.

Render Free: 0 USD, **sin tarjeta** para Hobby/Free. Se duerme a los 15 min sin tráfico (~1 min al despertar). 750 h/mes. El disco del contenedor **se borra** en cada sleep/restart/deploy; por eso el presupuesto tiene que estar en Turso, no en un archivo.

### 1.1 Cuenta y base en Turso

1. Entra a [https://turso.tech](https://turso.tech) → Sign up (GitHub es lo más simple). Plan **Free**.
2. Crea una base, por ejemplo `gastos-hogar` (el nombre da igual).
3. Copia la URL de la base. Empieza por `libsql://…` (a veces también te dan `https://…`). Eso es `TURSO_DATABASE_URL`.
4. Crea un token de esa base (dashboard → tokens / “Create token”). Eso es `TURSO_AUTH_TOKEN`. Trátalo como una contraseña: **no lo pongas en git, no lo pegues en el chat**.

Equivalente con la CLI (opcional, si la instalas en tu PC o en otra máquina, no hace falta):

```bash
turso auth login
turso db create gastos-hogar
turso db show gastos-hogar --url
turso db tokens create gastos-hogar
```

No hay URL pública de Turso que debas abrir en el navegador para usar la app. Turso solo habla con el proceso Node en Render.

### 1.2 Web Service Free en Render

1. [https://dashboard.render.com/register](https://dashboard.render.com/register) — “Sign up with GitHub”. **No** pidas plan de pago.
2. Account Settings → autoriza GitHub si hace falta.
3. **New** → **Web Service** → el repo de GitHub del paso 0 (no `origin.cursor.com`).
4. Rama: `main` o `cursor/gastos-hogar-05fc`.
5. Runtime: **Node**. Build: `npm ci && npm run build`. Start: `npm start`.
6. Instance: **Free**. **No** añadas disco.
7. Environment:

   | Variable | Valor |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `SESSION_SECRET` | una cadena larga aleatoria (no es la clave de login; Render puede generarla) |
   | `GASTOS_ADMIN_PASSWORD` | la de Melissa (`mgomez`) |
   | `GASTOS_ADMIN2_PASSWORD` | la de Lenin (`lsotelon`) |
   | `TURSO_DATABASE_URL` | la URL `libsql://…` |
   | `TURSO_AUTH_TOKEN` | el token |

   No hace falta `GASTOS_DATA_DIR`. El presupuesto va a Turso. Las fotos de perfil, si las subes, viven en el disco efímero de Render y **pueden desaparecer** al dormirse el Free; la marca L&M sigue saliendo.

8. Deploy. Espera a “Live”. Copia `https://….onrender.com` del dashboard. Abre `/login`.

**Opción Blueprint:** New → Blueprint → archivo `render-free-turso.yaml` (plan `free`, sin disco, mismas env). Te pedirá los secretos `sync: false`. El Blueprint `render.yaml` de la raíz es el camino **B** (Starter + disco); no lo uses si quieres Free.

El primer arranque con Turso vacío crea `mgomez` y `lsotelon` con las contraseñas de las env. Si la base ya tiene esos usuarios, **no las cambia**.

### 1.3 Pasar el presupuesto que hoy está en el agente

El sqlite de esta VM **no viaja solo**. Después del primer login en Render:

1. En la app actual (túnel del agente), entra como admin → pie → **Descargar copia** (JSON del mes / estado).
2. En `https://….onrender.com`, entra con las contraseñas de las env → **Restaurar desde archivo**.
3. Repite por cada mes que te importe. Lo que no descargues no viaja.

Los hashes de contraseña del sqlite del agente no se copian en ese JSON. Mandan las env de Render. Si más adelante importas un dump SQL completo a Turso, entonces mandan los hashes de esa copia, no las env.

### 1.4 Comprobar que persistió (Turso, no el disco de Render)

1. Guarda un gasto de prueba, cierra sesión.
2. En Render: **Manual Deploy** → Restart (o espera a que se duerma y vuelve a entrar).
3. El gasto y el login tienen que seguir. Si volviste a usuarios semilla vacíos, `TURSO_*` no está bien puesto o el servicio está hablando con sqlite efímero.

---

## 2. Hechos (2026): Render Free no guarda un archivo SQLite

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

**Conclusión:** no se puede tener “Render Free + archivo SQLite permanente”. Eso ya no es un problema si el estado está en Turso (camino A). Quien elija Free **sin** Turso verá la app, pero cada vez que Render apague el servicio la base local vuelve a nacer vacía.

El `render.yaml` de este repo está pensado para **Starter + disco de 1 GB montado en `/var/data`**, con `GASTOS_DATA_DIR=/var/data` (camino B). El código de la app (`/opt/render/project/src`) sigue siendo efímero; no dejes la base solo en `data/` del checkout.

---

## 3. Camino B — Render Starter + disco (mismo archivo SQLite)

Úsalo si prefieres no crear cuenta en Turso y pagar ~7 USD. **Sí hace falta tarjeta.**

### 3.1 Cuenta y Blueprint

1. Misma cuenta Render; ahora sí te pedirá método de pago para Starter + disco.
2. New → **Blueprint** → repo de GitHub → rama → archivo `render.yaml` en la raíz.
3. Crea un Web Service `gastos-hogar`, plan **starter**, disco `gastos-sqlite` en `/var/data` (1 GB).
4. Secretos `sync: false`: `GASTOS_ADMIN_PASSWORD`, `GASTOS_ADMIN2_PASSWORD`. `SESSION_SECRET` puede autogenerarse.
5. **No** pongas `TURSO_DATABASE_URL` en este camino: si está, gana Turso y el disco no guarda el presupuesto.

A mano: Web Service Node, instance **Starter**, Disk mount **`/var/data`**, `GASTOS_DATA_DIR=/var/data`, mismas build/start. **No montes en `/opt/render/project/src` entero.**

### 3.2 URL estable

Cuando el deploy ponga “Live”, Render muestra la URL: `https://<nombre-del-servicio>.onrender.com`. Si el nombre está ocupado, Render añade un sufijo. **Copia la URL real.** Custom domain es opcional.

### 3.3 Exportar el SQLite del agente y subirlo al disco

**No subas `gastos.sqlite` a git.**

```bash
npm run export-sqlite
```

Crea `exports/gastos-FECHA/` (está en `.gitignore`). El disco **no está en el build**, solo en runtime. Dashboard del Web Service → **Shell** (solo planes de pago):

```bash
echo "$GASTOS_DATA_DIR"
ls -la /var/data
```

Copia el archivo al mount (`curl` a una URL privada temporal, o base64 si es chico). Reinicia el servicio. Avatares: `/var/data/avatars/`.

El primer boot con disco vacío crea usuarios semilla con las env. Si luego sustituyes el archivo por el de esta VM, mandan **los usuarios de esa copia**.

### 3.4 Comprobar disco

Guarda un gasto → Restart en Render → el gasto sigue. Si desapareció, el sqlite no está en `/var/data` o el servicio es Free.

---

## 4. Si insistes en Render Free *sin* Turso (demo, datos desechables)

Misma cuenta, **sin tarjeta**. Instance **Free**. **No** disco. Sin `TURSO_*`. Cada sleep/restart/deploy **borra SQLite**. No lo uses para el presupuesto real.

---

## 5. Qué hace el código

- `npm run build` genera `dist/`.
- `npm start` lanza **Vite preview** (no un static site): mismos plugins de API (`server/auth.js`, `server/gastos-api.js`) + estáticos. Escucha `0.0.0.0` y `process.env.PORT`.
- Si existe `TURSO_DATABASE_URL` (y `TURSO_AUTH_TOKEN` en remoto): `@libsql/client` contra Turso. Mismo esquema (`months`, `expenses`, `charges`, `details`, `users`, `sessions`, …).
- Si no: `node:sqlite` en `GASTOS_DATA_DIR/gastos.sqlite` o `data/gastos.sqlite`. Así sigue `npm run dev` en el agente (Vite **4731**).
- En `NODE_ENV=production` hace falta `SESSION_SECRET`. Al **crear** una base vacía también `GASTOS_ADMIN_PASSWORD` (Melissa / `mgomez`) y `GASTOS_ADMIN2_PASSWORD` (Lenin / `lsotelon`).
- Cookie `gastos_session`: HttpOnly, SameSite=Lax, y **Secure** cuando la petición va por HTTPS (`x-forwarded-proto`, como en Render).

En esta VM de desarrollo **no toques** Vite `0.0.0.0:4731` ni el túnel; siguen para Chrome en el portátil.

---

## 6. Camino C — Oracle Cloud Always Free (docs; el stack no cambia)

Esto es una **VM Linux tuya** en Oracle, no un PaaS. El código sigue con `node:sqlite` y un archivo en disco. No hace falta Turso. Más trabajo (SSH, firewall, systemd, HTTPS).

**Hecho (Oracle, 2026):** para abrir una cuenta Free Tier / Always Free **sí piden tarjeta** (crédito o débito que funcione como crédito). Sirve para verificar identidad. Oracle dice que **no cobra** salvo que pases a cuenta de pago; puede haber un cargo de autorización temporal que el banco suelta en unos días. No aceptan prepaid, virtuales ni débito con PIN. Una cuenta Free por persona. Fuentes: [oracle.com/cloud/free](https://www.oracle.com/cloud/free/), [docs: Sign up](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm), [Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).

### 6.1 Cuenta y VM

1. [https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/) → Sign up. País, correo, **móvil**, **tarjeta**.
2. En la consola: Compute → Instances → Create.
3. Forma Always Free típica:
   - **Ampere** (VM.Standard.A1.Flex): hasta 4 OCPU / 24 GB compartidos en la cuenta; o
   - **AMD** (VM.Standard.E2.1.Micro): 1/8 OCPU, 1 GB — más justo para Node+Vite+Caddy.
4. Imagen: Ubuntu 22.04/24.04. Red: VCN por defecto. SSH: pega tu clave pública.
5. **Block volume** Always Free (hay cupo de decenas a ~200 GB según la región): adjúntalo y móntalo, p. ej. `/var/lib/gastos`. Ahí va `gastos.sqlite` (`GASTOS_DATA_DIR=/var/lib/gastos`). El boot volume también es persistente; el block volume es por si quieres separar datos.
6. La capacidad Always Free a veces está agotada en una región: prueba otra o AMD.

### 6.2 Red: puerto 443

En la VCN → Security List (o NSG de la instancia):

- Ingress TCP **22** (tu IP, no 0.0.0.0 si puedes).
- Ingress TCP **80** y **443** (0.0.0.0/0) para HTTP y HTTPS.
- Egress all (por defecto).

Anota la IP pública de la instancia.

### 6.3 Instalar Node, clonar, systemd, Caddy

SSH a la VM (`ssh ubuntu@IP` o el usuario de la imagen). Después de **Create repo**:

```bash
sudo apt-get update
sudo apt-get install -y git caddy
# Node 22 (ejemplo NodeSource o nvm; la app pide >=22.13)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p /var/lib/gastos
sudo chown ubuntu:ubuntu /var/lib/gastos

git clone https://github.com/TU_USUARIO/TU_REPO.git /home/ubuntu/gastos-hogar
cd /home/ubuntu/gastos-hogar
git checkout main   # o cursor/gastos-hogar-05fc
npm ci
npm run build
```

Archivo `/etc/systemd/system/gastos-hogar.service` (ajusta rutas y secretos; **no** dejes las contraseñas en un gist público):

```
[Unit]
Description=Gastos del hogar
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/gastos-hogar
Environment=NODE_ENV=production
Environment=PORT=4731
Environment=GASTOS_DATA_DIR=/var/lib/gastos
Environment=SESSION_SECRET=cambia-esto
Environment=GASTOS_ADMIN_PASSWORD=cambia-esto
Environment=GASTOS_ADMIN2_PASSWORD=cambia-esto
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gastos-hogar
```

Caddy (`/etc/caddy/Caddyfile`), con un DNS A hacia la IP (o el hostname efímero de Oracle no da certificado fácil; usa un dominio tuyo):

```
tu-dominio.ejemplo {
    reverse_proxy 127.0.0.1:4731
}
```

```bash
sudo systemctl reload caddy
```

Caddy pide 80/443 abiertos y un nombre DNS. Sube el sqlite exportado a `/var/lib/gastos/gastos.sqlite` con `scp`.

Si no quieres dominio: Caddy en HTTP solo en 80 (sin certificado), o un túnel de pago. No uses trycloudflare como solución permanente desde el agente.

---

## 7. Otras nubes (no recomendadas ahora)

- **Fly.io:** el Hobby gratis ya no existe para cuentas nuevas. Prueba corta; volúmenes de pago y tarjeta.
- **Koyeb:** el instance Free **no puede** montar Volumes.
- **Neon / Render Postgres:** persistiría, pero habría que migrar de SQLite a Postgres.
- **Cloudflare D1:** gratis para datos; obliga a Workers, no a este proceso Node + Vite.

---

## 8. Checklist rápido

Camino A (gratis):

- [ ] **Create repo** en GitHub y push (si Render no ve el código).
- [ ] Cuenta Turso Free, crear DB, copiar URL y token (nunca a git).
- [ ] Cuenta Render Free, Web Service Node (**no** Static Site), **sin disco**.
- [ ] Env: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET`, `GASTOS_ADMIN_PASSWORD`, `GASTOS_ADMIN2_PASSWORD`, `NODE_ENV=production`.
- [ ] Deploy; copiar `https://….onrender.com` del dashboard.
- [ ] Restaurar JSON desde la app del agente; Restart: los datos siguen.
- [ ] No dependas de trycloudflare.

Camino B (pago, mismo sqlite):

- [ ] Create repo.
- [ ] Render Starter + disco `/var/data` + `GASTOS_DATA_DIR=/var/data`.
- [ ] `npm run export-sqlite` y copia al disco.
- [ ] Sin `TURSO_*`.

Camino C (Oracle Always Free):

- [ ] Create repo.
- [ ] Cuenta Oracle **con tarjeta de verificación**.
- [ ] VM Always Free + security list 443 + Node + systemd + Caddy + `GASTOS_DATA_DIR` en volumen persistente.

Fuentes: [render.com/docs/free](https://render.com/docs/free), [render.com/docs/disks](https://render.com/docs/disks), [render.com/pricing](https://render.com/pricing), [turso.tech/pricing](https://turso.tech/pricing), [oracle.com/cloud/free](https://www.oracle.com/cloud/free/), [fly.io/docs/about/free-trial](https://fly.io/docs/about/free-trial/).

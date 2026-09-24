# Gastos del hogar

Presupuesto mensual de Melissa y Lenin: Casa San Andrés, Casa Praderas de Sandino y el resto de gastos del mes. La interfaz está en español. Octubre 2026 viene precargado desde la hoja **Gastos**, con ingreso real de **$4,800** (no $5,000). Los gastos de la hoja se mantienen; el balance usa esos $4,800.

## URL pública

**Usa solo esta** (comprobada con `/login` HTTP 200). Las anteriores ya no existen:

https://highs-voting-finance-preferred.trycloudflare.com

Muertas (no las abras): `alto-impressed-meals-missile.trycloudflare.com`, `fin-reconstruction-cleveland-tom.trycloudflare.com`, `stockings-inter-reserves-tom.trycloudflare.com`, `conventions-youth-compilation-mind.trycloudflare.com` y `split-holders-converted-cooling.trycloudflare.com`.

Esa dirección está en `data/public-url.txt`. El túnel vive en tmux `gastos-public-tunnel` (ventana `keep`, script `scripts/cloudflared-keepalive.sh`) y apunta a Vite en `127.0.0.1:4731`, con **HTTP/2** y rearranque automático si el proceso muere o Cloudflare responde `Tunnel not found`. Un *quick tunnel* **cambia de hostname** cuando Cloudflare lo da de baja: no hay cuenta de Cloudflare en esta máquina, así que no se puede fijar un dominio estable (túnel con nombre). `npm run public-url` reusa el túnel vivo y no abre un segundo.

Hay que entrar con usuario y contraseña. Hasta **3** perfiles. La foto por defecto es la marca L&M (`/lm-mark.jpg`). Las contraseñas se guardan con **scrypt** (sal distinta por usuario), nunca en texto plano.

## Perfiles de arranque

Los usuarios semilla son `mgomez` (Melissa) y `lsotelon` (Lenin), ambos admin.

Las contraseñas **no van en el repositorio**. Al crear una base vacía:

1. Define `GASTOS_ADMIN_PASSWORD` (Melissa / `mgomez`) y `GASTOS_ADMIN2_PASSWORD` (Lenin / `lsotelon`), o copia `.env.example` a `.env`.
2. Si esas variables están vacías en un entorno local de desarrollo, se usan dummy claramente locales (`dev-only-local-mgomez` y `dev-only-local-lsotelon`). No las uses en la URL pública.
3. Si `data/gastos.sqlite` ya tiene esos usuarios, el arranque **no cambia** las claves. Para rotarlas hay que definir las variables y recrear los usuarios, o actualizar el hash a mano.

Un admin puede crear un tercer perfil de **solo lectura** (`viewer` / usuario). Ese perfil ve Presupuesto y Analítica, pero no puede añadir, editar, arrastrar, guardar, descargar copia ni restaurar. El servidor rechaza cada escritura (no solo la interfaz).

El presupuesto vive en SQLite en el servidor (`data/gastos.sqlite`). Al entrar y al cambiar de mes se carga **siempre** desde `/api/gastos`; el navegador no es la fuente de verdad. `localStorage` solo puede guardar una copia de solo lectura **después** de un GET exitoso; nunca se usa para PUT ni para resembrar. Las tablas cubren meses, ingresos, categorías, gastos, subgastos (charges), detalles, usuarios y sesiones. Si existe un `data/gastos.json` de una versión anterior, se importa a SQLite al arrancar. **Guardar** y cada edición con sentido (solo **admin**) escriben el mes abierto en SQLite (`saveScope: current`, para no borrar otros meses). Un perfil de **solo lectura** (`viewer`) puede ver Presupuesto y Analítica, pero no añadir, editar, arrastrar ni guardar.

`/data/`, los `.sqlite` y el código de `server/` no se sirven por HTTP. En el pie un admin autenticado puede **Descargar copia** o **Restaurar desde archivo**.

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

La app queda en [http://127.0.0.1:4731](http://127.0.0.1:4731). Sin sesión te lleva a `/login`. La URL pública para Chrome en el portátil es la de arriba; no abras un túnel nuevo.

Otras órdenes:

```bash
npm run build
npm run preview
```

Un admin puede crear un tercer perfil (nombre, usuario, contraseña y rol admin o viewer). La foto por defecto es la marca **L&M**.

## Qué incluye

- Alta, edición y baja de ingresos, gastos y categorías (admin)
- Totales del mes: ingresos, gastos y balance
- Cada mes se guarda aparte. **Crear noviembre** copia el mes abierto hacia adelante; **Crear septiembre** (desde octubre) lo copia hacia atrás. Ingresos, gastos, cargos, layouts, estados y rubros se clonan; las fechas pasan al mes nuevo. Desde septiembre, **Crear agosto**, y así. Si el mes ya existe, el botón se oculta.
- Navegación entre los meses que ya existen
- Estados vacío, de carga y de error (si el servidor no responde se muestra error y Reintentar; no se usa una copia local)
- Escritorio y teléfono

## Restaurar

En el pie de página, **Restaurar octubre 2026** vuelve a cargar el presupuesto semilla de ese mes. El resto de los meses no se toca. Solo un admin puede restaurar.

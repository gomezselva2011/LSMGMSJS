# Gastos del hogar

Presupuesto mensual de Melissa y Lenin: Casa San Andrés, Casa Praderas de Sandino y el resto de gastos del mes. La interfaz está en español. Octubre 2026 viene precargado desde la hoja **Gastos**, con ingreso real de **$4,800** (no $5,000). Los gastos de la hoja se mantienen; el balance usa esos $4,800.

## URL pública (no cambiar)

**Esta es la URL pública; no reiniciar el túnel ni inventar otra.**

https://split-holders-converted-cooling.trycloudflare.com

Esa dirección está también en `data/public-url.txt`. El túnel Cloudflare vive en tmux `gastos-public-tunnel` y apunta a Vite en `127.0.0.1:4731`. Un *quick tunnel* (`cloudflared tunnel --url`) **cambia de hostname cada vez que se relanza**. Si el túnel ya está en marcha, déjalo: `npm run public-url` (script `scripts/ensure-public-tunnel.sh`) lo reusa y no abre otro. La ventana `keep` de esa sesión espera al proceso vivo. Solo lo relanza si el proceso murió, o si Cloudflare ya olvidó el túnel (`Tunnel not found` + el hostname no resuelve): en esos casos el hostname anterior no se puede recuperar.

Hay que entrar con usuario y contraseña. Hasta **3** perfiles. La foto por defecto es la marca L&M (`/lm-mark.jpg`). Las contraseñas se guardan con **scrypt**, nunca en texto plano.

## Perfiles de arranque (temporales)

Cambia estas contraseñas después del primer acceso.

| Nombre | Usuario | Contraseña temporal | Rol |
| --- | --- | --- | --- |
| Melissa | `mgomez` | `Noviembre041980!` | admin (edita todo) |
| Lenin | `lsotelon` | `Caregatotriste1!` | admin (edita todo) |

Un admin puede crear un tercer perfil de **solo lectura** (`viewer` / usuario). Ese perfil ve Presupuesto y Analítica, pero no puede añadir, editar, arrastrar, guardar ni restaurar.

El presupuesto vive en SQLite en el servidor (`data/gastos.sqlite`) y también en `localStorage`. Las tablas cubren meses, ingresos, categorías, gastos, subgastos (charges), detalles, usuarios y sesiones. Si existe un `data/gastos.json` de una versión anterior, se importa a SQLite al arrancar. **Guardar** y cada edición (solo **admin**) escriben las dos copias. Un perfil de **solo lectura** (`viewer`) puede ver Presupuesto y Analítica, pero no añadir, editar, arrastrar ni guardar.

En el pie un admin puede **Descargar copia** o **Restaurar desde archivo**.

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
- Estados vacío, de carga y de error (datos dañados o almacenamiento bloqueado)
- Escritorio y teléfono

## Restaurar

En el pie de página, **Restaurar octubre 2026** vuelve a cargar el presupuesto semilla de ese mes. El resto de los meses no se toca. Solo un admin puede restaurar.

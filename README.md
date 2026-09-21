# Gastos del hogar

Presupuesto mensual de Melissa y Lenin: Casa San Andrés, Casa Praderas de Sandino y el resto de gastos del mes. La interfaz está en español. Octubre 2026 viene precargado desde la hoja **Gastos**, con ingreso real de **$4,800** (no $5,000). Los gastos de la hoja se mantienen; el balance usa esos $4,800.

Hay que entrar con usuario y contraseña. El presupuesto vive en un archivo JSON en el servidor (`data/gastos.json`) y también en `localStorage`. **Guardar** y cada edición (solo **admin**) escriben las dos copias. Un perfil de **solo lectura** puede ver Presupuesto y Analítica, pero no añadir, editar, arrastrar ni guardar.

En el pie un admin puede **Descargar copia** o **Restaurar desde archivo**.

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

La app queda en [http://127.0.0.1:4731](http://127.0.0.1:4731). Sin sesión te lleva a `/login`.

Otras órdenes:

```bash
npm run build
npm run preview
```

## Perfiles de arranque (temporales)

Si no hay nadie en `data/users.json`, el servidor crea dos perfiles. Cambia estas contraseñas después del primer acceso. Las contraseñas se guardan con **scrypt**, nunca en texto.

| Nombre | Usuario | Contraseña temporal | Rol |
| --- | --- | --- | --- |
| Melissa | `melissa` | `CasaLM-1029` | admin (edita todo) |
| Lenin | `lenin` | `VerSolo-1029` | usuario (solo lectura) |

Un admin puede crear hasta **3** perfiles (nombre, usuario, contraseña y rol). La foto por defecto es la marca **L&M**; cada persona puede cambiarla.

## Qué incluye

- Alta, edición y baja de ingresos, gastos y categorías (admin)
- Totales del mes: ingresos, gastos y balance
- Cada mes se guarda aparte. **Crear noviembre** copia octubre (ingresos, gastos y categorías); las fechas pasan a decir noviembre. Desde noviembre, **Crear diciembre**, y así.
- Navegación entre los meses que ya existen
- Estados vacío, de carga y de error (datos dañados o almacenamiento bloqueado)
- Escritorio y teléfono

## Restaurar

En el pie de página, **Restaurar octubre 2026** vuelve a cargar el presupuesto semilla de ese mes. El resto de los meses no se toca. Solo un admin puede restaurar.

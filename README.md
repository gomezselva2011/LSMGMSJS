# Gastos del hogar

Presupuesto mensual de Melissa y Lenin: Casa San Andrés, Casa Praderas de Sandino y el resto de gastos del mes. La interfaz está en español. Octubre 2026 viene precargado desde la hoja **Gastos**, con ingreso real de **$4,800** (no $5,000). Los gastos de la hoja se mantienen; el balance usa esos $4,800.

No hay cuenta ni base de datos. Todo se guarda en `localStorage` de este navegador.

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

La app queda en [http://127.0.0.1:4731](http://127.0.0.1:4731).

Otras órdenes:

```bash
npm run build
npm run preview
```

## Qué incluye

- Alta, edición y baja de ingresos, gastos y categorías
- Totales del mes: ingresos, gastos y balance
- Navegación entre meses (octubre 2026 trae datos; el resto empieza vacío)
- Estados vacío, de carga y de error (datos dañados o almacenamiento bloqueado)
- Escritorio y teléfono

## Restaurar

En el pie de página, **Restaurar octubre 2026** vuelve a cargar el presupuesto semilla de ese mes. El resto de los meses no se toca.

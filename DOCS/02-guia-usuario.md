# 02 – Guía de usuario

## La pantalla

- **Barra superior**: escala de zoom (Día · Semana · Mes · Q · H · Año) y acciones (`+ Proyecto`, `⚡ Prioritaria`, `⚙ Dominios`, `📊 Reportería`, `⬇ Exportar`).
- **Backlog** (izquierda): tarjetas de tareas aún no programadas.
- **Tablero** (centro): eje temporal arriba, y debajo las **horizontales** (dominios) como swimlanes. La línea roja vertical marca el día de hoy.

## Dominios (horizontales)

Las barras horizontales son parametrizables. Abre **⚙ Dominios** (o haz clic en cualquier etiqueta de dominio a la izquierda) para:

- **Crear** un dominio nuevo (`+ Agregar dominio`).
- **Renombrar**: edita el nombre.
- **Cambiar color**: selector de color (afecta el punto indicador de la fila).
- **Reordenar**: flechas ↑/↓.
- **Eliminar** (✕): el dominio se borra y **sus tareas vuelven al backlog** (no se pierden).

## Zoom / escala temporal

Los botones de la barra cambian la densidad del eje:

| Escala | Uso típico |
|---|---|
| Día | Planificación fina, ver días individuales. |
| Semana | Vista por defecto. |
| Mes | Horizonte de varios meses. |
| Q (trimestre) | Planificación trimestral. |
| H (semestre) | Visión semestral. |
| Año | Panorama anual. |

El zoom solo cambia la presentación; no altera los datos.

## Crear un proyecto

1. Pulsa **`+ Proyecto`**.
2. Completa: **nombre**, **dueño**, **descripción corta**, **dominio**, **alcance** (en semanas) e **inicio**.
3. El **color es automático** (se elige el menos usado de la paleta; nunca rojo, reservado a prioritarias). Puedes cambiarlo entre los disponibles.
4. Estado inicial: normalmente **Backlog**.

## Del backlog al tablero

Arrastra una tarjeta del **Backlog** y suéltala sobre una horizontal:

- Se inicia (**Doing**) en la fecha donde la sueltas.
- Queda en el dominio (fila) sobre el que la sueltes.
- Puedes apilar **varias tareas** en una misma horizontal (arriba/abajo); son independientes y no requieren predecesoras.

## Mover, editar y eliminar

- **Mover en el tiempo**: arrastra un bloque horizontalmente → cambia su fecha de inicio.
- **Cambiar de horizontal/fila**: arrástralo verticalmente a otro dominio o fila de apilamiento.
- **Editar**: haz clic (sin arrastrar) sobre el bloque para abrir el modal.
- **Eliminar**: botón **Eliminar** dentro del modal de edición.

## Subrutinas (dependencias cross-dominio)

Una tarea puede requerir apoyo de otros dominios. En el modal de la tarea, sección **"Subrutinas en otros dominios"**, agrega filas con:

- **Dominio** donde se ejecuta la subrutina.
- **Nombre** de la subrutina.
- **Alcance** (semanas) y **desfase** (semanas respecto al inicio de la tarea padre).

Se dibujan como bloques enlazados (línea punteada) en la horizontal correspondiente.

## Tareas prioritarias (rojas)

Una prioritaria representa un trabajo urgente que **interrumpe** lo programado.

1. Pulsa **`⚡ Prioritaria`** y complétala como cualquier tarea (su color es rojo fijo).
2. Colócala/arrástrala sobre el tablero.
3. **Solo afecta a las horizontales que toca**: su propio dominio **más** los dominios de sus subrutinas. Si no tiene subrutinas, solo corta su propia horizontal.
4. Toda tarea normal de esas horizontales que cruce su ventana se **parte en dos**: se detiene al inicio de la roja y **reanuda al terminarla**. El tramo que continúa lleva el marcador **⏸**.
5. Una prioritaria con subrutinas se ve como **un solo bloque** que abarca los dominios involucrados (no se parte ella misma).
6. Es reversible: si mueves la roja o la eliminas, las tareas afectadas se **recomponen automáticamente**.

> Para elegir qué horizontales detiene una prioritaria, agrégale subrutinas en esos dominios.

## Reportería

Pulsa **`📊 Reportería`** para ver:

- Proyectos totales, **priorizados**, en tiempo y con desviación.
- **Desviación total y promedio** (en días/semanas).
- **Desviación causada por prioridades** (interrupciones).
- Distribución por estado (Backlog/Doing/Ended).
- Desglose **por dominio** (proyectos, priorizados y desviación).

## Exportar

**`⬇ Exportar`** descarga un `.json` con el estado actual (dominios y tareas) como respaldo o para inspección. La persistencia real vive en PostgreSQL.

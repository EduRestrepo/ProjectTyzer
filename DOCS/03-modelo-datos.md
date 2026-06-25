# 03 – Modelo de datos

Base de datos: **PostgreSQL**. Esquema definido en `db/init.sql`. Tres tablas principales.

## `domains` — dominios (horizontales / swimlanes)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | serial PK | Identificador. |
| `name` | text | Nombre del dominio (ej. "Seguridad"). |
| `color` | text | Color del indicador de la fila (hex). |
| `position` | integer | Orden de aparición (0 arriba). |
| `created_at` | timestamptz | Fecha de creación. |

## `tasks` — tareas / proyectos (los "ladrillos")

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | serial PK | Identificador. |
| `name` | text | Nombre del proyecto. |
| `owner` | text | Dueño. |
| `description` | text | Descripción corta. |
| `domain_id` | int FK → domains | Horizontal donde vive. `NULL` si quedó sin dominio. |
| `status` | text | `backlog` · `doing` · `ended` (con CHECK). |
| `color` | text | Color del bloque. Rojo (`#ef4444`) si es prioritaria. |
| `is_priority` | boolean | Si es tarea prioritaria (roja). |
| `scope_weeks` | numeric | Alcance/duración en semanas (> 0). |
| `baseline_start` | date | **Línea base**: inicio planificado original (para medir desviación). |
| `start_date` | date | Inicio actual mostrado. Se mantiene = `planned_start`. |
| `planned_start` | date | Inicio "intención" del usuario (lo que define al crear/mover). |
| `lane` | integer | Fila de apilamiento dentro del dominio (0, 1, 2…). |
| `priority_shift_days` | integer | Días de **interrupción** acumulados por prioritarias. |
| `created_at` / `updated_at` | timestamptz | Auditoría (`updated_at` vía trigger). |

## `subtasks` — subrutinas cross-dominio (dependencias)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | serial PK | Identificador. |
| `parent_task_id` | int FK → tasks | Tarea padre. `ON DELETE CASCADE`. |
| `domain_id` | int FK → domains | Dominio donde se ejecuta la subrutina. |
| `name` | text | Nombre. |
| `scope_weeks` | numeric | Duración en semanas (> 0). |
| `offset_weeks` | numeric | Desfase de inicio respecto al inicio de la tarea padre. |
| `created_at` | timestamptz | Fecha de creación. |

## Semántica de las tres fechas

Es clave entender la diferencia entre las fechas de una tarea:

- **`baseline_start`** — la línea base. Se fija al crear/programar la tarea y normalmente **no cambia**. Sirve para medir desviación.
- **`planned_start`** — la intención actual del usuario. Cuando mueves una tarea manualmente, esta fecha se actualiza a la nueva posición.
- **`start_date`** — la fecha que se muestra. Hoy es igual a `planned_start`: la tarea **arranca a tiempo** y, si una prioritaria la cruza, se **parte** (se interrumpe y reanuda) sin mover su inicio.

La interrupción provocada por prioritarias se registra en **`priority_shift_days`** (días que la tarea tarda de más en terminar por las pausas).

```
fin_efectivo = planned_start + duración + priority_shift_days
desviación   = (start_date − baseline_start)  +  priority_shift_days
               └── replanificación manual ──┘     └─ interrupciones ─┘
```

## Relaciones y borrado

- Borrar un **dominio**: las tareas de ese dominio pasan a `status='backlog'` y `domain_id` queda `NULL` (vuelven al backlog).
- Borrar una **tarea**: sus subtareas se borran en cascada; se recalcula el cronograma.
- Borrar una **prioritaria**: al recalcular, las tareas que cortaba recuperan su forma original.

## Datos de ejemplo

`init.sql` siembra 4 dominios (Comunicaciones, Nube, Tierra, Seguridad), varias tareas en distintos estados, subrutinas cross-dominio y una tarea prioritaria de ejemplo con subrutinas. Útil para ver el comportamiento al primer arranque.

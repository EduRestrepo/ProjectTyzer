# 04 – Referencia de API

Base URL: `http://localhost:3016`. Todas las respuestas son JSON. Los cuerpos de petición van como `application/json`.

## Dominios

### `GET /api/domains`
Lista los dominios ordenados por `position`.

```json
[{ "id": 1, "name": "Comunicaciones", "color": "#0ea5e9", "position": 0 }]
```

### `POST /api/domains`
Crea un dominio.

```json
{ "name": "Logística", "color": "#22c55e", "position": 4 }
```

### `PUT /api/domains/:id`
Actualiza nombre, color y/o posición (campos opcionales, se respeta lo no enviado).

```json
{ "name": "Nuevo nombre", "color": "#f59e0b", "position": 2 }
```

### `DELETE /api/domains/:id`
Borra el dominio. Sus tareas pasan a `backlog` con `domain_id = NULL`.

## Tareas

### `GET /api/tasks`
Lista todas las tareas, cada una con su arreglo `subtasks`.

```json
[{
  "id": 1, "name": "Migración central telefónica", "owner": "A. Gómez",
  "description": "...", "domain_id": 1, "status": "doing", "color": "#3b82f6",
  "is_priority": false, "scope_weeks": "4", "baseline_start": "2026-06-18",
  "start_date": "2026-06-18", "planned_start": "2026-06-18",
  "lane": 0, "priority_shift_days": 0, "subtasks": [ ... ]
}]
```

### `POST /api/tasks`
Crea una tarea. Si `is_priority` es `true`, el color se fuerza a rojo; si no, se asigna un **color automático** (el menos usado de la paleta). Tras crear, se ejecuta el recálculo del cronograma.

```json
{
  "name": "Hardening de servidores",
  "owner": "C. Salas",
  "description": "Bastionado de la flota",
  "domain_id": 4,
  "status": "backlog",
  "scope_weeks": 3,
  "start_date": "2026-07-15",
  "baseline_start": "2026-07-15",
  "lane": 1,
  "is_priority": false,
  "color": null
}
```

Respuesta: `{ "task": { ...filaCreada } }`.

### `PUT /api/tasks/:id`
Actualización parcial (campos `COALESCE`: lo no enviado se conserva). Si se envía `start_date`, también se actualiza `planned_start` (intención del usuario); `baseline_start` no cambia salvo que se envíe explícito. Tras actualizar, se recalcula el cronograma.

```json
{ "start_date": "2026-07-01", "domain_id": 3, "lane": 0 }
```

### `DELETE /api/tasks/:id`
Borra la tarea (subtareas en cascada) y recalcula el cronograma.

## Subtareas (subrutinas cross-dominio)

### `POST /api/tasks/:id/subtasks`
Agrega una subrutina a la tarea `:id`.

```json
{ "domain_id": 2, "name": "Provisión SIP trunk", "scope_weeks": 1.5, "offset_weeks": 0.5 }
```

### `DELETE /api/subtasks/:id`
Elimina una subrutina.

## Prioridades

### `POST /api/tasks/:id/reschedule`
Fuerza un recálculo del cronograma (idempotente). Útil como botón "Replanificar". Devuelve `{ "ok": true }`.

## Reportería

### `GET /api/report`
Devuelve métricas agregadas de desviación.

```json
{
  "total": 9,
  "byStatus": { "backlog": 3, "doing": 5, "ended": 1 },
  "priority": 1,
  "delayed": 2,
  "onTime": 7,
  "totalDevDays": 10,
  "totalDevWeeks": 1.4,
  "avgDevDays": 1.1,
  "priorityDevDays": 7,
  "priorityDevWeeks": 1.0,
  "perDomain": [
    { "domain": "Seguridad", "count": 2, "priority": 1, "devDays": 7, "devWeeks": 1.0 }
  ]
}
```

| Campo | Significado |
|---|---|
| `total` | Número de proyectos. |
| `byStatus` | Conteo por estado. |
| `priority` | Cuántos son prioritarios. |
| `delayed` / `onTime` | Con desviación > 0 / sin desviación. |
| `totalDevDays` · `totalDevWeeks` | Desviación total (manual + interrupciones). |
| `avgDevDays` | Desviación promedio por proyecto. |
| `priorityDevDays` · `priorityDevWeeks` | Desviación causada por prioritarias. |
| `perDomain` | Desglose por dominio. |

## Errores

Los errores devuelven HTTP `500` (o `400` en validaciones) con `{ "error": "mensaje" }`.

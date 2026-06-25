# 01 – Arquitectura

## Visión general

ProjecTyzer es una aplicación web de una sola página (SPA ligera en JavaScript vanilla) servida por un backend Node/Express, con persistencia en PostgreSQL. Todo corre en dos contenedores Docker orquestados con `docker compose`.

```
┌──────────────────────────────────────────────────────────┐
│  Navegador (http://localhost:3016)                         │
│  public/index.html · app.js · styles.css                   │
│   - Render del tablero (eje temporal + swimlanes)          │
│   - Drag & drop, modales, zoom                             │
│   - Cálculo de segmentos (corte por prioritarias)          │
└───────────────▲────────────────────────────────────────────┘
                │  REST/JSON  (fetch)
┌───────────────┴────────────────────────────────────────────┐
│  app  ·  Node 20 + Express  ·  contenedor projectyzer-app   │
│   server.js                                                 │
│   - API /api/domains, /api/tasks, /api/subtasks, /api/report│
│   - recomputeSchedule(): interrupción por prioritarias      │
│   - ensureSchema(): migración + recálculo al arrancar       │
└───────────────▲────────────────────────────────────────────┘
                │  pg (pool)
┌───────────────┴────────────────────────────────────────────┐
│  db  ·  PostgreSQL 16  ·  contenedor projectyzer-db         │
│   db/init.sql (esquema + datos de ejemplo)                  │
│   volumen pgdata (persistencia)                             │
└─────────────────────────────────────────────────────────────┘
```

## Componentes

### Frontend (`public/`)
JavaScript sin framework. Responsabilidades:

- **Geometría del tablero**: convierte fechas a píxeles según el nivel de zoom (`px()`, `widthFor()`), apila tareas por fila (`lane`) dentro de cada dominio y dibuja el eje temporal.
- **Render por segmentos**: una tarea que cruza la ventana de una prioritaria se dibuja en varios bloques (`segmentize()` / `drawSegments()`).
- **Interacción**: arrastrar desde el backlog, mover/editar bloques (pointer events), modales de creación/edición y de gestión de dominios, zoom y reportería.

### Backend (`server.js`)
Express con un pool de `pg`. Responsabilidades:

- CRUD de dominios, tareas y subtareas.
- `recomputeSchedule()`: recalcula la interrupción que cada prioritaria provoca en las tareas de las horizontales afectadas. Es **idempotente** (parte siempre de `planned_start`).
- `ensureSchema()`: al arrancar, aplica migraciones ligeras (`ADD COLUMN IF NOT EXISTS`), rellena `planned_start` y ejecuta un recálculo. Reintenta hasta que la base de datos esté lista.
- Sirve los archivos estáticos del frontend y hace fallback SPA.

### Base de datos (`db/init.sql`)
PostgreSQL. El script de inicialización crea el esquema y siembra datos de ejemplo. Se monta en `/docker-entrypoint-initdb.d/`, por lo que **solo se ejecuta la primera vez** que el volumen está vacío.

## Flujo de datos típico

1. El navegador hace `GET /api/domains` y `GET /api/tasks` al cargar.
2. El usuario arrastra/edita una tarea → `PUT/POST /api/tasks`.
3. El backend persiste y llama a `recomputeSchedule()`.
4. El frontend recarga (`loadAll()`) y redibuja, calculando los segmentos de corte en cliente.
5. La reportería (`GET /api/report`) agrega métricas de desviación bajo demanda.

## Estructura de carpetas

```
ProjecTyzer/
├── server.js              # Backend Express + lógica de prioridades
├── package.json           # Dependencias (express, pg)
├── Dockerfile             # Imagen de la app (node:20-alpine)
├── docker-compose.yml     # Servicios app + db, puerto 3016
├── .dockerignore
├── db/
│   └── init.sql           # Esquema + datos de ejemplo
├── public/
│   ├── index.html         # Estructura de la UI
│   ├── app.js             # Lógica del tablero
│   └── styles.css         # Estilos (tema oscuro)
├── README.md              # Resumen e inicio rápido
└── DOCS/                  # Esta documentación
```

## Decisiones de diseño

- **Sin framework de frontend**: el tablero es un único `<div class="canvas">` con bloques posicionados en absoluto; basta JS vanilla y mantiene el bundle en cero dependencias de cliente.
- **Cálculo de corte en cliente y servidor**: el frontend calcula los segmentos para dibujar; el backend repite la lógica para registrar los días de interrupción que alimentan la reportería. Ambos parten de las mismas reglas (ver [05](./05-logica-prioridades.md)).
- **Idempotencia**: el cronograma siempre se deriva de `planned_start` + posición de las prioritarias, nunca por acumulación, para que mover o borrar una roja recomponga el tablero sin desfases residuales.

## Mejoras de Arquitectura Sugeridas

Tras revisar la arquitectura de ProjecTyzer, se proponen las siguientes mejoras para incrementar la escalabilidad y robustez:

### 1. Backend y Persistencia
- **Refactorización de `recomputeSchedule` para optimizar conexiones**:
  Actualmente se ejecuta `recomputeSchedule` utilizando la conexión del pool general en cada query. Para mejorar el rendimiento, se sugiere obtener un único cliente de la base de datos para la duración del recálculo o bien implementar una función o procedimiento almacenado (stored procedure) en PL/pgSQL directamente en PostgreSQL para ejecutar este procesamiento en el lado de la base de datos de manera eficiente.
- **Transaccionalidad en operaciones concurrentes**:
  Implementar transacciones a nivel de base de datos (`BEGIN`/`COMMIT`/`ROLLBACK`) en los flujos de creación, actualización y eliminación de tareas. Esto evita estados inconsistentes si ocurre un fallo a mitad del proceso.
- **Capa de Validación de Datos**:
  Incorporar esquemas de validación de datos (por ejemplo, mediante un validador en middleware) para garantizar la integridad física de las fechas, los tipos de variables y los estados permitidos de las tareas que llegan a la API.

### 2. Frontend y UX
- **Preservación del contexto visual al cambiar el Zoom**:
  Implementar un gestor de scroll para el contenedor del canvas que, al cambiar la escala del zoom, recalcule la posición horizontal relativa al centro de la vista actual o a la línea de tiempo de la fecha de "hoy", evitando que el scroll se reinicie a cero.
- **Prevención de ciclos en subrutinas cross-dominio**:
  Implementar un algoritmo de detección de ciclos (búsqueda en profundidad - DFS) en la creación de subrutinas para evitar referencias circulares infinitas entre tareas que colapsen el flujo del cronograma.
- **Visualización optimizada de colisiones**:
  Añadir resaltado visual dinámico (Drop Zones) durante el arrastre Pointer-based, permitiendo al usuario ver exactamente en qué dominio y carril (lane) se ubicará el elemento.


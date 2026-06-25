# ProjecTyzer

Trazador de proyectos estilo **Kanban + línea de tiempo**, con dominios (swimlanes), tareas como ladrillos arrastrables, subrutinas cross-dominio, tareas **prioritarias** que replanifican el cronograma y un módulo de **reportería de desviación**.

Stack: **Node.js + Express + PostgreSQL**, todo en **Docker**, app expuesta en el **puerto 3016**.

## Arranque Rápido

```bash
docker compose up --build
```

Luego abre: **http://localhost:3016**

La base de datos se inicializa sola con `db/init.sql` (esquema + datos de ejemplo) la primera vez.

Para empezar de cero (borrar datos):

```bash
docker compose down -v && docker compose up --build
```

---

## Cómo Funciona

- **Dominios** (parametrizables): Las 4 barras horizontales en la interfaz (por defecto: Comunicaciones, Nube, Tierra, Seguridad).
- **Eje temporal con zoom**: Día / Semana / Mes / Q / H / Año.
- **Estados**: Backlog · Doing · Ended.
- **Crear proyecto** (`+ Proyecto`): Nombre, dueño, descripción, dominio, alcance en semanas, color automático (nunca rojo).
- **Backlog → tablero**: Arrastra una tarjeta del backlog a un dominio para iniciarla (Doing) en la fecha donde la sueltes.
- **Subrutinas cross-dominio**: Dependencias secundarias de una tarea principal en otros dominios, representadas por bloques enlazados punteados.
- **Tareas prioritarias** (`⚡ Prioritaria`, rojas): Interrupciones críticas que **parten** las tareas normales que cruzan su ventana en los dominios afectados, reanudándose automáticamente al terminar la prioritaria.
- **Reportería de Desviación** (`📊`): Estadísticas en tiempo real de proyectos, prioridades y la desviación total y promedio acumulada en días/semanas.

---

## Estructura del Proyecto

- `server.js`: Servidor backend en Express con lógica de programación de tareas (`recomputeSchedule`).
- `db/init.sql`: Esquema PostgreSQL inicial y semilla de datos de ejemplo.
- `public/`: Contiene el frontend estático (HTML, CSS y JS sin dependencias externas).
- `DOCS/`: Documentación técnica detallada del sistema.

Para una descripción detallada de cada módulo, consulta el [Índice de la Documentación](file:///c:/APPS-DEV/ProjecTyzer/DOCS/README.md).

---

## Propuesta de Mejoras Recomendadas

Durante la revisión del proyecto, se han identificado las siguientes oportunidades de mejora para futuras iteraciones:

1. **Optimización del Pool de Conexiones en el Backend**: Adquirir un único cliente del pool en `recomputeSchedule` para evitar la apertura excesiva de conexiones simultáneas bajo alta concurrencia.
2. **Transacciones en base de datos**: Asegurar operaciones atómicas (como guardar una tarea y recalcular) envolviéndolas en bloques transaccionales (`BEGIN/COMMIT/ROLLBACK`).
3. **Validación de esquemas**: Implementar una biblioteca de validación de APIs en el backend para validar fechas, tipos y límites de datos.
4. **Fijación del Scroll en Zoom (UX)**: Mantener la posición de la fecha actual o del cursor al cambiar la escala de zoom en el tablero.
5. **Control de dependencias cíclicas**: Añadir detección de ciclos para evitar que subrutinas tengan dependencias circulares infinitas.
6. **Seguridad en Entorno**: Mover credenciales del PostgreSQL a un archivo `.env` externo y excluirlo del control de versiones.

---

## Subir este proyecto a GitHub

Para subir este proyecto a un repositorio de GitHub, ejecuta los siguientes comandos desde tu terminal en la raíz de este proyecto:

1. **Inicializar Git y agregar archivos**:
   ```bash
   git init
   git add .
   ```
2. **Crear el commit inicial**:
   ```bash
   git commit -m "Initial commit: ProjecTyzer con mejoras propuestas y documentación actualizada"
   ```
3. **Vincular y empujar al repositorio remoto**:
   ```bash
   git remote add origin <URL_DE_TU_REPOSITORIO_GITHUB>
   git branch -M main
   git push -u origin main
   ```

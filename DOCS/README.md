# Documentación de ProjecTyzer

Trazador de proyectos estilo **Kanban + línea de tiempo**, con dominios (swimlanes), tareas como ladrillos arrastrables, subrutinas cross-dominio, tareas **prioritarias** que parten el trabajo en ejecución y un módulo de **reportería de desviación**.

Stack: **Node.js + Express + PostgreSQL**, empaquetado con **Docker**, expuesto en el puerto **3016**.

## Índice

| Documento | Contenido |
|---|---|
| [01 – Arquitectura](./01-arquitectura.md) | Visión general, componentes, flujo de datos y estructura de carpetas. |
| [02 – Guía de usuario](./02-guia-usuario.md) | Cómo usar el tablero: dominios, zoom, crear/mover tareas, prioritarias y reportería. |
| [03 – Modelo de datos](./03-modelo-datos.md) | Tablas, columnas, relaciones y semántica de fechas. |
| [04 – Referencia de API](./04-api.md) | Endpoints REST, payloads y respuestas. |
| [05 – Lógica de prioridades y desviación](./05-logica-prioridades.md) | Cómo una roja parte las tareas y cómo se calcula la desviación. |
| [06 – Despliegue y operación](./06-despliegue.md) | Docker, variables de entorno, migraciones y solución de problemas. |

## Inicio rápido

```bash
cd ProjecTyzer
docker compose up --build
# abre http://localhost:3016
```

## Conceptos en una frase

- **Dominio**: una de las barras horizontales (swimlanes). Parametrizable. Ej.: Comunicaciones, Nube, Tierra, Seguridad.
- **Tarea / proyecto**: un ladrillo con dueño, descripción, alcance (semanas) y color automático.
- **Estados**: Backlog · Doing · Ended.
- **Subrutina**: dependencia de una tarea en otro dominio (cross-dominio).
- **Tarea prioritaria (roja)**: interrupción que **parte** las tareas de las horizontales que toca y las hace reanudar al terminar.
- **Desviación**: días que una tarea termina más tarde respecto a su línea base, por replanificación manual o por interrupciones de prioritarias.

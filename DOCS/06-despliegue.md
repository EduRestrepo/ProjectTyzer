# 06 – Despliegue y operación

## Requisitos

- **Docker** y **Docker Compose** (Docker Desktop en Windows/Mac, o Docker Engine + plugin compose en Linux).
- Puerto **3016** libre en el host.

## Arranque

```bash
cd ProjecTyzer
docker compose up --build
```

Esto construye la imagen de la app, levanta PostgreSQL, espera a que esté sano e inicia el servidor. Abre **http://localhost:3016**.

Para correr en segundo plano:

```bash
docker compose up --build -d
```

Ver logs:

```bash
docker compose logs -f app
docker compose logs -f db
```

Detener:

```bash
docker compose down            # conserva los datos (volumen pgdata)
docker compose down -v         # ELIMINA los datos (vuelve a sembrar init.sql)
```

## Servicios (docker-compose.yml)

| Servicio | Imagen | Puerto | Notas |
|---|---|---|---|
| `app` | build local (node:20-alpine) | 3016:3016 | Servidor Express + frontend. Depende de `db` sano. |
| `db` | postgres:16-alpine | interno 5432 | Volumen `pgdata`. Healthcheck con `pg_isready`. |

`init.sql` se monta en `/docker-entrypoint-initdb.d/` y **solo se ejecuta cuando el volumen está vacío** (primer arranque).

## Variables de entorno

Definidas en `docker-compose.yml` (servicio `app`). Por defecto:

| Variable | Valor | Descripción |
|---|---|---|
| `PORT` | 3016 | Puerto de escucha de la app. |
| `PGHOST` | db | Host de PostgreSQL (nombre del servicio). |
| `PGPORT` | 5432 | Puerto de PostgreSQL. |
| `PGUSER` | projectyzer | Usuario. |
| `PGPASSWORD` | projectyzer | Contraseña. |
| `PGDATABASE` | projectyzer | Base de datos. |

> Para producción, cambia `PGPASSWORD` y considera no exponer credenciales en el compose (usa un `.env` o secretos).

## Cambiar el puerto

Edita el mapeo en `docker-compose.yml` (`"3016:3016"`) y la variable `PORT`. El primer número es el puerto del host.

## Migraciones / cambios de esquema

Como `init.sql` solo corre con el volumen vacío, los cambios de esquema sobre una base existente se aplican como **migraciones ligeras al arrancar**, en `ensureSchema()` (`server.js`): por ejemplo `ALTER TABLE ... ADD COLUMN IF NOT EXISTS planned_start ...` y el relleno inicial. Tras migrar, ejecuta un recálculo del cronograma.

Para reconstruir solo la app tras cambios de código (conservando datos):

```bash
docker compose up --build -d app
```

Para empezar de cero (re-sembrar datos de ejemplo):

```bash
docker compose down -v && docker compose up --build
```

## Respaldo y restauración

Respaldar la base de datos:

```bash
docker exec projectyzer-db pg_dump -U projectyzer projectyzer > backup.sql
```

Restaurar:

```bash
cat backup.sql | docker exec -i projectyzer-db psql -U projectyzer -d projectyzer
```

También puedes usar el botón **⬇ Exportar** de la interfaz para un snapshot JSON (dominios + tareas), útil como respaldo lógico o para inspección.

## Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| La app reinicia y los logs muestran "Esperando base de datos…" | La DB aún arranca. | El servidor reintenta hasta 15 veces cada 2 s; normalmente se resuelve solo. |
| Puerto 3016 ocupado | Otro proceso usa el puerto. | Cambia el mapeo en `docker-compose.yml`. |
| No aparecen los datos de ejemplo | El volumen ya existía. | `docker compose down -v` para re-sembrar (borra datos). |
| Cambié `init.sql` y no se refleja | Solo corre con volumen vacío. | Aplica el cambio como migración en `ensureSchema()` o re-siembra con `down -v`. |
| Tareas "desaparecen" tras borrar un dominio | Esperado: vuelven al backlog. | Ábrelas desde el panel Backlog y reubícalas. |

## Healthcheck y reinicio

`db` define un healthcheck (`pg_isready`) y `app` declara `depends_on: db (service_healthy)`, de modo que la app no arranca hasta que la base de datos acepta conexiones. Ambos servicios usan `restart: unless-stopped`.

---

## Buenas Prácticas de Configuración y Git (Mejoras Propuestas)

Para la puesta en marcha de entornos de producción o integraciones continuas, se sugieren las siguientes optimizaciones en el despliegue:

### 1. Gestión Segura de Variables de Entorno con `.env`
Actualmente, las credenciales del pool de base de datos están expuestas en texto plano dentro de `docker-compose.yml`.  
**Recomendación**:
- Mover las credenciales a un archivo `.env` en la raíz (ej: `POSTGRES_PASSWORD=mi_clave_segura`).
- Usar variables interpoladas en `docker-compose.yml` (ej: `PGPASSWORD: ${POSTGRES_PASSWORD}`).
- Asegurar que `.env` esté listado en `.gitignore` para no subir claves a repositorios públicos de GitHub.

### 2. Dockerfile Multi-Stage para Producción
Optimizar el tamaño de la imagen final y aislar dependencias utilizando un build multi-etapa:
```dockerfile
# Etapa de desarrollo/construcción
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install

# Etapa final de producción
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 3016
USER node
CMD ["node", "server.js"]
```

### 3. Control de Versiones con Git y GitHub
Se ha configurado un archivo `.gitignore` para garantizar que archivos locales temporales y dependencias no se suban al servidor. En la siguiente sección o en el `README.md` principal, se detallan las instrucciones para sincronizar el repositorio local con un repositorio en la nube de GitHub.


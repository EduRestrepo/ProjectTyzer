-- ProjecTyzer :: esquema PostgreSQL
-- Trazador de proyectos estilo Kanban + línea de tiempo con dominios (swimlanes)

-- =============================================================
-- DOMINIOS (parametrizables) -- las 4 "barras" horizontales
-- =============================================================
CREATE TABLE IF NOT EXISTS domains (
    id          SERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    color       TEXT        NOT NULL DEFAULT '#64748b',
    position    INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- TAREAS / PROYECTOS  (los "ladrillos" / legos)
--   status: backlog | doing | ended
--   baseline_start = inicio planificado original (línea base)
--   start_date     = inicio actual (puede correrse a la derecha)
--   priority_shift_days = días desplazados por culpa de tareas prioritarias
--   lane = fila de apilamiento vertical dentro del dominio (0,1,2..)
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id                  SERIAL PRIMARY KEY,
    name                TEXT        NOT NULL,
    owner               TEXT        NOT NULL DEFAULT '',
    description         TEXT        NOT NULL DEFAULT '',
    domain_id           INTEGER     REFERENCES domains(id) ON DELETE SET NULL,
    status              TEXT        NOT NULL DEFAULT 'backlog'
                                    CHECK (status IN ('backlog','doing','ended')),
    color               TEXT        NOT NULL DEFAULT '#3b82f6',
    is_priority         BOOLEAN     NOT NULL DEFAULT FALSE,
    scope_weeks         NUMERIC     NOT NULL DEFAULT 1 CHECK (scope_weeks > 0),
    baseline_start      DATE,
    start_date          DATE,
    planned_start       DATE,        -- inicio "intencion" del usuario (linea base de programacion)
    lane                INTEGER     NOT NULL DEFAULT 0,
    priority_shift_days INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(domain_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- =============================================================
-- SUBTAREAS (subrutinas cross-dominio / dependencias secundarias)
--   Una tarea sobre un dominio puede extenderse a otros dominios.
--   offset_weeks = desfase de inicio respecto al inicio de la tarea padre
-- =============================================================
CREATE TABLE IF NOT EXISTS subtasks (
    id              SERIAL PRIMARY KEY,
    parent_task_id  INTEGER     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    domain_id       INTEGER     REFERENCES domains(id) ON DELETE SET NULL,
    name            TEXT        NOT NULL DEFAULT '',
    scope_weeks     NUMERIC     NOT NULL DEFAULT 1 CHECK (scope_weeks > 0),
    offset_weeks    NUMERIC     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_task_id);

-- trigger updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_touch ON tasks;
CREATE TRIGGER trg_tasks_touch BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================================
-- DATOS DE EJEMPLO
-- =============================================================
INSERT INTO domains (name, color, position) VALUES
    ('Comunicaciones', '#0ea5e9', 0),
    ('Nube',           '#8b5cf6', 1),
    ('Tierra',         '#22c55e', 2),
    ('Seguridad',      '#f59e0b', 3)
ON CONFLICT DO NOTHING;

-- Tareas de ejemplo (start relativo a hoy)
WITH d AS (SELECT id, name FROM domains)
INSERT INTO tasks (name, owner, description, domain_id, status, color, is_priority, scope_weeks, baseline_start, start_date, lane)
VALUES
  ('Migración central telefónica', 'A. Gómez', 'Migrar PBX a VoIP corporativo',
     (SELECT id FROM d WHERE name='Comunicaciones'), 'doing', '#3b82f6', FALSE, 4,
     CURRENT_DATE - 7, CURRENT_DATE - 7, 0),
  ('Portal de noticias internas', 'L. Pérez', 'Nuevo intranet de comunicados',
     (SELECT id FROM d WHERE name='Comunicaciones'), 'backlog', '#14b8a6', FALSE, 3,
     CURRENT_DATE + 14, CURRENT_DATE + 14, 1),
  ('Cluster Kubernetes prod', 'R. Díaz', 'Levantar cluster productivo',
     (SELECT id FROM d WHERE name='Nube'), 'doing', '#8b5cf6', FALSE, 6,
     CURRENT_DATE - 3, CURRENT_DATE - 3, 0),
  ('Backups multi-región', 'R. Díaz', 'Estrategia de respaldo 3-2-1',
     (SELECT id FROM d WHERE name='Nube'), 'ended', '#06b6d4', FALSE, 2,
     CURRENT_DATE - 28, CURRENT_DATE - 28, 1),
  ('Despliegue antenas norte', 'M. Ruiz', 'Instalación física de antenas',
     (SELECT id FROM d WHERE name='Tierra'), 'doing', '#22c55e', FALSE, 8,
     CURRENT_DATE - 1, CURRENT_DATE - 1, 0),
  ('Cableado data center', 'M. Ruiz', 'Recableado estructurado',
     (SELECT id FROM d WHERE name='Tierra'), 'backlog', '#84cc16', FALSE, 5,
     CURRENT_DATE + 7, CURRENT_DATE + 7, 1),
  ('Auditoría ISO 27001', 'C. Salas', 'Pre-auditoría de cumplimiento',
     (SELECT id FROM d WHERE name='Seguridad'), 'doing', '#f59e0b', FALSE, 4,
     CURRENT_DATE - 5, CURRENT_DATE - 5, 0),
  ('Hardening de servidores', 'C. Salas', 'Bastionado de la flota',
     (SELECT id FROM d WHERE name='Seguridad'), 'backlog', '#eab308', FALSE, 3,
     CURRENT_DATE + 21, CURRENT_DATE + 21, 1);

-- Subtareas cross-dominio: la migración telefónica necesita apoyo de Nube y Seguridad
WITH t AS (SELECT id FROM tasks WHERE name='Migración central telefónica' LIMIT 1),
     dn AS (SELECT id FROM domains WHERE name='Nube' LIMIT 1),
     ds AS (SELECT id FROM domains WHERE name='Seguridad' LIMIT 1)
INSERT INTO subtasks (parent_task_id, domain_id, name, scope_weeks, offset_weeks)
VALUES
  ((SELECT id FROM t), (SELECT id FROM dn), 'Provisión SIP trunk', 1.5, 0.5),
  ((SELECT id FROM t), (SELECT id FROM ds), 'Cifrado de señalización', 1, 2);

-- Una tarea prioritaria (roja) de ejemplo, en bloque, con subtarea en otro dominio
WITH dom AS (SELECT id FROM domains WHERE name='Seguridad' LIMIT 1)
INSERT INTO tasks (name, owner, description, domain_id, status, color, is_priority, scope_weeks, baseline_start, start_date, lane)
VALUES
  ('Incidente: brecha crítica', 'CISO', 'Respuesta a incidente prioritario - todo el equipo',
   (SELECT id FROM dom), 'doing', '#ef4444', TRUE, 2,
   CURRENT_DATE, CURRENT_DATE, 2);

WITH t AS (SELECT id FROM tasks WHERE name='Incidente: brecha crítica' LIMIT 1),
     dn AS (SELECT id FROM domains WHERE name='Nube' LIMIT 1),
     dc AS (SELECT id FROM domains WHERE name='Comunicaciones' LIMIT 1)
INSERT INTO subtasks (parent_task_id, domain_id, name, scope_weeks, offset_weeks)
VALUES
  ((SELECT id FROM t), (SELECT id FROM dn), 'Aislar workloads', 1, 0),
  ((SELECT id FROM t), (SELECT id FROM dc), 'Comunicado a usuarios', 0.5, 0);

-- planned_start = start_date para todas las tareas sembradas
UPDATE tasks SET planned_start = start_date WHERE planned_start IS NULL;

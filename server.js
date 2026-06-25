'use strict';
// ProjecTyzer backend
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3016;

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'projectyzer',
  password: process.env.PGPASSWORD || 'projectyzer',
  database: process.env.PGDATABASE || 'projectyzer',
});

// ---- helpers ----
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

const PRIORITY_RED = '#ef4444';
const DAY_MS = 86400000;

// Paleta automatica (sin rojo). Se elige el color menos usado.
const PALETTE = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899',
  '#14b8a6', '#84cc16', '#a855f7', '#0ea5e9', '#eab308', '#10b981',
  '#6366f1', '#f97316', '#d946ef',
];

async function autoColor(client) {
  const { rows } = await client.query(
    `SELECT color, count(*) c FROM tasks WHERE is_priority = FALSE GROUP BY color`
  );
  const used = Object.fromEntries(rows.map((r) => [r.color, parseInt(r.c, 10)]));
  let best = PALETTE[0], min = Infinity;
  for (const c of PALETTE) {
    const n = used[c] || 0;
    if (n < min) { min = n; best = c; }
  }
  return best;
}

const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const durDays = (weeks) => Math.ceil(Number(weeks) * 7);

// ====================== DOMINIOS ======================
app.get('/api/domains', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM domains ORDER BY position, id');
  res.json(rows);
}));

app.post('/api/domains', wrap(async (req, res) => {
  const { name, color = '#64748b', position = 0 } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO domains (name, color, position) VALUES ($1,$2,$3) RETURNING *',
    [name, color, position]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/domains/:id', wrap(async (req, res) => {
  const { name, color, position } = req.body;
  const { rows } = await pool.query(
    `UPDATE domains SET name=COALESCE($2,name), color=COALESCE($3,color),
     position=COALESCE($4,position) WHERE id=$1 RETURNING *`,
    [req.params.id, name, color, position]
  );
  res.json(rows[0]);
}));

app.delete('/api/domains/:id', wrap(async (req, res) => {
  // Las tareas del dominio vuelven al backlog (sin dominio) para no quedar huerfanas
  await pool.query("UPDATE tasks SET status='backlog' WHERE domain_id=$1", [req.params.id]);
  await pool.query('DELETE FROM domains WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ====================== TAREAS ======================
async function loadTasks() {
  const { rows: tasks } = await pool.query('SELECT * FROM tasks ORDER BY id');
  const { rows: subs } = await pool.query('SELECT * FROM subtasks ORDER BY id');
  const byParent = {};
  for (const s of subs) (byParent[s.parent_task_id] = byParent[s.parent_task_id] || []).push(s);
  return tasks.map((t) => ({ ...t, subtasks: byParent[t.id] || [] }));
}

app.get('/api/tasks', wrap(async (req, res) => {
  res.json(await loadTasks());
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let {
      name, owner = '', description = '', domain_id = null,
      status = 'backlog', scope_weeks = 1, baseline_start = null,
      start_date = null, lane = 0, is_priority = false, color = null,
    } = req.body;

    if (is_priority) color = PRIORITY_RED;
    else if (!color || color === PRIORITY_RED) color = await autoColor(client);

    const { rows } = await client.query(
      `INSERT INTO tasks (name, owner, description, domain_id, status, color,
        is_priority, scope_weeks, baseline_start, start_date, planned_start, lane)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11) RETURNING *`,
      [name, owner, description, domain_id, status, color, is_priority,
       scope_weeks, baseline_start, start_date, lane]
    );
    const task = rows[0];
    await recomputeSchedule(client);     // empuja normales si cae sobre/ tras una prioritaria
    await client.query('COMMIT');
    task.subtasks = [];
    res.status(201).json({ task });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

app.put('/api/tasks/:id', wrap(async (req, res) => {
  const f = req.body;
  // Al mover una tarea (cambia start_date) actualizamos tambien planned_start
  // = intencion del usuario / linea base de programacion. baseline_start NO cambia
  // (se conserva para medir desviacion). Luego recalculamos por las prioritarias.
  const { rows } = await pool.query(
    `UPDATE tasks SET
       name=COALESCE($2,name), owner=COALESCE($3,owner),
       description=COALESCE($4,description), domain_id=COALESCE($5,domain_id),
       status=COALESCE($6,status), color=COALESCE($7,color),
       scope_weeks=COALESCE($8,scope_weeks), baseline_start=COALESCE($9,baseline_start),
       start_date=COALESCE($10,start_date), planned_start=COALESCE($10,planned_start),
       lane=COALESCE($11,lane)
     WHERE id=$1 RETURNING *`,
    [req.params.id, f.name, f.owner, f.description, f.domain_id, f.status,
     f.color, f.scope_weeks, f.baseline_start, f.start_date, f.lane]
  );
  await recomputeSchedule(pool);
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
  await recomputeSchedule(pool);          // si era prioritaria, las normales vuelven
  res.json({ ok: true });
}));

// ====================== SUBTAREAS (cross-dominio) ======================
app.post('/api/tasks/:id/subtasks', wrap(async (req, res) => {
  const { domain_id, name = '', scope_weeks = 1, offset_weeks = 0 } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO subtasks (parent_task_id, domain_id, name, scope_weeks, offset_weeks)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, domain_id, name, scope_weeks, offset_weeks]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/subtasks/:id', wrap(async (req, res) => {
  const f = req.body;
  const { rows } = await pool.query(
    `UPDATE subtasks SET domain_id=COALESCE($2,domain_id), name=COALESCE($3,name),
       scope_weeks=COALESCE($4,scope_weeks), offset_weeks=COALESCE($5,offset_weeks)
     WHERE id=$1 RETURNING *`,
    [req.params.id, f.domain_id, f.name, f.scope_weeks, f.offset_weeks]
  );
  await recomputeSchedule(pool);   // por si es subtarea de una prioritaria (cambia su ventana)
  res.json(rows[0]);
}));

app.delete('/api/subtasks/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM subtasks WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ====================== LOGICA DE PRIORIDAD (recalculo idempotente) ======================
// Una tarea prioritaria ocupa una ventana [inicio, inicio+alcance] en las
// horizontales (dominios) que toca: su propio dominio + los de sus subtareas.
// Toda tarea normal de ESAS horizontales que cruce la ventana se PARTE: se detiene
// al inicio de la roja y reanuda al terminarla. Otras horizontales no se afectan.
//
// Es IDEMPOTENTE: siempre se calcula desde planned_start (la intencion del usuario),
// no acumula. Si la prioritaria se mueve/elimina, las normales se recomponen solas.
async function recomputeSchedule(db) {
  // Ventanas prioritarias: duracion = max(alcance propio, extension de subtareas).
  // Cada ventana afecta SOLO a las horizontales (dominios) que la roja toca:
  // su propio dominio + los dominios de sus subtareas.
  const { rows: pris } = await db.query(
    `SELECT t.domain_id, t.start_date, t.scope_weeks,
            COALESCE(MAX(s.offset_weeks + s.scope_weeks), 0) AS sub_ext,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.domain_id), NULL) AS sub_domains
       FROM tasks t LEFT JOIN subtasks s ON s.parent_task_id = t.id
      WHERE t.is_priority = TRUE AND t.status <> 'ended' AND t.start_date IS NOT NULL
      GROUP BY t.id, t.domain_id, t.start_date, t.scope_weeks
      ORDER BY t.start_date ASC`
  );
  const windows = pris.map((p) => {
    const s = new Date(p.start_date);
    const domains = new Set([p.domain_id, ...(p.sub_domains || [])]);
    return { s, e: addDays(s, durDays(Math.max(Number(p.scope_weeks), Number(p.sub_ext)))), domains };
  }).sort((a, b) => a.s - b.s);

  const { rows: tasks } = await db.query(
    `SELECT id, domain_id, planned_start, scope_weeks FROM tasks
      WHERE is_priority = FALSE AND status <> 'ended' AND planned_start IS NOT NULL`
  );

  // La tarea arranca a tiempo (start_date = planned_start) y se PARTE alrededor de
  // cada prioritaria que afecte a SU horizontal: se detiene y reanuda al terminar la roja.
  // priority_shift_days = total de dias de interrupcion (alimenta la reporteria).
  for (const t of tasks) {
    const planned = new Date(t.planned_start);
    const d = durDays(t.scope_weeks);
    let cursor = new Date(planned), remaining = d;
    for (const w of windows) {
      if (!w.domains.has(t.domain_id)) continue;   // no afecta a esta horizontal
      if (w.e <= cursor) continue;
      const curEnd = addDays(cursor, remaining);
      if (w.s >= curEnd) break;
      if (w.s <= cursor) { cursor = new Date(w.e); continue; }
      const before = Math.round((w.s - cursor) / DAY_MS);
      remaining -= before; cursor = new Date(w.e);
    }
    const effEnd = addDays(cursor, remaining);
    const interruption = Math.max(0, Math.round((effEnd - planned) / DAY_MS) - d);
    await db.query(
      `UPDATE tasks SET start_date = planned_start, priority_shift_days = $2 WHERE id = $1`,
      [t.id, interruption]
    );
  }
}

// Reaplicar manualmente (boton "Replanificar")
app.post('/api/tasks/:id/reschedule', wrap(async (req, res) => {
  await recomputeSchedule(pool);
  res.json({ ok: true });
}));

// ====================== REPORTERIA / METRICAS ======================
app.get('/api/report', wrap(async (req, res) => {
  const tasks = await loadTasks();
  // desviacion total de fin = replanificacion manual (start vs linea base) + interrupcion por prioritarias
  const devDays = (t) => {
    const manual = (t.start_date && t.baseline_start)
      ? Math.round((new Date(t.start_date) - new Date(t.baseline_start)) / DAY_MS) : 0;
    return manual + Number(t.priority_shift_days || 0);
  };

  const total = tasks.length;
  const byStatus = { backlog: 0, doing: 0, ended: 0 };
  let priority = 0, delayed = 0, totalDevDays = 0, priorityDevDays = 0;
  const perDomain = {};

  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (t.is_priority) priority += 1;
    const d = devDays(t);
    totalDevDays += d;
    if (d > 0) delayed += 1;
    priorityDevDays += Number(t.priority_shift_days || 0);
    const dom = t.domain_id || 'sin';
    perDomain[dom] = perDomain[dom] || { count: 0, devDays: 0, priority: 0 };
    perDomain[dom].count += 1;
    perDomain[dom].devDays += d;
    if (t.is_priority) perDomain[dom].priority += 1;
  }

  const { rows: domains } = await pool.query('SELECT id, name FROM domains');
  const domainName = Object.fromEntries(domains.map((d) => [d.id, d.name]));

  res.json({
    total,
    byStatus,
    priority,
    delayed,
    onTime: total - delayed,
    totalDevDays,
    totalDevWeeks: +(totalDevDays / 7).toFixed(1),
    avgDevDays: total ? +(totalDevDays / total).toFixed(1) : 0,
    priorityDevDays,
    priorityDevWeeks: +(priorityDevDays / 7).toFixed(1),
    perDomain: Object.entries(perDomain).map(([id, v]) => ({
      domain: domainName[id] || 'Sin dominio',
      ...v,
      devWeeks: +(v.devDays / 7).toFixed(1),
    })),
  });
}));

// ====================== SINCRONIZACION CSV DE AZURE DEVOPS ======================
app.post('/api/tasks/sync-csv', wrap(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Se esperaba un arreglo de elementos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let createdCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      const devopsId = parseInt(item.devops_id, 10);
      if (isNaN(devopsId)) continue;

      const {
        name,
        owner = '',
        description = '',
        domain_id = null,
        status = 'backlog',
        scope_weeks = 2,
        start_date = null
      } = item;

      const { rows: existing } = await client.query(
        'SELECT id, start_date, planned_start FROM tasks WHERE devops_id = $1',
        [devopsId]
      );

      if (existing.length > 0) {
        await client.query(
          `UPDATE tasks SET 
             name = $2, 
             owner = $3, 
             description = $4, 
             domain_id = COALESCE($5, domain_id), 
             status = $6
           WHERE devops_id = $1`,
          [devopsId, name, owner, description, domain_id, status]
        );
        updatedCount++;
      } else {
        const color = await autoColor(client);
        const startDateVal = start_date || new Date().toISOString().slice(0, 10);

        await client.query(
          `INSERT INTO tasks (
             name, owner, description, domain_id, status, color, 
             is_priority, scope_weeks, baseline_start, start_date, planned_start, lane, devops_id
           ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8, $8, $8, 0, $9)`,
          [name, owner, description, domain_id, status, color, scope_weeks, startDateVal, devopsId]
        );
        createdCount++;
      }
    }

    await recomputeSchedule(client);
    await client.query('COMMIT');
    res.json({ message: `Sincronización finalizada: ${createdCount} creadas, ${updatedCount} actualizadas.` });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ====================== ARRANQUE / MIGRACION ======================
async function ensureSchema() {
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_start DATE');
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS devops_id INTEGER UNIQUE');
  await pool.query(
    'UPDATE tasks SET planned_start = start_date WHERE planned_start IS NULL AND start_date IS NOT NULL'
  );
  await recomputeSchedule(pool);
}

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, async () => {
  console.log('ProjecTyzer escuchando en :' + PORT);
  for (let i = 0; i < 15; i++) {
    try { await ensureSchema(); console.log('Esquema listo.'); break; }
    catch (e) { console.log('Esperando base de datos...', e.message); await new Promise((r) => setTimeout(r, 2000)); }
  }
});

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
  
  // Obtener la tarea actual
  const { rows: current } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (current.length === 0) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }
  const task = current[0];

  const name = f.name !== undefined ? f.name : task.name;
  const owner = f.owner !== undefined ? f.owner : task.owner;
  const description = f.description !== undefined ? f.description : task.description;
  const domain_id = f.domain_id !== undefined ? f.domain_id : task.domain_id;
  const status = f.status !== undefined ? f.status : task.status;
  const color = f.color !== undefined ? f.color : task.color;
  const scope_weeks = f.scope_weeks !== undefined ? f.scope_weeks : task.scope_weeks;
  const baseline_start = f.baseline_start !== undefined ? f.baseline_start : task.baseline_start;
  const lane = f.lane !== undefined ? f.lane : task.lane;

  let start_date = f.start_date !== undefined ? f.start_date : task.start_date;
  let planned_start = f.start_date !== undefined ? f.start_date : task.planned_start;

  // Si es backlog, limpiamos las fechas
  if (status === 'backlog') {
    start_date = null;
    planned_start = null;
  }

  // Convertir cadenas vacías o fechas tipo Date a formato de fecha YYYY-MM-DD
  const formatDate = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (typeof val === 'string') {
      if (val === '') return null;
      return val.slice(0, 10); // corta YYYY-MM-DD de un ISO string si viniera así
    }
    return val;
  };

  const formattedStartDate = formatDate(start_date);
  const formattedPlannedStart = formatDate(planned_start);
  const formattedBaselineStart = formatDate(baseline_start);

  const { rows } = await pool.query(
    `UPDATE tasks SET
       name = $2, owner = $3, description = $4, domain_id = $5,
       status = $6, color = $7, scope_weeks = $8, baseline_start = $9,
       start_date = $10, planned_start = $11, lane = $12
     WHERE id = $1 RETURNING *`,
    [req.params.id, name, owner, description, domain_id, status, color,
     scope_weeks, formattedBaselineStart, formattedStartDate, formattedPlannedStart, lane]
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
    `SELECT id, domain_id, start_date, scope_weeks FROM tasks
      WHERE is_priority = TRUE AND status <> 'ended' AND start_date IS NOT NULL`
  );
  const { rows: subs } = await db.query(
    `SELECT s.parent_task_id, s.domain_id, s.offset_weeks, s.scope_weeks
       FROM subtasks s JOIN tasks t ON s.parent_task_id = t.id
      WHERE t.is_priority = TRUE AND t.status <> 'ended' AND t.start_date IS NOT NULL AND s.domain_id IS NOT NULL`
  );

  const subsByParent = {};
  for (const s of subs) {
    subsByParent[s.parent_task_id] = subsByParent[s.parent_task_id] || [];
    subsByParent[s.parent_task_id].push(s);
  }

  const windows = [];
  for (const p of pris) {
    const parentStart = new Date(p.start_date);
    if (p.domain_id) {
      const s = new Date(parentStart);
      const e = addDays(s, durDays(p.scope_weeks));
      windows.push({ s, e, domains: new Set([p.domain_id]) });
    }
    const pSubs = subsByParent[p.id] || [];
    for (const sub of pSubs) {
      const s = addDays(parentStart, Math.round(Number(sub.offset_weeks) * 7));
      const e = addDays(s, durDays(sub.scope_weeks));
      windows.push({ s, e, domains: new Set([sub.domain_id]) });
    }
  }
  windows.sort((a, b) => a.s - b.s);

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

  // Resolver solapamientos de carriles (lanes) para todas las tareas en el tablero (doing y ended)
  const { rows: allBoardTasks } = await db.query(
    `SELECT id, domain_id, start_date, scope_weeks, priority_shift_days, lane FROM tasks
      WHERE is_priority = FALSE AND status IN ('doing', 'ended') AND start_date IS NOT NULL
      ORDER BY start_date ASC, id ASC`
  );

  const domainsTasks = {};
  for (const t of allBoardTasks) {
    if (!domainsTasks[t.domain_id]) domainsTasks[t.domain_id] = [];
    domainsTasks[t.domain_id].push(t);
  }

  for (const domainId in domainsTasks) {
    const dTasks = domainsTasks[domainId];
    const placedTasks = [];

    for (const t of dTasks) {
      const tStart = new Date(t.start_date);
      const tEnd = addDays(tStart, durDays(t.scope_weeks) + Number(t.priority_shift_days || 0));

      const originalLane = t.lane;
      let targetLane = t.lane;
      let checkedLanes = new Set();

      while (true) {
        const hasOverlap = placedTasks.some(p => {
          if (p.lane !== targetLane) return false;
          const pStart = new Date(p.start_date);
          const pEnd = addDays(pStart, durDays(p.scope_weeks) + Number(p.priority_shift_days || 0));
          return tStart < pEnd && tEnd > pStart;
        });

        if (!hasOverlap) {
          break;
        }

        checkedLanes.add(targetLane);
        if (!checkedLanes.has(0)) {
          targetLane = 0;
        } else {
          targetLane++;
          while (checkedLanes.has(targetLane)) {
            targetLane++;
          }
        }
      }

      t.lane = targetLane;
      placedTasks.push(t);

      if (targetLane !== originalLane) {
        await db.query(`UPDATE tasks SET lane = $2 WHERE id = $1`, [t.id, targetLane]);
      }
    }
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
    if (t.is_priority) {
      perDomain[dom].priority += 1;
    } else {
      perDomain[dom].count += 1;
      perDomain[dom].devDays += d;
    }
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
      domain: domainName[id] || 'Cross-dominio (Prioritarias)',
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
        const dbTask = existing[0];
        let newStartDate = dbTask.start_date;
        let newPlannedStart = dbTask.planned_start;

        if (status === 'backlog') {
          newStartDate = null;
          newPlannedStart = null;
        } else if (!newStartDate && (status === 'doing' || status === 'ended')) {
          newStartDate = start_date || new Date().toISOString().slice(0, 10);
          newPlannedStart = newStartDate;
        }

        await client.query(
          `UPDATE tasks SET 
             name = $2, 
             owner = $3, 
             description = $4, 
             domain_id = COALESCE($5, domain_id), 
             status = $6,
             scope_weeks = COALESCE($7, scope_weeks),
             start_date = $8,
             planned_start = $9
           WHERE devops_id = $1`,
          [devopsId, name, owner, description, domain_id, status, scope_weeks, newStartDate, newPlannedStart]
        );
        updatedCount++;
      } else {
        const color = await autoColor(client);
        let startDateVal = null;
        if (status === 'doing' || status === 'ended') {
          startDateVal = start_date || new Date().toISOString().slice(0, 10);
        }

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
  await pool.query('UPDATE tasks SET domain_id = NULL WHERE is_priority = TRUE');
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

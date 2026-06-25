# 05 – Lógica de prioridades y desviación

Este documento explica el corazón de ProjecTyzer: cómo una tarea **prioritaria (roja)** parte el trabajo programado y cómo se calcula la **desviación**.

## Principios

1. Una prioritaria ocupa una **ventana de tiempo** `[inicio, inicio + duración]`.
2. La ventana **solo afecta a ciertas horizontales (dominios)**: el dominio propio de la roja **más** los dominios de sus subrutinas. Pueden ser todas, una o dos. Las demás horizontales no se tocan.
3. Una tarea normal de una horizontal afectada que **cruce** la ventana se **parte**: se detiene al inicio de la roja y **reanuda** al terminarla.
4. El inicio de la tarea **no se mueve** (arranca a tiempo); solo se interrumpe y por eso **termina más tarde**.
5. Todo es **idempotente**: el cronograma se deriva siempre de `planned_start` + posición de las prioritarias. Mover o borrar una roja recompone el tablero sin desfases residuales.

## Duración de la ventana

La duración de la ventana de una prioritaria es:

```
duración_ventana = max( alcance_propio , max(offset_subtarea + alcance_subtarea) )
```

Es decir, abarca tanto el alcance de la roja como la extensión de sus subrutinas, para que el bloque rojo y el "hueco" en las tareas cortadas coincidan visualmente.

## Dominios afectados

```
dominios_afectados = { dominio_de_la_roja } ∪ { dominio_de_cada_subrutina }
```

Una tarea normal solo se parte si su `domain_id` está en ese conjunto. Lo mismo aplica a las subrutinas de tareas normales: cada subrutina se evalúa según **su** dominio.

## Algoritmo de segmentación

Dada una tarea con inicio `S` y duración `D` (días), y las ventanas prioritarias que afectan a su horizontal (ordenadas por inicio), se recorre un cursor:

```
cursor   = S
restante = D
segmentos = []

para cada ventana [Ps, Pe] que afecta a esta horizontal:
    si Pe <= cursor:            seguir            # ventana ya quedó atrás
    finActual = cursor + restante
    si Ps >= finActual:         terminar          # ventana después del trabajo
    si Ps <= cursor:            cursor = Pe; seguir  # arranca dentro → espera al fin
    antes = Ps - cursor
    segmentos.push([cursor, Ps])                  # tramo antes de la interrupción
    restante -= antes
    cursor = Pe                                    # reanuda tras la roja

segmentos.push([cursor, cursor + restante])        # tramo final
```

- Si no hay solapamiento, el resultado es **un** segmento (la tarea completa).
- Si la roja cae en medio, hay **dos** segmentos con un hueco (la roja) entre ellos.
- Varias prioritarias generan varios cortes.

Este algoritmo vive en **dos lugares con la misma regla**:

- **Frontend** (`segmentize()` en `app.js`): para **dibujar** los tramos. El primer tramo es arrastrable y editable; los tramos de continuación llevan el marcador **⏸**.
- **Backend** (`recomputeSchedule()` en `server.js`): para **medir** la interrupción y guardarla en `priority_shift_days`.

## Cálculo de la interrupción (backend)

```
fin_efectivo  = cursor + restante           # fin del último segmento
interrupción  = (fin_efectivo − planned_start) − D
priority_shift_days = max(0, interrupción)
start_date    = planned_start               # el inicio se mantiene
```

`recomputeSchedule()` se ejecuta tras cada `POST`/`PUT`/`DELETE` de tareas y al arrancar el servidor.

## Desviación (reportería)

La desviación de fin de una tarea combina dos fuentes:

```
desviación = (start_date − baseline_start)  +  priority_shift_days
             └── replanificación manual ──┘     └─ interrupciones ─┘
```

- **Replanificación manual**: cuando el usuario mueve una tarea a una fecha distinta de su línea base.
- **Interrupciones**: días que las prioritarias añadieron al partir la tarea.

La reportería expone ambas: `totalDevDays` (suma de todo) y `priorityDevDays` (solo interrupciones).

## Ejemplos

**Roja sin subrutinas, en Seguridad (2 semanas).** Solo corta las tareas de Seguridad que cruzan esas 2 semanas. Cada una se parte en dos y termina 2 semanas más tarde. Comunicaciones, Nube y Tierra no se afectan.

**Roja en Seguridad con subrutina en Nube.** Afecta a Seguridad y Nube. Las tareas de ambas horizontales que crucen la ventana se parten; Comunicaciones y Tierra siguen igual.

**Mover la roja a la izquierda hasta no solapar ninguna tarea.** Al recalcular, todas las tareas vuelven a un solo segmento (sin interrupción) y `priority_shift_days` vuelve a 0.

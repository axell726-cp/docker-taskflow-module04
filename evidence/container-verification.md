# Verificación real de Docker Compose

Capturada: 2026-11-10 03:35:52 -05:00
URL local comprobada: http://127.0.0.1:3004

## Construcción y ejecución

- `docker compose build`: completado; imagen `docker-taskflow-module04:local`, tamaño 61,360,026 bytes.
- `docker compose up -d`: completado.
- Inspección final: contenedor `taskflow-module04`, estado `running`, health `healthy`, usuario `node`.
- Publicación de puerto: `127.0.0.1:3004 -> 3000/tcp`; acceso limitado al host.
- Red: `docker-taskflow-module04_taskflow`, driver `bridge`.
- Volumen: `docker-taskflow-module04_taskflow-data`, driver `local`, montado en `/data`.
- Configuración observada dentro del contenedor: `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/data`.

## Pruebas HTTP realizadas

- Página `/`: HTTP 200.
- `GET /api/health`: HTTP 200; `{"status":"ok","storage":"json-file-volume"}`.
- Mutación con origen externo: HTTP 403.
- Título vacío: HTTP 400.
- Cuerpo mayor de 2 KB: HTTP 413.
- Crear tarea: HTTP 201.
- Listar pendientes: HTTP 200.
- Cambiar tarea a completada: HTTP 200.
- Estadísticas antes del reinicio: total 1, pendientes 0, completadas 1.
- Reiniciar servicio Compose: completado; el contenedor volvió a `healthy`.
- Consulta posterior al reinicio: la tarea completada seguía presente en el volumen.
- Eliminar tarea: HTTP 200; consulta final sin tareas.

## Estado final capturado

- Contenedor saludable y en ejecución.
- Volumen persistente conservado y con cero tareas de prueba.
- Imagen y estado detallados en `runtime-details.txt`.
- Logs reales y sanitizados en `compose-logs.txt`.
- Captura visual de la página en `taskflow-container.png`.

La aplicación es local y no está publicada en Internet. No se usó un servicio cloud ni se incurrió en costos cloud.

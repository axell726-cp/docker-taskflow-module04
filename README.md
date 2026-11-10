# TaskFlow — Module 04: Docker & Containerization

TaskFlow es una aplicación de tareas con frontend HTML/CSS/JavaScript y backend Node.js sin dependencias externas. Este módulo empaqueta la aplicación en una imagen Docker y la ejecuta con Docker Compose, una red bridge y un volumen persistente.

## Entregables

- GitHub: https://github.com/axell726-cp/docker-taskflow-module04
- Aplicación local con Compose: http://127.0.0.1:3004
- Evidencias de construcción, ejecución, pruebas y captura: `evidence/`

El puerto está vinculado a loopback y no se expone a Internet. No agregues datos personales ni secretos a las tareas.

## Objetivos del módulo

1. **Contenedores y máquinas virtuales.** Una VM virtualiza hardware y ejecuta un sistema operativo invitado completo. Un contenedor aísla procesos y comparte el kernel del host. Las imágenes definen capas reproducibles; el contenedor es la instancia en ejecución.
2. **Docker.** La CLI se comunica con Docker Engine. Engine construye/descarga imágenes y ejecuta contenedores aislados. Compose declara servicio, red, volumen, variables y límites en un archivo reproducible.
3. **Cadena de entrega ejecutada.** Código fuente → Dockerfile → imagen `docker-taskflow-module04:local` → contenedor `taskflow-module04` → Compose → app en `http://127.0.0.1:3004`.

## Componentes

- `server.mjs`: servidor HTTP Node.js y API REST, almacenamiento JSON con escritura atómica en `/data/tasks.json`.
- `public/`: HTML, CSS y JavaScript de TaskFlow, adaptados para la ejecución local.
- `Dockerfile`: `node:22-alpine`, archivos mínimos, usuario no root `node`, healthcheck y sin instalación de paquetes externos.
- `compose.yaml`: servicio `app`, red bridge `taskflow`, volumen nombrado `taskflow-data`, healthcheck, límites de CPU/memoria y políticas de endurecimiento.
- Variables del contenedor: `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/data`. El host usa `HOST_BIND=127.0.0.1` y `HOST_PORT=3004`. No se requieren secretos.

La red bridge conecta servicios dentro del host Docker. No es una VPC ni una red cloud.

## Ejecutar

Desde la raíz del repositorio:

```powershell
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Abre `http://127.0.0.1:3004`. Para revisar el servicio:

```powershell
docker compose logs --tail 50 app
docker compose exec app node --version
docker image inspect docker-taskflow-module04:local
docker volume inspect docker-taskflow-module04_taskflow-data
```

`docker compose down` conserva el volumen. Evita `docker compose down -v` si quieres conservar las tareas.

## API

- `GET /api/health`
- `GET /api/tasks?status=all|pending|completed`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/stats`

Los títulos se validan; el cuerpo tiene límite de 2 KB; las escrituras aplican un límite best-effort por cliente y rechazan mutaciones con origen distinto.

## Resultado verificado

El 10 de noviembre de 2026 se construyó la imagen y Compose dejó el contenedor en estado `running (healthy)`. Las pruebas HTTP confirmaron la página, salud, creación, listado, edición, estadísticas, persistencia después de reiniciar el contenedor y eliminación. Se comprobaron también rechazos HTTP 403, 400 y 413. El registro de prueba quedó vacío al finalizar.

- [Registro de pruebas y persistencia](evidence/container-verification.md)
- [Detalles reales de Docker, volumen, red y variables](evidence/runtime-details.txt)
- [Logs sanitizados](evidence/compose-logs.txt)
- [Captura de la aplicación ejecutándose](evidence/taskflow-container.png)
- [Salida real de construcción](evidence/build.txt)

## Alcance

La aplicación corre localmente en Docker; no se desplegó en un servicio cloud ni tiene una URL pública. No se modificó Module 03, VIRTUPRO ni DICSAR.

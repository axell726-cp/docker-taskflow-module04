import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = resolve(projectDirectory, "public");
const defaultDataDirectory = process.env.DATA_DIR || resolve(projectDirectory, "data");
const maxBodyBytes = 2048;
const writesByClient = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

function sendJson(response, body, status = 200) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { ...securityHeaders, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function routeName(path) {
  if (path === "/api/health") return "health";
  if (path === "/api/stats") return "stats";
  if (path === "/api/tasks") return "tasks";
  if (/^\/api\/tasks\/[^/]+$/.test(path)) return "task_item";
  return path.startsWith("/api/") ? "api_other" : "static";
}

async function writeTasks(dataFile, dataDirectory, tasks) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = dataFile + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporaryFile, JSON.stringify(tasks, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, dataFile);
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
}

async function readTasks(dataFile, dataDirectory) {
  await mkdir(dataDirectory, { recursive: true });
  try {
    const tasks = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(tasks)) throw new Error("Task store must contain a JSON array.");
    return tasks;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeTasks(dataFile, dataDirectory, []);
    return [];
  }
}

function parseJson(request) {
  if (!(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return Promise.reject(new HttpError(415, "Se requiere Content-Type application/json."));
  }
  if (Number(request.headers["content-length"] || 0) > maxBodyBytes) {
    return Promise.reject(new HttpError(413, "El cuerpo supera 2 KB."));
  }
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let length = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      length += chunk.length;
      if (length > maxBodyBytes) {
        rejected = true;
        request.resume();
        rejectBody(new HttpError(413, "El cuerpo supera 2 KB."));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { rejectBody(new HttpError(400, "JSON inválido.")); }
    });
    request.on("error", (error) => { if (!rejected) rejectBody(error); });
  });
}

function allowWrite(clientAddress) {
  const now = Date.now();
  const entry = writesByClient.get(clientAddress);
  if (!entry || entry.expiresAt <= now) {
    writesByClient.set(clientAddress, { count: 1, expiresAt: now + 60000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count += 1;
  if (writesByClient.size > 4096) {
    for (const [key, value] of writesByClient) if (value.expiresAt <= now) writesByClient.delete(key);
  }
  return true;
}

function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function createApi(dataDirectory) {
  const dataFile = resolve(dataDirectory, "tasks.json");
  let writeQueue = Promise.resolve();
  const mutate = (operation) => {
    const result = writeQueue.then(operation);
    writeQueue = result.catch(() => {});
    return result;
  };

  return async function handleApi(request, response, url) {
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/health") {
      await readTasks(dataFile, dataDirectory);
      return sendJson(response, { status: "ok", storage: "json-file-volume" });
    }
    if (request.method === "GET" && path === "/api/stats") {
      await writeQueue;
      const tasks = await readTasks(dataFile, dataDirectory);
      const completed = tasks.filter((task) => task.completed === 1).length;
      return sendJson(response, { total: tasks.length, pending: tasks.length - completed, completed });
    }
    if (request.method === "GET" && path === "/api/tasks") {
      const status = url.searchParams.get("status") || "all";
      if (!["all", "pending", "completed"].includes(status)) throw new HttpError(400, "Filtro inválido.");
      await writeQueue;
      let tasks = await readTasks(dataFile, dataDirectory);
      if (status === "pending") tasks = tasks.filter((task) => task.completed === 0);
      if (status === "completed") tasks = tasks.filter((task) => task.completed === 1);
      return sendJson(response, { tasks: tasks.slice(0, 200) });
    }
    if (path === "/api/tasks" && request.method === "POST") {
      if (request.headers.origin && request.headers.origin !== url.origin) throw new HttpError(403, "Origen no permitido.");
      if (!allowWrite(request.socket.remoteAddress || "unknown")) throw new HttpError(429, "Límite temporal de escritura alcanzado.");
      const body = await parseJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) {
        throw new HttpError(400, "El título debe tener entre 1 y 120 caracteres imprimibles.");
      }
      const task = await mutate(async () => {
        const tasks = await readTasks(dataFile, dataDirectory);
        const now = new Date().toISOString();
        const created = { id: randomUUID(), title, completed: 0, created_at: now, updated_at: now };
        tasks.unshift(created);
        await writeTasks(dataFile, dataDirectory, tasks);
        return created;
      });
      return sendJson(response, { task }, 201);
    }
    const item = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (item && !validId(item[1])) throw new HttpError(400, "Identificador inválido.");
    if (item && request.method === "PATCH") {
      if (request.headers.origin && request.headers.origin !== url.origin) throw new HttpError(403, "Origen no permitido.");
      if (!allowWrite(request.socket.remoteAddress || "unknown")) throw new HttpError(429, "Límite temporal de escritura alcanzado.");
      const body = await parseJson(request);
      if (typeof body.completed !== "boolean") throw new HttpError(400, "completed debe ser boolean.");
      const task = await mutate(async () => {
        const tasks = await readTasks(dataFile, dataDirectory);
        const found = tasks.find((entry) => entry.id === item[1]);
        if (!found) return null;
        found.completed = body.completed ? 1 : 0;
        found.updated_at = new Date().toISOString();
        await writeTasks(dataFile, dataDirectory, tasks);
        return found;
      });
      if (!task) throw new HttpError(404, "Tarea no encontrada.");
      return sendJson(response, { task });
    }
    if (item && request.method === "DELETE") {
      if (request.headers.origin && request.headers.origin !== url.origin) throw new HttpError(403, "Origen no permitido.");
      if (!allowWrite(request.socket.remoteAddress || "unknown")) throw new HttpError(429, "Límite temporal de escritura alcanzado.");
      const deleted = await mutate(async () => {
        const tasks = await readTasks(dataFile, dataDirectory);
        const index = tasks.findIndex((entry) => entry.id === item[1]);
        if (index === -1) return false;
        tasks.splice(index, 1);
        await writeTasks(dataFile, dataDirectory, tasks);
        return true;
      });
      if (!deleted) throw new HttpError(404, "Tarea no encontrada.");
      return sendJson(response, { deleted: true, id: item[1] });
    }
    if (path.startsWith("/api/")) throw new HttpError(404, "Endpoint no encontrado.");
    return false;
  };
}

const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método no permitido.");
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); }
  catch { throw new HttpError(400, "Ruta inválida."); }
  const filePath = resolve(publicDirectory, decodedPath === "/" ? "index.html" : decodedPath.slice(1));
  if (filePath !== publicDirectory && !filePath.startsWith(publicDirectory + sep)) throw new HttpError(404, "Archivo no encontrado.");
  let info;
  try { info = await stat(filePath); }
  catch { throw new HttpError(404, "Archivo no encontrado."); }
  if (!info.isFile()) throw new HttpError(404, "Archivo no encontrado.");
  const content = await readFile(filePath);
  response.writeHead(200, {
    ...securityHeaders,
    "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "content-length": content.length,
    "cache-control": "public, max-age=300"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

export function createAppServer(options = {}) {
  const dataDirectory = resolve(options.dataDirectory || defaultDataDirectory);
  const handleApi = createApi(dataDirectory);
  return createServer(async (request, response) => {
    const started = Date.now();
    const requestId = randomUUID();
    let route = "other";
    response.on("finish", () => console.log(JSON.stringify({
      event: "http_request",
      requestId,
      method: request.method,
      route,
      status: response.statusCode,
      durationMs: Date.now() - started
    })));
    try {
      const url = new URL(request.url || "/", "http://" + (request.headers.host || "localhost"));
      route = routeName(url.pathname);
      if (await handleApi(request, response, url) === false) await serveStatic(request, response, url);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: "request_error", requestId, route, error: error instanceof Error ? error.name : "unknown" }));
      sendJson(response, { error: error instanceof HttpError ? error.message : "Error interno. Intenta más tarde.", requestId }, status);
    }
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer between 0 and 65535.");
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    const address = server.address();
    console.log(JSON.stringify({ event: "server_started", port: typeof address === "object" ? address.port : port, storage: "json-file-volume" }));
  });
}

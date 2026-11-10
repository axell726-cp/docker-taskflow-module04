const state = { filter: "all", tasks: [], busy: false };
const list = document.querySelector("#task-list"), empty = document.querySelector("#empty-state");
const form = document.querySelector("#task-form"), input = document.querySelector("#task-title"), toast = document.querySelector("#toast");
let toastTimer;
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la solicitud.");
  return body;
}
function notify(message, isError = false) {
  toast.textContent = message; toast.classList.toggle("is-error", isError); toast.classList.add("is-visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}
function render() {
  list.replaceChildren();
  for (const task of state.tasks) {
    const item = document.createElement("li");
    item.className = "task-item" + (task.completed ? " is-completed" : "");
    const complete = document.createElement("button");
    complete.className = "complete-button"; complete.type = "button"; complete.dataset.action = "toggle"; complete.dataset.id = task.id;
    complete.setAttribute("aria-label", task.completed ? "Marcar como pendiente" : "Marcar como completada");
    complete.setAttribute("aria-pressed", String(Boolean(task.completed))); complete.textContent = "✓";
    const title = document.createElement("span"); title.className = "task-title"; title.textContent = task.title;
    const date = document.createElement("time"); date.className = "task-date"; date.dateTime = task.created_at;
    date.textContent = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(new Date(task.created_at));
    const remove = document.createElement("button"); remove.className = "delete-button"; remove.type = "button";
    remove.dataset.action = "delete"; remove.dataset.id = task.id; remove.setAttribute("aria-label", "Eliminar " + task.title); remove.textContent = "×";
    item.append(complete, title, date, remove); list.append(item);
  }
  empty.classList.toggle("is-visible", state.tasks.length === 0);
  document.querySelector("#task-count").textContent = state.tasks.length + (state.tasks.length === 1 ? " tarea" : " tareas");
}
async function refresh() {
  const results = await Promise.all([api("/api/tasks?status=" + encodeURIComponent(state.filter)), api("/api/stats")]);
  state.tasks = results[0].tasks; render();
  document.querySelector("#stat-total").textContent = results[1].total;
  document.querySelector("#stat-pending").textContent = results[1].pending;
  document.querySelector("#stat-completed").textContent = results[1].completed;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.busy) return;
  const title = input.value.trim(); if (!title) return;
  state.busy = true;
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title }) });
    input.value = ""; if (state.filter !== "all" && state.filter !== "pending") setFilter("pending");
    await refresh(); notify("Tarea añadida"); input.focus();
  } catch (error) { notify(error.message, true); }
  finally { state.busy = false; }
});
function setFilter(filter) {
  state.filter = filter;
  for (const button of document.querySelectorAll(".filter-button")) {
    const active = button.dataset.filter === filter; button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
document.querySelector(".filters").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-filter]"); if (!button) return;
  setFilter(button.dataset.filter);
  try { await refresh(); } catch (error) { notify(error.message, true); }
});
list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]"); if (!button || state.busy) return;
  state.busy = true;
  try {
    if (button.dataset.action === "toggle") {
      const task = state.tasks.find((entry) => entry.id === button.dataset.id);
      await api("/api/tasks/" + button.dataset.id, { method: "PATCH", body: JSON.stringify({ completed: !Boolean(task.completed) }) });
    } else await api("/api/tasks/" + button.dataset.id, { method: "DELETE" });
    await refresh(); notify(button.dataset.action === "delete" ? "Tarea eliminada" : "Estado actualizado");
  } catch (error) { notify(error.message, true); }
  finally { state.busy = false; }
});
refresh().catch((error) => { document.querySelector("#list-message").textContent = "Sin conexión"; notify(error.message, true); });

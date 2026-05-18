async function refresh() {
  const response = await fetch("/api/dashboard/today");
  const data = await response.json();

  document.querySelector("#recordings").textContent = data.stats.recordings;
  document.querySelector("#processing").textContent = data.stats.processing;
  document.querySelector("#pending").textContent = data.stats.pendingTasks;
  document.querySelector("#summary").textContent = data.latest?.summary ?? "No processed recordings yet.";

  renderList("#tasks", data.tasks.filter((task) => task.status === "pending_confirm").map((task) => task.title));
  renderList("#decisions", data.latest?.decisions ?? []);
  renderList("#questions", data.latest?.open_questions ?? []);
}

function renderList(selector, items) {
  const list = document.querySelector(selector);
  list.replaceChildren(
    ...(items.length ? items : ["None"]).map((item) => {
      const element = document.createElement("li");
      element.textContent = item;
      return element;
    })
  );
}

document.querySelector("#refresh").addEventListener("click", refresh);
refresh();

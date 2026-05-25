const port = Number(process.env.PORT ?? 5174);
const healthUrl = `http://127.0.0.1:${port}/api/health`;

async function isDashboardRunning() {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

if (await isDashboardRunning()) {
  console.log(`Recording dashboard already running at http://localhost:${port}`);
} else {
  await import("../src/index.js");
}

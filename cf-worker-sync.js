// Cloudflare Worker 定时触发 CLIProxyAPI 上游数据同步
// 部署到 CF Worker 后，配置 Cron 触发（如 */15 * * * *）
// 可使用环境变量：DASHBOARD_URL、PASSWORD（或 CLIPROXY_SECRET_KEY）或直接修改下方常量

const DEFAULT_URL = "https://your-domain.vercel.app";
const PASSWORD = "";

function normalizeUrl(raw) {
  return (raw || DEFAULT_URL).replace(/\/$/, "");
}

const worker = {
  async scheduled(event, env) {
    const dashboardUrl = normalizeUrl(env?.DASHBOARD_URL || globalThis.DASHBOARD_URL);
    const password = env?.PASSWORD || env?.CLIPROXY_SECRET_KEY || PASSWORD;

    if (!dashboardUrl || dashboardUrl.includes("your-domain")) {
      console.error("Set DASHBOARD_URL env or replace placeholder in cf-worker-sync.js");
      return;
    }

    if (!password) {
      console.error("Set PASSWORD env (or CLIPROXY_SECRET_KEY) for Authorization Bearer");
      return;
    }

    const url = `${dashboardUrl}/api/sync`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${password}` }
    });

    if (!res.ok) {
      console.error(`Sync failed: ${res.status} ${res.statusText}`);
    }
  }
};

export default worker;

/**
 * Mock Data Engine — Simulates server metrics for the dashboard.
 * Bridge module: swap with real API/WebSocket in Phase 4.
 *
 * @module mock/data-engine
 */

const state = {
  cpu: { percent: 12.5, cores: 8, threads: 16, load_avg: { '1min': 0.82, '5min': 1.15, '15min': 1.42 } },
  memory: { percent: 41.6, used_gb: 3.2, total_gb: 7.7 },
  disks: [
    { mount: '/', used_gb: 28, total_gb: 50, percent: 60 },
    { mount: '/home', used_gb: 145, total_gb: 200, percent: 72.5 },
    { mount: '/var', used_gb: 12, total_gb: 30, percent: 40 },
  ],
  network: { speed_down_kbs: 1024, speed_up_kbs: 256, total_down_gb: 128.5, total_up_gb: 45.2 },
  uptime_seconds: 432000,
  hostname: 'ling-srv01',
  swap: { used_gb: 0.5, total_gb: 2.0, percent: 25 },
};

const history = {
  cpu: Array.from({ length: 15 }, () => 8 + Math.random() * 20),
  mem: Array.from({ length: 15 }, () => 35 + Math.random() * 15),
  disk: Array.from({ length: 15 }, () => 55 + Math.random() * 12),
  net: Array.from({ length: 15 }, () => 0.5 + Math.random() * 2.5),
  load: Array.from({ length: 15 }, () => 0.5 + Math.random() * 1.5),
};

let _timer = null;
let _onTick = null;

function tick() {
  state.cpu.percent = Math.max(1, Math.min(98, state.cpu.percent + (Math.random() - 0.48) * 6));
  state.cpu.load_avg['1min'] = Math.max(0.1, state.cpu.percent / 15 + (Math.random() - 0.5) * 0.3);
  state.cpu.load_avg['5min'] = state.cpu.load_avg['1min'] * (0.85 + Math.random() * 0.3);
  state.cpu.load_avg['15min'] = state.cpu.load_avg['5min'] * (0.7 + Math.random() * 0.5);

  state.memory.percent = Math.max(10, Math.min(95, state.memory.percent + (Math.random() - 0.5) * 2));
  state.memory.used_gb = +(state.memory.total_gb * state.memory.percent / 100).toFixed(1);

  state.network.speed_down_kbs = Math.max(10, 1024 + (Math.random() - 0.5) * 800);
  state.network.speed_up_kbs = Math.max(5, 256 + (Math.random() - 0.5) * 200);
  state.network.total_down_gb = +(state.network.total_down_gb + state.network.speed_down_kbs / 1024 / 1024).toFixed(1);
  state.network.total_up_gb = +(state.network.total_up_gb + state.network.speed_up_kbs / 1024 / 1024).toFixed(1);

  state.uptime_seconds += 1;

  history.cpu.push(state.cpu.percent); history.cpu.shift();
  history.mem.push(state.memory.percent); history.mem.shift();
  history.disk.push(state.disks[0].percent); history.disk.shift();
  history.net.push(state.network.speed_down_kbs / 1024); history.net.shift();
  history.load.push(state.cpu.load_avg['1min']); history.load.shift();

  state.disks[0].percent = Math.max(5, Math.min(98, state.disks[0].percent + (Math.random() - 0.5) * 0.3));
  state.disks[0].used_gb = +(state.disks[0].total_gb * state.disks[0].percent / 100).toFixed(1);

  if (_onTick) _onTick(state);

  _timer = setTimeout(tick, 1000);
}

export function start(onTick) {
  _onTick = onTick || null;
  _timer = setTimeout(tick, 500);
}

export function stop() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

export function getState() { return state; }
export function getHistory() { return history; }

// ── Tab-specific mock generators ──

const PROCESS_NAMES = ['python', 'node', 'nginx', 'mysqld', 'postgres', 'redis-server', 'sshd', 'systemd-journal', 'containerd', 'dockerd', 'java', 'prometheus', 'grafana-server', 'promtail', 'loki', 'gunicorn', 'celery', 'supervisord', 'cron', 'rsyslogd'];
const USERS = ['root', 'admin', 'www-data', 'postgres', 'redis', 'mysql', 'systemd'];
const STATUSES = ['running', 'sleeping', 'running', 'running', 'running', 'zombie'];

export function generateMockProcesses(count = 67) {
  const procs = [];
  for (let i = 0; i < count; i++) {
    procs.push({
      pid: 1000 + i + Math.floor(Math.random() * 30000),
      name: PROCESS_NAMES[Math.floor(Math.random() * PROCESS_NAMES.length)],
      cpu_percent: +(Math.random() * 45).toFixed(1),
      mem_percent: +(Math.random() * 8).toFixed(1),
      user: USERS[Math.floor(Math.random() * USERS.length)],
      status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
      uptime: Math.floor(Math.random() * 86400 * 7),
    });
  }
  procs.sort((a, b) => b.cpu_percent - a.cpu_percent);
  return procs;
}

export function generateMockServices() {
  return [
    { name: 'nginx', desc: 'Web 服务器', status: 'active' },
    { name: 'mysql', desc: '数据库服务', status: 'active' },
    { name: 'docker', desc: '容器引擎', status: 'active' },
    { name: 'sshd', desc: 'SSH 守护进程', status: 'active' },
    { name: 'cron', desc: '定时任务', status: 'active' },
    { name: 'prometheus', desc: '监控采集', status: 'inactive' },
  ];
}

export function generateMockContainers() {
  return [
    { id: 'a1b2c3d4e5f6', name: 'ling-nginx', image: 'nginx:alpine', status: 'running', ports: '80:8080', created: '2026-06-10 08:00' },
    { id: 'b2c3d4e5f6a1', name: 'ling-api', image: 'node:20-alpine', status: 'running', ports: '3000:3000', created: '2026-06-10 08:01' },
    { id: 'c3d4e5f6a1b2', name: 'ling-db', image: 'postgres:16', status: 'running', ports: '5432:5432', created: '2026-06-09 14:20' },
    { id: 'd4e5f6a1b2c3', name: 'ling-redis', image: 'redis:7-alpine', status: 'running', ports: '6379:6379', created: '2026-06-09 14:21' },
    { id: 'e5f6a1b2c3d4', name: 'ling-prometheus', image: 'prom/prometheus', status: 'running', ports: '9090:9090', created: '2026-06-08 10:00' },
    { id: 'f6a1b2c3d4e5', name: 'ling-grafana', image: 'grafana/grafana', status: 'running', ports: '3001:3000', created: '2026-06-08 10:01' },
    { id: 'a1b2c3d4e5f7', name: 'ling-builder', image: 'docker:cli', status: 'exited', ports: '-', created: '2026-06-05 16:00' },
    { id: 'b2c3d4e5f6a8', name: 'ling-cron', image: 'alpine:3.19', status: 'running', ports: '-', created: '2026-06-01 00:00' },
  ];
}

export function generateMockImages() {
  return [
    { id: 'sha256:abc123def456', tag: 'nginx:alpine', size: '42MB', created: '2026-06-10' },
    { id: 'sha256:bcd234efg567', tag: 'node:20-alpine', size: '118MB', created: '2026-06-10' },
    { id: 'sha256:cde345fgh678', tag: 'postgres:16', size: '148MB', created: '2026-06-09' },
    { id: 'sha256:def456ghi789', tag: 'redis:7-alpine', size: '30MB', created: '2026-06-09' },
    { id: 'sha256:efg567hij890', tag: 'prom/prometheus', size: '92MB', created: '2026-06-08' },
    { id: 'sha256:fgh678ijk901', tag: 'grafana/grafana', size: '85MB', created: '2026-06-08' },
    { id: 'sha256:ghi789jkl012', tag: 'docker:cli', size: '25MB', created: '2026-06-05' },
    { id: 'sha256:hij890klm123', tag: 'alpine:3.19', size: '7MB', created: '2026-06-01' },
  ];
}

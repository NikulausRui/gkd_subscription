import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    if (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined) {
      args.set(arg.slice(2), true);
    } else {
      args.set(arg.slice(2), process.argv[i + 1]);
      i += 1;
    }
  }
}

const sourcesPath = path.resolve(ROOT, args.get('sources') ?? 'sources.json');
const packagesPath = path.resolve(ROOT, args.get('packages') ?? 'packages_all.txt');
const outDir = path.resolve(ROOT, args.get('out') ?? 'dist');
const workDir = path.resolve(ROOT, args.get('workdir') ?? '.cache/gkd-repos');
const noBuild = args.has('no-build');
const skipUpdate = args.has('skip-update');

function run(command, commandArgs, options = {}) {
  if (!options.capture) {
    console.log(`$ ${command} ${commandArgs.join(' ')}`);
  }
  return execFileSync(command, commandArgs, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function safeName(source) {
  return `${source.name}-${source.branch}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function parseJson5Like(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return vm.runInNewContext(`(${text})`, Object.create(null), {
    filename: filePath,
    timeout: 3000,
  });
}

function readInstalledPackages(filePath) {
  return new Set(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^package:/, ''))
      .filter(Boolean),
  );
}

function countRules(rules) {
  if (!rules) return 0;
  if (Array.isArray(rules)) {
    return rules.reduce((sum, rule) => sum + countRules(rule), 0);
  }
  if (typeof rules === 'object') return 1;
  return 1;
}

function countUrls(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') return 1;
  return 0;
}

function appRichness(app) {
  const groups = Array.isArray(app.groups) ? app.groups : [];
  let ruleCount = 0;
  let urlCount = 0;
  for (const group of groups) {
    const rules = Array.isArray(group.rules) ? group.rules : group.rules ? [group.rules] : [];
    ruleCount += countRules(group.rules);
    urlCount += countUrls(group.snapshotUrls) + countUrls(group.exampleUrls);
    for (const rule of rules) {
      if (rule && typeof rule === 'object') {
        urlCount += countUrls(rule.snapshotUrls) + countUrls(rule.exampleUrls);
      }
    }
  }
  return {
    groups: groups.length,
    rules: ruleCount,
    urls: urlCount,
    score: groups.length * 1000 + ruleCount * 30 + urlCount * 3,
  };
}

function gitTimestamp(repoDir, relFile) {
  try {
    const args = ['log', '-1', '--format=%ct'];
    if (relFile) args.push('--', relFile);
    const output = run('git', args, { cwd: repoDir, capture: true }).trim();
    return Number(output) || 0;
  } catch {
    try {
      return Number(run('git', ['log', '-1', '--format=%ct'], { cwd: repoDir, capture: true }).trim()) || 0;
    } catch {
      return 0;
    }
  }
}

function subscriptionVersion(sub) {
  return Number(sub.version) || 0;
}

function cloneOrUpdate(source, repoDir) {
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    if (skipUpdate) return;
    run('git', ['fetch', 'origin', source.branch, '--depth', '50'], { cwd: repoDir });
    run('git', ['checkout', source.branch], { cwd: repoDir });
    run('git', ['reset', '--hard', `origin/${source.branch}`], { cwd: repoDir });
    return;
  }
  fs.mkdirSync(path.dirname(repoDir), { recursive: true });
  run('git', ['clone', '--branch', source.branch, '--depth', '50', source.repo, repoDir]);
}

function buildRepo(repoDir) {
  const packageJsonPath = path.join(repoDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return;
  if (noBuild) return;
  if (fs.existsSync(path.join(repoDir, 'bun.lock'))) {
    run('bun', ['install', '--frozen-lockfile'], { cwd: repoDir });
    run('bun', ['run', 'build'], { cwd: repoDir });
  } else if (fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'))) {
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: repoDir });
    run('pnpm', ['run', 'build'], { cwd: repoDir });
  } else {
    run('npm', ['install'], { cwd: repoDir });
    run('npm', ['run', 'build'], { cwd: repoDir });
  }
}

function findDist(source, repoDir) {
  const explicit = path.join(repoDir, source.dist);
  if (fs.existsSync(explicit)) return explicit;
  const packageJsonPath = path.join(repoDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.gkd?.outDir && pkg.gkd?.file) {
      const fromPkg = path.join(repoDir, pkg.gkd.outDir, pkg.gkd.file);
      if (fs.existsSync(fromPkg)) return fromPkg;
    }
  }
  const distDir = path.join(repoDir, 'dist');
  if (!fs.existsSync(distDir)) return undefined;
  return fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json5') && !entry.name.includes('version'))
    .map((entry) => path.join(distDir, entry.name))[0];
}

function normalizeApp(app) {
  const normalized = structuredClone(app);
  if (Array.isArray(normalized.groups)) {
    normalized.groups = normalized.groups.map((group, index) => ({
      ...group,
      key: index,
    }));
  }
  return normalized;
}

function chooseApp(current, candidate) {
  if (!current) return candidate;
  if (candidate.timestamp !== current.timestamp) {
    return candidate.timestamp > current.timestamp ? candidate : current;
  }
  if (candidate.richness.score !== current.richness.score) {
    return candidate.richness.score > current.richness.score ? candidate : current;
  }
  return candidate.sourceName.localeCompare(current.sourceName) < 0 ? candidate : current;
}

const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
const installed = readInstalledPackages(packagesPath);
const selectedByPackage = new Map();
const sourceStats = [];

for (const source of sources) {
  const repoDir = path.join(workDir, safeName(source));
  cloneOrUpdate(source, repoDir);

  let distPath = findDist(source, repoDir);
  if (!distPath) {
    buildRepo(repoDir);
    distPath = findDist(source, repoDir);
  }
  if (!distPath) {
    console.warn(`Skip ${source.name}: no dist json5 found`);
    continue;
  }

  const subscription = parseJson5Like(distPath);
  const apps = Array.isArray(subscription.apps) ? subscription.apps : [];
  let matched = 0;
  let selected = 0;

  for (const app of apps) {
    if (!app?.id || !installed.has(app.id)) continue;
    matched += 1;
    const relAppFile = path.join('src', 'apps', `${app.id}.ts`).replaceAll('\\', '/');
    const timestamp = gitTimestamp(repoDir, relAppFile);
    const richness = appRichness(app);
    const candidate = {
      app: normalizeApp(app),
      sourceName: source.name,
      sourceRepo: source.repo,
      subscriptionName: subscription.name,
      subscriptionVersion: subscriptionVersion(subscription),
      timestamp,
      richness,
    };
    const winner = chooseApp(selectedByPackage.get(app.id), candidate);
    if (winner === candidate) selected += 1;
    selectedByPackage.set(app.id, winner);
  }

  sourceStats.push({
    source: source.name,
    dist: path.relative(ROOT, distPath),
    subscription: subscription.name,
    version: subscriptionVersion(subscription),
    apps: apps.length,
    matched,
    selected,
  });
}

const categories = [
  { key: 0, name: '开屏广告' },
  { key: 1, name: '青少年模式', enable: false },
  { key: 2, name: '更新提示', enable: false },
  { key: 3, name: '评价提示', enable: false },
  { key: 4, name: '通知提示', enable: false },
  { key: 5, name: '权限提示', enable: false },
  { key: 6, name: '局部广告', enable: false },
  { key: 7, name: '全屏广告', enable: false },
  { key: 8, name: '分段广告', enable: false },
  { key: 9, name: '功能类', enable: false },
  { key: 10, name: '其他', enable: false },
];

const apps = [...selectedByPackage.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, value]) => value.app);

const now = new Date();
const merged = {
  id: 9527,
  name: 'GKD 手机应用精简合并订阅',
  version: Number(
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`,
  ),
  author: 'local-merge',
  checkUpdateUrl: './merged-gkd.version.json5',
  supportUri: 'https://github.com/',
  categories,
  globalGroups: [],
  apps,
};

const metadata = {
  generatedAt: now.toISOString(),
  installedPackageCount: installed.size,
  selectedAppCount: apps.length,
  sources: sourceStats,
  selectedSources: [...selectedByPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => ({
      id,
      source: value.sourceName,
      subscription: value.subscriptionName,
      timestamp: value.timestamp,
      richness: value.richness,
    })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'merged-gkd.json5'), `${JSON.stringify(merged, null, 2)}\n`);
fs.writeFileSync(
  path.join(outDir, 'merged-gkd.version.json5'),
  `${JSON.stringify({ id: merged.id, version: merged.version, name: merged.name }, null, 2)}\n`,
);
fs.writeFileSync(path.join(outDir, 'merge-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`Merged ${apps.length} installed app rules into ${path.join(outDir, 'merged-gkd.json5')}`);
for (const stat of sourceStats) {
  console.log(`${stat.source}: apps=${stat.apps}, matched=${stat.matched}, selected=${stat.selected}, version=${stat.version}`);
}

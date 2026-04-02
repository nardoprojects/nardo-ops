export const dynamic = 'force-dynamic'

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import AutoRefresh from './components/AutoRefresh'
import LiveClock from './components/LiveClock'

interface Task {
  id: number
  title: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  due: string
  category: string
}

interface Job {
  id: string
  status: string
  value?: number
  nardo_margin?: number
  pipeline_value?: number
  margin?: number
  total_value?: number
  job_value?: number
  [key: string]: unknown
}

interface CommitItem {
  hash: string
  date: string
  message: string
}

interface RepoSnapshot {
  key: string
  label: string
  repoPath: string
  exists: boolean
  branch: string | null
  dirty: boolean
  changedFilesCount: number
  lastCommit: CommitItem | null
  recentCommits: CommitItem[]
  packageName: string | null
}

interface DocSnapshot {
  key: string
  label: string
  filePath: string
  exists: boolean
  updatedAt: string | null
  excerpt: string | null
}

function getWorkspaceRoot() {
  return path.resolve(process.cwd(), '..')
}

function runCommand(command: string, cwd?: string) {
  try {
    return execSync(command, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

async function getJobs(): Promise<Job[]> {
  try {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    if (!url || !key) return []

    const res = await fetch(`${url}/rest/v1/jobs?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

function getTasks(): Task[] {
  try {
    const filePath = path.join(process.cwd(), 'data', 'tasks.json')
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Task[]
  } catch {
    return []
  }
}

function getRepoSnapshot(key: string, label: string, repoPath: string): RepoSnapshot {
  const exists = fs.existsSync(repoPath)

  if (!exists) {
    return {
      key,
      label,
      repoPath,
      exists: false,
      branch: null,
      dirty: false,
      changedFilesCount: 0,
      lastCommit: null,
      recentCommits: [],
      packageName: null,
    }
  }

  const branch = runCommand('git branch --show-current', repoPath) || null
  const statusLines = runCommand('git status --short', repoPath)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const lastCommitRaw = runCommand("git log -1 --pretty=format:'%H||%aI||%s'", repoPath)
  const recentCommitsRaw = runCommand("git log -5 --pretty=format:'%H||%aI||%s'", repoPath)

  const parseCommit = (line: string): CommitItem | null => {
    if (!line) return null
    const [hash, date, message] = line.split('||')
    if (!hash || !date || !message) return null
    return { hash, date, message }
  }

  let packageName: string | null = null
  try {
    const packageJsonPath = path.join(repoPath, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string }
      packageName = pkg.name ?? null
    }
  } catch {
    packageName = null
  }

  return {
    key,
    label,
    repoPath,
    exists,
    branch,
    dirty: statusLines.length > 0,
    changedFilesCount: statusLines.length,
    lastCommit: parseCommit(lastCommitRaw),
    recentCommits: recentCommitsRaw.split('\n').map(parseCommit).filter((item): item is CommitItem => item !== null),
    packageName,
  }
}

function getDocSnapshot(key: string, label: string, filePath: string): DocSnapshot {
  const exists = fs.existsSync(filePath)
  if (!exists) {
    return { key, label, filePath, exists: false, updatedAt: null, excerpt: null }
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const stat = fs.statSync(filePath)
  const excerpt = content
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))

  return {
    key,
    label,
    filePath,
    exists,
    updatedAt: stat.mtime.toISOString(),
    excerpt: excerpt ?? null,
  }
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDateTime(input?: string | null) {
  if (!input) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Sydney',
  }).format(new Date(input))
}

function formatRelative(input?: string | null) {
  if (!input) return 'unknown'
  const diffMs = Date.now() - new Date(input).getTime()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'just now'
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  const diffWeeks = Math.round(diffDays / 7)
  return `${diffWeeks}w ago`
}

function getStatusTone(status: 'active' | 'planned' | 'blueprint' | 'missing') {
  if (status === 'active') return { text: '#8dc63f', bg: '#8dc63f22', border: '#8dc63f55' }
  if (status === 'planned') return { text: '#f5c451', bg: '#f5c45122', border: '#f5c45155' }
  if (status === 'blueprint') return { text: '#6aa7ff', bg: '#6aa7ff22', border: '#6aa7ff55' }
  return { text: '#888888', bg: '#2a2a2a', border: '#3a3a3a' }
}

export default async function DashboardPage() {
  const workspaceRoot = getWorkspaceRoot()
  const nowIso = new Date().toISOString()

  const repoSnapshots = [
    getRepoSnapshot('crm', 'CRM', path.join(workspaceRoot, 'nardo-crm')),
    getRepoSnapshot('ops', 'Ops Dashboard', path.join(workspaceRoot, 'nardo-ops')),
    getRepoSnapshot('estimator', 'Estimator', path.join(workspaceRoot, 'nardo-estimator')),
  ]

  const docSnapshots = [
    getDocSnapshot('calendar-plan', 'CRM calendar / trade bookings plan', path.join(workspaceRoot, 'CRM_CALENDAR_PLAN.md')),
    getDocSnapshot('estimator-plan', 'Estimator blueprint', path.join(workspaceRoot, 'ESTIMATOR_BLUEPRINT.md')),
    getDocSnapshot('ops-plan', 'Ops dashboard plan', path.join(workspaceRoot, 'NARDO_OPS_PLAN.md')),
  ]

  const [jobs, tasks] = await Promise.all([getJobs(), Promise.resolve(getTasks())])

  const totalJobs = jobs.length
  const totalValue = jobs.reduce((sum, j) => {
    const value = (j.value ?? j.pipeline_value ?? j.total_value ?? j.job_value ?? 0) as number
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
  const totalMargin = jobs.reduce((sum, j) => {
    const margin = (j.nardo_margin ?? j.margin ?? 0) as number
    return sum + (typeof margin === 'number' ? margin : 0)
  }, 0)

  const statusLabels = ['received', 'dispatched', 'in_progress', 'completed', 'invoiced']
  const statusCounts: Record<string, number> = Object.fromEntries(statusLabels.map(label => [label, 0]))
  for (const job of jobs) {
    const label = (job.status ?? '').toLowerCase().replaceAll(' ', '_')
    statusCounts[label] = (statusCounts[label] ?? 0) + 1
  }

  const completedTasks = tasks.filter(task => task.status === 'completed')
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress')
  const pendingTasks = tasks.filter(task => task.status === 'pending')
  const highPriorityTasks = tasks.filter(task => task.priority === 'high' && task.status !== 'completed')
  const overdueTasks = pendingTasks.filter(task => new Date(task.due).getTime() < Date.now())

  const crmRepo = repoSnapshots.find(repo => repo.key === 'crm')
  const opsRepo = repoSnapshots.find(repo => repo.key === 'ops')
  const estimatorRepo = repoSnapshots.find(repo => repo.key === 'estimator')
  const calendarPlan = docSnapshots.find(doc => doc.key === 'calendar-plan')
  const estimatorPlan = docSnapshots.find(doc => doc.key === 'estimator-plan')
  const opsPlan = docSnapshots.find(doc => doc.key === 'ops-plan')

  const modules: Array<{
    key: string
    name: string
    status: 'active' | 'planned' | 'blueprint' | 'missing'
    summary: string
    detail: string
    source: string
  }> = [
    {
      key: 'crm',
      name: 'CRM',
      status: crmRepo?.exists ? 'active' : 'missing',
      summary: crmRepo?.exists
        ? crmRepo.lastCommit?.message ?? 'CRM repo available'
        : 'CRM repo missing from workspace',
      detail: crmRepo?.exists
        ? `${crmRepo.dirty ? `${crmRepo.changedFilesCount} local change${crmRepo.changedFilesCount === 1 ? '' : 's'}` : 'working tree clean'} · last commit ${formatRelative(crmRepo.lastCommit?.date)}`
        : 'No local repo found',
      source: jobs.length > 0 ? 'Local git + live CRM jobs' : 'Local git snapshot',
    },
    {
      key: 'calendar',
      name: 'Calendar / Trade Bookings',
      status: calendarPlan?.exists ? 'planned' : 'missing',
      summary: crmRepo?.lastCommit?.message?.toLowerCase().includes('calendar') || crmRepo?.lastCommit?.message?.toLowerCase().includes('booking')
        ? crmRepo?.lastCommit?.message ?? 'Recent calendar activity found'
        : calendarPlan?.excerpt ?? 'Plan exists but no dedicated live module yet',
      detail: calendarPlan?.exists
        ? `Plan updated ${formatRelative(calendarPlan.updatedAt)} · currently tracked via CRM work + planning doc`
        : 'No calendar plan found',
      source: 'Workspace plan snapshot',
    },
    {
      key: 'estimator',
      name: 'Estimator',
      status: estimatorRepo?.exists ? 'active' : estimatorPlan?.exists ? 'blueprint' : 'missing',
      summary: estimatorRepo?.exists
        ? estimatorRepo.lastCommit?.message ?? 'Estimator repo available'
        : estimatorPlan?.excerpt ?? 'Blueprint exists but repo is not in workspace yet',
      detail: estimatorRepo?.exists
        ? `${estimatorRepo.dirty ? `${estimatorRepo.changedFilesCount} local changes` : 'working tree clean'} · last commit ${formatRelative(estimatorRepo.lastCommit?.date)}`
        : estimatorPlan?.exists
          ? `Blueprint updated ${formatRelative(estimatorPlan.updatedAt)} · repo not found`
          : 'No repo or blueprint found',
      source: estimatorRepo?.exists ? 'Local git snapshot' : 'Blueprint doc snapshot',
    },
    {
      key: 'ops',
      name: 'Ops Dashboard',
      status: opsRepo?.exists ? 'active' : 'missing',
      summary: opsRepo?.exists
        ? opsRepo.lastCommit?.message ?? 'Ops repo available'
        : 'Ops repo missing from workspace',
      detail: opsRepo?.exists
        ? `${opsRepo.dirty ? `${opsRepo.changedFilesCount} local change${opsRepo.changedFilesCount === 1 ? '' : 's'}` : 'working tree clean'} · plan updated ${formatRelative(opsPlan?.updatedAt)}`
        : 'No local repo found',
      source: 'Local git + workspace plan snapshot',
    },
  ]

  const workstreams = [
    {
      title: 'CRM improvements',
      state: crmRepo?.dirty ? 'Live in repo' : 'Tracked',
      note: crmRepo?.lastCommit?.message ?? 'No recent CRM commit found',
      meta: crmRepo?.lastCommit?.date ? `Last updated ${formatDateTime(crmRepo.lastCommit.date)}` : 'No commit metadata',
    },
    {
      title: 'CRM calendar / trade bookings',
      state: calendarPlan?.exists ? 'Planned / active design' : 'Not mapped',
      note: calendarPlan?.excerpt ?? 'No planning doc found',
      meta: calendarPlan?.updatedAt ? `Doc touched ${formatDateTime(calendarPlan.updatedAt)}` : 'No plan metadata',
    },
    {
      title: 'Standalone estimator',
      state: estimatorRepo?.exists ? 'Live repo' : estimatorPlan?.exists ? 'Blueprint only' : 'Missing',
      note: estimatorRepo?.lastCommit?.message ?? estimatorPlan?.excerpt ?? 'No estimator artifacts found',
      meta: estimatorRepo?.lastCommit?.date
        ? `Last updated ${formatDateTime(estimatorRepo.lastCommit.date)}`
        : estimatorPlan?.updatedAt
          ? `Blueprint touched ${formatDateTime(estimatorPlan.updatedAt)}`
          : 'No estimator metadata',
    },
    {
      title: 'Ops room / classroom',
      state: opsRepo?.dirty ? 'Being updated now' : 'Tracked',
      note: opsPlan?.excerpt ?? opsRepo?.lastCommit?.message ?? 'No ops note found',
      meta: opsPlan?.updatedAt ? `Plan touched ${formatDateTime(opsPlan.updatedAt)}` : 'No plan metadata',
    },
  ]

  const commitFeed = repoSnapshots
    .flatMap(repo => repo.recentCommits.map(commit => ({ ...commit, repo: repo.label })))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  const focusItems = [
    ...inProgressTasks.map(task => ({
      title: task.title,
      detail: `In progress · ${task.category} · due ${task.due}`,
    })),
    ...highPriorityTasks.slice(0, 4).map(task => ({
      title: task.title,
      detail: `High priority · ${task.category} · due ${task.due}`,
    })),
  ].slice(0, 6)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0D0D0D', color: '#FFFFFF', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <AutoRefresh />

      <header className="px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between" style={{ borderBottom: '1px solid #2a2a2a' }}>
        <div>
          <div className="text-sm font-semibold tracking-[0.2em] text-white">NARDO PROJECTS</div>
          <div className="text-xs mt-1" style={{ color: '#888888' }}>
            Felix control room · workspace-backed snapshot refreshed every 60 seconds
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs" style={{ color: '#888888' }}>
          <span>Snapshot {formatDateTime(nowIso)}</span>
          <span className="font-mono"><LiveClock /></span>
        </div>
      </header>

      <main className="p-6 space-y-4">
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="rounded-lg p-5 xl:col-span-2" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
                F
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm font-semibold text-white">Felix Control Room</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#8dc63f22', color: '#8dc63f' }}>
                    SNAPSHOT MODE
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: '#888888' }}>
                  Honest view of active work based on local repos, planning docs, task file, and optional live CRM data.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5 md:grid-cols-4">
              <MetricCard label="Active workstreams" value={String(workstreams.length)} sublabel="tracked across workspace" />
              <MetricCard label="In progress" value={String(inProgressTasks.length)} sublabel="from tasks.json" />
              <MetricCard label="High priority" value={String(highPriorityTasks.length)} sublabel="open priority items" />
              <MetricCard label="Overdue" value={String(overdueTasks.length)} sublabel="pending past due" accent="#f87171" />
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: '#888888' }}>CRM pipeline</div>
            <div className="space-y-3">
              <MetricRow label="Jobs" value={String(totalJobs)} />
              <MetricRow label="Pipeline" value={totalJobs > 0 ? formatCurrency(totalValue) : 'Unavailable'} />
              <MetricRow label="Margin" value={totalJobs > 0 ? formatCurrency(totalMargin) : 'Unavailable'} />
              <div className="text-[11px]" style={{ color: '#666666' }}>
                {totalJobs > 0 ? 'Live from CRM via Supabase env vars.' : 'No live CRM env data available in this snapshot.'}
              </div>
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: '#888888' }}>Data sources</div>
            <ul className="space-y-2 text-xs" style={{ color: '#cccccc' }}>
              <li>• Local git state for `nardo-crm` and `nardo-ops`</li>
              <li>• Planning docs in workspace root</li>
              <li>• Existing `data/tasks.json` queue</li>
              <li>• Optional live CRM jobs if env keys are present</li>
            </ul>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="rounded-lg p-5 xl:col-span-2" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Module status</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>live + snapshot mix</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {modules.map(module => (
                <ModuleCard
                  key={module.key}
                  name={module.name}
                  status={module.status}
                  summary={module.summary}
                  detail={module.detail}
                  source={module.source}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg p-5 xl:col-span-2" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Active workstreams</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>derived from repos + docs</span>
            </div>
            <div className="space-y-3">
              {workstreams.map(item => (
                <div key={item.title} className="rounded-lg p-3" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-white">{item.title}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#2a2a2a', color: '#bbbbbb' }}>
                      {item.state}
                    </span>
                  </div>
                  <div className="text-xs mt-2" style={{ color: '#cccccc' }}>{item.note}</div>
                  <div className="text-[11px] mt-2" style={{ color: '#666666' }}>{item.meta}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-lg p-5 xl:col-span-2" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Recent completed work</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>local commit feed</span>
            </div>
            <div className="space-y-3">
              {commitFeed.length > 0 ? commitFeed.map(item => (
                <div key={`${item.repo}-${item.hash}`} className="flex items-start gap-3 pb-3" style={{ borderBottom: '1px solid #242424' }}>
                  <div className="mt-1 w-2 h-2 rounded-full" style={{ backgroundColor: '#8dc63f' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white">{item.message}</div>
                    <div className="text-[11px] mt-1" style={{ color: '#888888' }}>
                      {item.repo} · {formatDateTime(item.date)} · {item.hash.slice(0, 7)}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-xs" style={{ color: '#888888' }}>No commit activity found.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Current focus</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>from tasks.json</span>
            </div>
            <div className="space-y-3">
              {focusItems.length > 0 ? focusItems.map(item => (
                <div key={item.title} className="rounded-lg p-3" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
                  <div className="text-xs text-white">{item.title}</div>
                  <div className="text-[11px] mt-1" style={{ color: '#888888' }}>{item.detail}</div>
                </div>
              )) : (
                <div className="text-xs" style={{ color: '#888888' }}>No active focus items found.</div>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Task queue</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>{tasks.length} total</span>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {tasks.map(task => (
                <div key={task.id} className="rounded-lg p-3" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs text-white leading-tight">{task.title}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: '#2a2a2a', color: task.status === 'in_progress' ? '#8dc63f' : '#bbbbbb' }}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]" style={{ color: '#888888' }}>
                    <span>{task.category}</span>
                    <span>•</span>
                    <span>{task.priority} priority</span>
                    <span>•</span>
                    <span>due {task.due}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">CRM status breakdown</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>{totalJobs > 0 ? 'live' : 'offline'}</span>
            </div>
            <div className="space-y-3">
              {statusLabels.map(label => {
                const count = statusCounts[label] ?? 0
                const pct = totalJobs > 0 ? Math.round((count / totalJobs) * 100) : 0
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#888888' }}>
                      <span className="capitalize">{label.replace('_', ' ')}</span>
                      <span>{count}</span>
                    </div>
                    <div className="rounded-full overflow-hidden" style={{ height: '6px', backgroundColor: '#2a2a2a' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#8dc63f' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Reality check</h2>
              <span className="text-[11px]" style={{ color: '#666666' }}>what this is</span>
            </div>
            <ul className="space-y-2 text-xs" style={{ color: '#cccccc' }}>
              <li>• This page is near-live, not true live telemetry.</li>
              <li>• Repo cards reflect local git state on refresh.</li>
              <li>• Plan cards reflect docs in the workspace root.</li>
              <li>• Estimator shows blueprint status until a real repo exists.</li>
              <li>• Calendar status is currently inferred from planning + CRM work, not a dedicated event bus.</li>
            </ul>
            <div className="mt-4 text-[11px]" style={{ color: '#666666' }}>
              Next step for true live visibility: add a workspace status JSON or event feed written by Felix/subagents.
            </div>
          </div>
        </section>
      </main>

      <footer className="py-4 text-center" style={{ borderTop: '1px solid #2a2a2a' }}>
        <p className="text-xs" style={{ color: '#444444' }}>
          Nardo Projects Operations Centre · managed by Felix · snapshot built from workspace state
        </p>
      </footer>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sublabel,
  accent = '#FFFFFF',
}: {
  label: string
  value: string
  sublabel: string
  accent?: string
}) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
      <div className="text-xl font-bold" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide mt-1" style={{ color: '#888888' }}>{label}</div>
      <div className="text-[11px] mt-1" style={{ color: '#666666' }}>{sublabel}</div>
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: '#888888' }}>{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  )
}

function ModuleCard({
  name,
  status,
  summary,
  detail,
  source,
}: {
  name: string
  status: 'active' | 'planned' | 'blueprint' | 'missing'
  summary: string
  detail: string
  source: string
}) {
  const tone = getStatusTone(status)

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-white">{name}</div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded uppercase"
          style={{ color: tone.text, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
        >
          {status}
        </span>
      </div>
      <div className="text-xs mt-3" style={{ color: '#cccccc' }}>{summary}</div>
      <div className="text-[11px] mt-2" style={{ color: '#888888' }}>{detail}</div>
      <div className="text-[10px] mt-3 uppercase tracking-wide" style={{ color: '#666666' }}>{source}</div>
    </div>
  )
}

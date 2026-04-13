export const dynamic = 'force-dynamic'

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import Image from 'next/image'
import Link from 'next/link'
import AutoRefresh from './components/AutoRefresh'
import LiveClock from './components/LiveClock'

type AgentStatus = 'idle' | 'queued' | 'active' | 'in_progress' | 'completed' | 'blocked'
type WorkstreamState = 'queued' | 'active' | 'in_progress' | 'completed' | 'blocked'
type ApprovalState = 'not_started' | 'pending_review' | 'awaiting_verification' | 'approved'
type TaskStage = 'queued' | 'execution' | 'review' | 'approved'

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
}

interface MarkdownSection {
  heading: string
  items: string[]
}

interface AgentSnapshot {
  id: string
  label: string
  role?: string
  task: string
  status: AgentStatus
  startedAt?: string | null
  updatedAt?: string | null
  completedAt?: string | null
  outputSummary?: string
  workstream?: string | null
  repo?: string | null
  reviewRequired?: boolean
}

interface WorkstreamSnapshot {
  id: string
  label: string
  repo?: string | null
  status: WorkstreamState
  summary?: string
  updatedAt?: string
}

interface CompletionSnapshot {
  id: string
  label: string
  summary?: string
  completedAt?: string
  repo?: string | null
  workstream?: string | null
}

interface QueueTask {
  id: string
  title: string
  status: 'active' | 'in_progress' | 'completed' | 'blocked'
  priority?: string
  ownerAgentId?: string
  reviewedBy?: string
  notes?: string
  source?: string
  stage?: TaskStage | string
  approvalState?: ApprovalState | string
}

interface OpsStatus {
  updatedAt?: string
  sourceNotes?: {
    agents?: string
    workstreams?: string
    recentlyCompleted?: string
    tasks?: string
  }
  chiefAgent?: {
    label?: string
    role?: string
    task?: string
    status?: AgentStatus
    outputSummary?: string
    updatedAt?: string
  }
  agents?: AgentSnapshot[]
  workstreams?: WorkstreamSnapshot[]
  recentlyCompleted?: CompletionSnapshot[]
  taskQueue?: QueueTask[]
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
  }
}

function readMarkdownSections(filePath: string): MarkdownSection[] {
  if (!fs.existsSync(filePath)) return []

  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const sections: MarkdownSection[] = []
  let current: MarkdownSection | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('## ')) {
      current = { heading: line.replace(/^##\s+/, ''), items: [] }
      sections.push(current)
      continue
    }

    if (current && (line.startsWith('- [') || line.startsWith('- '))) {
      current.items.push(line.replace(/^-\s*/, ''))
    }
  }

  return sections
}

function getOpsStatus(workspaceRoot: string): OpsStatus {
  try {
    const filePath = path.join(workspaceRoot, 'ops-status.json')
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as OpsStatus
  } catch {
    return {}
  }
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

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n)
}

function prettyLabel(value?: string | null) {
  if (!value) return 'Unknown'
  return value.replace(/_/g, ' ')
}

function getStateTone(status?: string) {
  switch (status) {
    case 'in_progress':
    case 'active':
      return 'border-blue-400/20 bg-blue-500/10 text-blue-200'
    case 'completed':
    case 'approved':
      return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
    case 'blocked':
      return 'border-red-400/20 bg-red-500/10 text-red-200'
    case 'queued':
    case 'awaiting_verification':
    case 'pending_review':
      return 'border-amber-400/20 bg-amber-500/10 text-amber-200'
    default:
      return 'border-white/10 bg-white/[0.04] text-white/65'
  }
}

function priorityTone(priority?: string) {
  switch (priority) {
    case 'critical':
      return 'border-red-400/20 bg-red-500/10 text-red-200'
    case 'high':
      return 'border-amber-400/20 bg-amber-500/10 text-amber-200'
    case 'medium':
      return 'border-blue-400/20 bg-blue-500/10 text-blue-200'
    default:
      return 'border-white/10 bg-white/[0.04] text-white/60'
  }
}

export default async function DashboardPage() {
  const workspaceRoot = getWorkspaceRoot()
  const nowIso = new Date().toISOString()

  const [jobs, tasks] = await Promise.all([getJobs(), Promise.resolve(getTasks())])

  const repoSnapshots = [
    getRepoSnapshot('ops', 'nardo-ops', path.join(workspaceRoot, 'nardo-ops')),
    getRepoSnapshot('crm', 'nardo-crm', path.join(workspaceRoot, 'nardo-crm')),
    getRepoSnapshot('estimator', 'nardo-estimator', path.join(workspaceRoot, 'nardo-estimator')),
  ]

  const opsStatus = getOpsStatus(workspaceRoot)
  const taskSections = readMarkdownSections(path.join(workspaceRoot, 'TASKS.md'))
  const prioritySections = readMarkdownSections(path.join(workspaceRoot, 'PRIORITIES.md'))

  const agents = opsStatus.agents ?? []
  const activeAgents = agents.filter(agent => agent.status !== 'completed')
  const idleAgents = agents.filter(agent => agent.status === 'idle')
  const blockedAgents = agents.filter(agent => agent.status === 'blocked')
  const taskQueue = opsStatus.taskQueue ?? []
  const activeQueue = taskQueue.filter(task => task.status !== 'completed')
  const completedQueue = taskQueue.filter(task => task.status === 'completed')
  const reviewRequired = agents.filter(agent => agent.reviewRequired).length
  const tasksInReview = activeQueue.filter(task => task.stage === 'review').length
  const awaitingApproval = activeQueue.filter(task => task.approvalState === 'pending_review' || task.approvalState === 'awaiting_verification').length

  const recentCompletions = [
    ...(opsStatus.recentlyCompleted ?? []),
    ...completedQueue.map(task => ({
      id: task.id,
      label: task.title,
      summary: task.notes,
      completedAt: opsStatus.updatedAt,
      repo: resolveAgent(task.ownerAgentId, agents)?.repo ?? null,
      workstream: resolveAgent(task.ownerAgentId, agents)?.workstream ?? null,
    })),
  ]
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())
    .slice(0, 8)

  const derivedWorkstreams: WorkstreamSnapshot[] = [
    {
      id: 'workspace-tasks',
      label: 'Workspace task backbone',
      repo: 'workspace',
      status: 'in_progress',
      summary: `${taskSections.find(section => section.heading === 'In Progress')?.items.length ?? 0} in progress · ${taskSections.find(section => section.heading === 'Active')?.items.length ?? 0} active`,
      updatedAt: nowIso,
    },
    {
      id: 'priority-ops-reliability',
      label: 'System reliability / ops maturity',
      repo: 'workspace',
      status: 'in_progress',
      summary: prioritySections.find(section => section.heading === 'This Week')?.items[0] ?? 'Tracked in PRIORITIES.md',
      updatedAt: nowIso,
    },
    ...repoSnapshots.filter(repo => repo.exists).map<WorkstreamSnapshot>(repo => ({
      id: repo.key,
      label: repo.label,
      repo: repo.label,
      status: repo.dirty ? 'in_progress' : 'queued',
      summary: repo.lastCommit?.message ?? 'Repo present in workspace',
      updatedAt: repo.lastCommit?.date ?? nowIso,
    })),
  ]

  const combinedWorkstreams = [
    ...(opsStatus.workstreams ?? []),
    ...derivedWorkstreams.filter(item => !(opsStatus.workstreams ?? []).some(existing => existing.id === item.id)),
  ]

  const commitFeed = repoSnapshots
    .flatMap(repo => repo.recentCommits.map(commit => ({ ...commit, repo: repo.label })))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6)

  const totalJobs = jobs.length
  const totalValue = jobs.reduce((sum, job) => {
    const value = (job.value ?? job.pipeline_value ?? job.total_value ?? job.job_value ?? 0) as number
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
  const totalMargin = jobs.reduce((sum, job) => sum + ((job.nardo_margin ?? job.margin ?? 0) as number), 0)
  const openHighPriorityTasks = tasks.filter(task => task.priority === 'high' && task.status !== 'completed').length

  return (
    <div className="min-h-screen bg-[#07111f] text-white">
      <AutoRefresh />

      <header className="border-b border-white/10 bg-[#07111f]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <Image src="/nardo-logo.png" alt="Nardo Projects" width={48} height={48} className="h-12 w-12 object-contain" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-white/40">Felix control room</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">The Classroom</h1>
              <p className="mt-1 text-sm text-white/50">Agent oversight, real work, verified delivery across the Nardo workspace.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-white/45">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">Snapshot {formatDateTime(opsStatus.updatedAt ?? nowIso)}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono"><LiveClock /></span>
            <Link href="https://nardo-crm-tan.vercel.app" target="_blank" className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white transition hover:bg-white/[0.08]">
              CRM live ↗
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(153,169,190,0.18),_transparent_30%),linear-gradient(135deg,#0d1728_0%,#0b1322_55%,#09101b_100%)] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
            <div className="space-y-6">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-white/40">Command layer</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">No fake telemetry. No looping in circles. Controlled execution only.</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  This is the original Felix control room. Agents must have owned tasks, work must be reviewed, and nothing should move to complete until it has been checked properly.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Tracked agents" value={String(agents.length)} sub={`${activeAgents.length - idleAgents.length} active · ${idleAgents.length} idle`} />
                <StatCard label="Live queue" value={String(activeQueue.length)} sub={`${tasksInReview} in review · ${awaitingApproval} awaiting approval`} warn={awaitingApproval > 0} />
                <StatCard label="Needs Felix review" value={String(reviewRequired)} sub="agent outputs waiting for check" warn={reviewRequired > 0} />
                <StatCard label="CRM pipeline" value={totalJobs > 0 ? formatCurrency(totalValue) : '—'} sub={totalJobs > 0 ? `${formatCurrency(totalMargin)} margin tracked` : 'offline in this snapshot'} />
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">Chief agent</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{opsStatus.chiefAgent?.label ?? 'Felix'}</h2>
                <p className="mt-1 text-sm text-white/55">{opsStatus.chiefAgent?.role ?? 'Chief agent / control room lead'}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStateTone(opsStatus.chiefAgent?.status)}`}>
                {prettyLabel(opsStatus.chiefAgent?.status)}
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MiniMetric label="Awaiting review" value={awaitingApproval} warn={awaitingApproval > 0} />
              <MiniMetric label="Tasks in review" value={tasksInReview} />
              <MiniMetric label="Blocked agents" value={blockedAgents.length} warn={blockedAgents.length > 0} />
            </div>

            <div className="mt-6 space-y-4">
              <InfoBlock label="Current focus" value={opsStatus.chiefAgent?.task ?? 'No active chief-agent task recorded.'} />
              <InfoBlock label="Current output" value={opsStatus.chiefAgent?.outputSummary ?? 'No summary recorded yet.'} />
              <InfoBlock label="Data truth" value={opsStatus.sourceNotes?.agents ?? 'Agent visibility is driven by explicit snapshots in ops-status.json.'} subtle />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Panel title="Agent board" kicker="Who is doing what">
            <div className="space-y-4">
              {agents.length > 0 ? agents.map(agent => (
                <div key={agent.id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">{agent.label}</h3>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStateTone(agent.status)}`}>
                          {prettyLabel(agent.status)}
                        </span>
                        {agent.reviewRequired ? (
                          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">review required</span>
                        ) : (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">under control</span>
                        )}
                      </div>
                      <p className="text-sm text-white/55">{agent.role ?? 'No role recorded'}</p>
                      <InfoBlock label="Current task" value={agent.task} compact />
                      <InfoBlock label="Output summary" value={agent.outputSummary ?? 'No output summary recorded yet.'} compact subtle />
                    </div>

                    <div className="min-w-[240px] rounded-2xl border border-white/8 bg-[#09111d] px-4 py-4 text-sm text-white/55">
                      <div>Workstream: <span className="text-white/80">{agent.workstream ?? '—'}</span></div>
                      <div className="mt-2">Repo: <span className="text-white/80">{agent.repo ?? '—'}</span></div>
                      <div className="mt-2">Owned tasks: <span className="text-white/80">{activeQueue.filter(task => task.ownerAgentId === agent.id).length}</span></div>
                      <div className="mt-2">Updated: <span className="text-white/80">{formatDateTime(agent.updatedAt)}</span></div>
                    </div>
                  </div>
                </div>
              )) : (
                <EmptyState title="No tracked agents" body="This view will not invent agent activity. Add or update entries in ops-status.json to drive the board." />
              )}
            </div>
          </Panel>

          <div className="space-y-6">
            <Panel title="Current task queue" kicker="Owned work">
              <div className="space-y-3">
                {activeQueue.length > 0 ? activeQueue.map(task => (
                  <TaskCard key={task.id} task={task} agent={resolveAgent(task.ownerAgentId, agents)} />
                )) : (
                  <EmptyState title="No active tasks" body="If the queue is empty but work is happening, the queue needs updating." />
                )}
              </div>
            </Panel>

            <Panel title="Recently completed" kicker="Verified work">
              <div className="space-y-3">
                {recentCompletions.length > 0 ? recentCompletions.map(item => (
                  <div key={item.id} className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{item.label}</p>
                      <span className="text-xs text-emerald-200">{formatDateTime(item.completedAt)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{item.summary ?? 'Completed and verified.'}</p>
                  </div>
                )) : (
                  <EmptyState title="No verified completions yet" body="Only explicitly completed and reviewed items should appear here." />
                )}
              </div>
            </Panel>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Panel title="Live workstreams" kicker="Across the workspace">
            <div className="space-y-3">
              {combinedWorkstreams.map(item => {
                const repoSnapshot = item.repo ? repoSnapshots.find(repo => repo.label === item.repo) ?? null : null
                const linkedAgents = agents.filter(agent => agent.workstream === item.label)
                return (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{item.label}</p>
                        <p className="mt-1 text-sm text-white/55">{item.summary ?? 'No workstream summary recorded.'}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStateTone(item.status)}`}>
                        {prettyLabel(item.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/45">
                      <span className="rounded-full border border-white/10 px-2.5 py-1">Repo: {item.repo ?? 'workspace'}</span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1">Updated: {formatRelative(item.updatedAt)}</span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1">Agents: {linkedAgents.length}</span>
                      {repoSnapshot ? <span className="rounded-full border border-white/10 px-2.5 py-1">{repoSnapshot.dirty ? `${repoSnapshot.changedFilesCount} local changes` : 'repo clean'}</span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel title="Operational snapshot" kicker="Real current state">
            <div className="grid gap-4 sm:grid-cols-2">
              <SnapshotCard label="Live CRM jobs" value={String(totalJobs)} sub={totalJobs > 0 ? 'from Supabase' : 'no live jobs returned'} />
              <SnapshotCard label="Pipeline value" value={totalJobs > 0 ? formatCurrency(totalValue) : '—'} sub="live CRM snapshot" />
              <SnapshotCard label="Tracked margin" value={totalJobs > 0 ? formatCurrency(totalMargin) : '—'} sub="live CRM snapshot" />
              <SnapshotCard label="High priority workspace tasks" value={String(openHighPriorityTasks)} sub="from nardo-ops/data/tasks.json" warn={openHighPriorityTasks > 0} />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/40">Recent repo activity</p>
                <div className="mt-4 space-y-3">
                  {commitFeed.map(item => (
                    <div key={`${item.repo}-${item.hash}`} className="rounded-xl border border-white/6 bg-[#09111d] px-3 py-3 text-sm">
                      <p className="text-white">{item.message}</p>
                      <p className="mt-1 text-xs text-white/40">{item.repo} · {formatDateTime(item.date)} · {item.hash.slice(0, 7)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-white/40">Source of truth</p>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  {Object.entries(opsStatus.sourceNotes ?? {}).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-white/6 bg-[#09111d] px-3 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/40">{key}</p>
                      <p className="mt-1 leading-6 text-slate-300">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <Panel title="Task board" kicker="Workspace docs">
            <SectionList sections={taskSections} />
          </Panel>
          <Panel title="Priorities" kicker="Workspace docs">
            <SectionList sections={prioritySections} />
          </Panel>
          <Panel title="Reality check" kicker="What this is">
            <ul className="space-y-2 text-sm text-slate-300">
              <li>• Agents and queue state come from <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">ops-status.json</code>.</li>
              <li>• Repo activity comes from local git at refresh time.</li>
              <li>• This app is the original Felix control room project in <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">nardo-ops</code>.</li>
              <li>• CRM remains a separate system and should not be the Classroom.</li>
              <li>• Nothing should be marked complete until it has been reviewed properly.</li>
            </ul>
          </Panel>
        </section>
      </main>
    </div>
  )
}

function resolveAgent(agentId: string | undefined, agents: AgentSnapshot[]) {
  if (!agentId) return null
  return agents.find(agent => agent.id === agentId) ?? null
}

function Panel({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-[#0b1320] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
      <p className="text-xs uppercase tracking-[0.24em] text-white/40">{kicker}</p>
      <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-[22px] border p-4 ${warn ? 'border-amber-400/20 bg-amber-500/[0.08]' : 'border-white/10 bg-white/[0.04]'}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-white/50">{sub}</p>
    </div>
  )
}

function MiniMetric({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${warn ? 'border-amber-400/20 bg-amber-500/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
      <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${warn ? 'text-amber-200' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function InfoBlock({ label, value, compact = false, subtle = false }: { label: string; value: string; compact?: boolean; subtle?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 ${subtle ? 'bg-white/[0.03]' : 'bg-[#0b1423]'} ${compact ? 'px-4 py-3' : 'px-4 py-4'}`}>
      <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-200">{value}</p>
    </div>
  )
}

function SnapshotCard({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warn ? 'border-red-400/20 bg-red-500/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${warn ? 'text-red-200' : 'text-white'}`}>{value}</p>
      <p className="mt-1 text-sm text-white/50">{sub}</p>
    </div>
  )
}

function TaskCard({ task, agent }: { task: QueueTask; agent: AgentSnapshot | null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-white">{task.title}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">{task.source ?? 'manual'}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-medium capitalize ${getStateTone(task.status)}`}>
          {prettyLabel(task.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
        <span className={`rounded-full border px-2.5 py-1 ${priorityTone(task.priority)}`}>Priority: {task.priority ?? 'unrated'}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1">Owner: {agent?.label ?? 'Unassigned'}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1">Stage: {prettyLabel(task.stage ?? 'queued')}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1">Approval: {prettyLabel(task.approvalState ?? 'not_started')}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1">Reviewed by: {task.reviewedBy ?? 'Unassigned'}</span>
      </div>
      {task.notes ? <p className="mt-3 text-sm leading-6 text-slate-300">{task.notes}</p> : null}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-6 text-sm text-white/45">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 leading-6">{body}</p>
    </div>
  )
}

function SectionList({ sections }: { sections: MarkdownSection[] }) {
  return (
    <div className="space-y-4">
      {sections.map(section => (
        <div key={section.heading}>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">{section.heading}</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {section.items.length > 0 ? section.items.slice(0, 6).map(item => (
              <li key={item}>• {item}</li>
            )) : <li>• No items</li>}
          </ul>
        </div>
      ))}
    </div>
  )
}

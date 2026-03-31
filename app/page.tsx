export const dynamic = 'force-dynamic'

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
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

function priorityDot(priority: string) {
  if (priority === 'high') return 'bg-red-500'
  if (priority === 'medium') return 'bg-yellow-400'
  return 'bg-gray-500'
}

export default async function DashboardPage() {
  const [jobs, tasks] = await Promise.all([getJobs(), getTasks()])

  // CRM stats
  const totalJobs = jobs.length
  const totalValue = jobs.reduce((sum, j) => {
    const v = (j.value ?? j.pipeline_value ?? j.total_value ?? j.job_value ?? 0) as number
    return sum + (typeof v === 'number' ? v : 0)
  }, 0)
  const totalMargin = jobs.reduce((sum, j) => {
    const m = (j.nardo_margin ?? j.margin ?? 0) as number
    return sum + (typeof m === 'number' ? m : 0)
  }, 0)

  const statusLabels = ['received', 'dispatched', 'in_progress', 'completed', 'invoiced']
  const statusCounts: Record<string, number> = {}
  for (const label of statusLabels) statusCounts[label] = 0
  for (const job of jobs) {
    const s = (job.status ?? '').toLowerCase().replace(' ', '_')
    if (statusCounts[s] !== undefined) statusCounts[s]++
    else statusCounts[s] = (statusCounts[s] ?? 0) + 1
  }

  // Tasks grouped
  const highTasks = tasks.filter(t => t.priority === 'high')
  const medTasks = tasks.filter(t => t.priority === 'medium')
  const lowTasks = tasks.filter(t => t.priority === 'low')

  const phases = [
    {
      number: 1,
      name: 'Foundation',
      state: 'in_progress',
      items: [
        { done: true, label: 'CRM live' },
        { done: true, label: 'PO ingestion flow' },
        { done: true, label: 'Branded documents' },
        { done: false, label: 'Custom domain' },
        { done: false, label: 'Logo finalised' },
      ],
    },
    {
      number: 2,
      name: 'Online Presence',
      state: 'upcoming',
      items: [
        { done: false, label: 'Website redesign' },
        { done: false, label: 'Social media setup' },
        { done: false, label: 'Google Business' },
      ],
    },
    {
      number: 3,
      name: 'Lead Generation',
      state: 'upcoming',
      items: [
        { done: false, label: 'Meta ads' },
        { done: false, label: 'Lead vetting form' },
        { done: false, label: 'Leads → CRM' },
      ],
    },
    {
      number: 4,
      name: 'Quoting Engine',
      state: 'future',
      items: [
        { done: false, label: 'Bathroom reno pricing tool' },
        { done: false, label: 'Onsite quoting' },
      ],
    },
    {
      number: 5,
      name: 'Scale',
      state: 'future',
      items: [
        { done: false, label: 'Developer pipeline' },
        { done: false, label: '$100M goal' },
      ],
    },
  ]

  const activityFeed = [
    '✅ CRM deployed to Vercel',
    '✅ PO ingestion flow built',
    '✅ Branded PDF with logo',
    '✅ Supabase migration run',
    '✅ Operations dashboard building...',
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0D0D0D', color: '#FFFFFF', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <AutoRefresh />

      {/* Header */}
      <header style={{ borderBottom: '1px solid #2a2a2a' }} className="px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold tracking-[0.2em] text-white">NARDO PROJECTS</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-xs" style={{ color: '#888888' }}>Operations Centre</span>
          <span className="text-xs font-mono" style={{ color: '#888888' }}>
            <LiveClock />
          </span>
        </div>
      </header>

      {/* Main grid */}
      <main className="p-6 grid grid-cols-1 gap-4 md:grid-cols-2">

        {/* Card 1 — Felix Status */}
        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <div className="flex items-center gap-3 mb-4">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
              F
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Felix</div>
              <div className="text-xs" style={{ color: '#888888' }}>AI Chief of Staff</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#8dc63f' }}></span>
              <span className="text-xs" style={{ color: '#8dc63f' }}>Active</span>
            </div>
          </div>

          <div className="text-xs mb-3" style={{ color: '#888888' }}>
            Last action: <span className="text-white">Monitoring operations</span>
          </div>

          <div style={{ borderTop: '1px solid #2a2a2a' }} className="pt-3">
            <div className="text-xs mb-2 font-medium tracking-wide uppercase" style={{ color: '#888888' }}>Recent Activity</div>
            <ul className="space-y-2">
              {activityFeed.map((item, i) => (
                <li key={i} className="text-xs" style={{ color: i === activityFeed.length - 1 ? '#8dc63f' : '#cccccc' }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Card 2 — Task Queue */}
        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-white">Task Queue</h2>
            <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#2a2a2a', color: '#888888' }}>{tasks.length} tasks</span>
          </div>

          <div className="space-y-4 overflow-y-auto max-h-72">
            {[
              { label: 'High Priority', tasks: highTasks, priority: 'high' },
              { label: 'Medium Priority', tasks: medTasks, priority: 'medium' },
              { label: 'Low Priority', tasks: lowTasks, priority: 'low' },
            ].map(group => group.tasks.length > 0 && (
              <div key={group.priority}>
                <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: '#888888' }}>{group.label}</div>
                <ul className="space-y-2">
                  {group.tasks.map(task => (
                    <li key={task.id} className="flex items-start gap-2 text-xs">
                      <div className="mt-1 flex-shrink-0">
                        {task.status === 'in_progress' ? (
                          <span className="w-2 h-2 rounded-full inline-block animate-pulse" style={{ backgroundColor: '#8dc63f' }}></span>
                        ) : (
                          <span className={`w-2 h-2 rounded-full inline-block ${priorityDot(task.priority)}`}></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white leading-tight truncate" title={task.title}>{task.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#2a2a2a', color: '#888888' }}>{task.category}</span>
                          <span style={{ color: '#888888' }}>Due {task.due}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3 — CRM Live Stats */}
        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-white">CRM Live Stats</h2>
            <a
              href="https://nardo-crm-tan.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs hover:underline"
              style={{ color: '#8dc63f' }}
            >
              Open CRM →
            </a>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded p-3 text-center" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
              <div className="text-xl font-bold text-white">{totalJobs}</div>
              <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: '#888888' }}>Jobs</div>
            </div>
            <div className="rounded p-3 text-center" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
              <div className="text-lg font-bold text-white">{formatCurrency(totalValue)}</div>
              <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: '#888888' }}>Pipeline</div>
            </div>
            <div className="rounded p-3 text-center" style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a' }}>
              <div className="text-lg font-bold" style={{ color: '#8dc63f' }}>{formatCurrency(totalMargin)}</div>
              <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: '#888888' }}>Margin</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: '#888888' }}>Jobs by Status</div>
            <div className="space-y-2">
              {statusLabels.map(label => {
                const count = statusCounts[label] ?? 0
                const pct = totalJobs > 0 ? Math.round((count / totalJobs) * 100) : 0
                return (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-20 text-[10px] capitalize" style={{ color: '#888888' }}>{label.replace('_', ' ')}</div>
                    <div className="flex-1 rounded-full overflow-hidden" style={{ height: '6px', backgroundColor: '#2a2a2a' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: '#8dc63f' }}
                      />
                    </div>
                    <div className="text-[10px] w-5 text-right" style={{ color: '#888888' }}>{count}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Card 4 — Business Roadmap */}
        <div className="rounded-lg p-5" style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-white mb-4">Business Roadmap</h2>

          <div className="relative pl-4 space-y-0 overflow-y-auto max-h-72">
            {/* Vertical line */}
            <div className="absolute left-1 top-2 bottom-2 w-px" style={{ backgroundColor: '#2a2a2a' }}></div>

            {phases.map((phase, idx) => {
              const isActive = phase.state === 'in_progress'
              const isFuture = phase.state === 'future'
              const dotColor = isActive ? '#8dc63f' : isFuture ? '#2a2a2a' : '#444444'
              const textColor = isFuture ? '#444444' : isActive ? '#ffffff' : '#888888'

              return (
                <div key={phase.number} className="relative pb-4">
                  {/* Dot */}
                  <div
                    className="absolute -left-[11px] top-1 w-3 h-3 rounded-full border-2 flex-shrink-0"
                    style={{
                      backgroundColor: isActive ? '#8dc63f' : '#0D0D0D',
                      borderColor: dotColor,
                      boxShadow: isActive ? '0 0 6px #8dc63f66' : 'none',
                    }}
                  />

                  <div className="ml-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold" style={{ color: textColor }}>
                        Phase {phase.number} — {phase.name}
                      </span>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#8dc63f22', color: '#8dc63f' }}>
                          IN PROGRESS
                        </span>
                      )}
                      {phase.state === 'upcoming' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#2a2a2a', color: '#888888' }}>
                          UPCOMING
                        </span>
                      )}
                      {isFuture && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1f1f1f', color: '#444444' }}>
                          FUTURE
                        </span>
                      )}
                    </div>
                    <ul className="space-y-0.5">
                      {phase.items.map((item, i) => (
                        <li key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: isFuture ? '#444444' : '#888888' }}>
                          <span>{item.done ? '✅' : '🔲'}</span>
                          <span style={{ color: item.done ? '#cccccc' : isFuture ? '#444444' : '#666666' }}>{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center" style={{ borderTop: '1px solid #2a2a2a' }}>
        <p className="text-xs" style={{ color: '#444444' }}>
          Nardo Projects Operations Centre · Managed by Felix
        </p>
      </footer>
    </div>
  )
}

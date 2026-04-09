import { useState, useEffect, useRef, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';

const STATUS_ICONS = {
  running: '🔄',
  completed: '✅',
  failed: '❌',
  killed: '🛑',
};

const ansiConverter = new AnsiToHtml({
  fg: '#e6edf3',
  bg: '#0d1117',
  colors: {
    0: '#8b949e', 1: '#f85149', 2: '#3fb950', 3: '#d29922',
    4: '#58a6ff', 5: '#bc8cff', 6: '#39d2c0', 7: '#e6edf3',
  },
});

function AnsiPre({ text }) {
  const html = useMemo(() => ansiConverter.toHtml(text || ''), [text]);
  return <pre dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function AgentStatusPanel({ repo, prId, onRelaunched }) {
  const [agents, setAgents] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [fullOutput, setFullOutput] = useState(null);
  const [expandedHistoryIdx, setExpandedHistoryIdx] = useState(null);
  const [relaunching, setRelaunching] = useState(null);
  const [killing, setKilling] = useState(null);
  const [relaunchPrompt, setRelaunchPrompt] = useState({});
  const [showRelaunchFor, setShowRelaunchFor] = useState(null);
  const outputRef = useRef(null);

  // Poll agent status
  useEffect(() => {
    const load = () => fetch('/api/agent/status').then(r => r.json()).then(all => {
      const filtered = (repo && prId)
        ? all.filter(a => a.repo === repo && String(a.prId) === String(prId))
        : all;
      const sorted = filtered.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
      setAgents(sorted);
    }).catch(() => {});
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [repo, prId]);

  // Load history once
  useEffect(() => {
    if (!repo || !prId) return;
    fetch(`/api/agent/history/${repo}/${prId}`)
      .then(r => r.json())
      .then(data => setHistoryRuns(Array.isArray(data) ? data.reverse() : []))
      .catch(() => {});
  }, [repo, prId]);

  // Reload history after a relaunch (old run gets archived)
  const reloadHistory = () => {
    if (!repo || !prId) return;
    fetch(`/api/agent/history/${repo}/${prId}`)
      .then(r => r.json())
      .then(data => setHistoryRuns(Array.isArray(data) ? data.reverse() : []))
      .catch(() => {});
  };

  // Poll full output for expanded current agent
  useEffect(() => {
    if (!expandedKey) { setFullOutput(null); return; }
    const agent = agents.find(a => a.key === expandedKey);
    if (!agent) { setFullOutput(null); return; }
    const outputUrl = agent.agentType === 'discussion'
      ? `/api/agent/output/${agent.repo}/${agent.prId}/${agent.feedbackId}`
      : `/api/agent/output/${agent.repo}/${agent.prId}`;
    const load = () =>
      fetch(outputUrl)
        .then(r => r.json())
        .then(data => {
          setFullOutput(data);
          const el = outputRef.current;
          if (el) {
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (nearBottom) el.scrollTop = el.scrollHeight;
          }
        })
        .catch(() => {});
    load();
    const interval = agent.status === 'running' ? setInterval(load, 2000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [expandedKey, agents.find(a => a.key === expandedKey)?.status]);

  const handleRelaunch = async (agent) => {
    setRelaunching(agent.key);
    try {
      const res = await fetch('/api/agent/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prUrl: agent.prUrl,
          force: true,
          extraPrompt: relaunchPrompt[agent.key] || undefined,
        }),
      });
      if (res.ok) {
        setShowRelaunchFor(null);
        setRelaunchPrompt(p => { const n = {...p}; delete n[agent.key]; return n; });
        setExpandedKey(null);
        setFullOutput(null);
        // Clear current agents to avoid flash of stale state
        setAgents([]);
        onRelaunched?.();
        // Small delay to let server archive + start new agent
        await new Promise(r => setTimeout(r, 500));
        reloadHistory();
        fetch('/api/agent/status').then(r => r.json()).then(all => {
          const filtered = (repo && prId)
            ? all.filter(a => a.repo === repo && String(a.prId) === String(prId))
            : all;
          const sorted = filtered.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
          setAgents(sorted);
        }).catch(() => {});
      }
    } finally {
      setRelaunching(null);
    }
  };

  const handleKill = async (agent) => {
    setKilling(agent.key);
    try {
      await fetch(`/api/agent/kill/${agent.repo}/${agent.prId}`, { method: 'POST' });
      fetch('/api/agent/status').then(r => r.json()).then(setAgents).catch(() => {});
    } finally {
      setKilling(null);
    }
  };

  const hasContent = agents.length > 0 || historyRuns.length > 0;
  if (!hasContent) return null;

  return (
    <div className="agent-panel">
      <h3 className="agent-panel-title">🤖 Review Agents</h3>
      <div className="agent-list">
        {/* Current agent(s) */}
        {agents.map(agent => (
          <div key={agent.key} className={`agent-item agent-${agent.status}`}>
            <div
              className="agent-item-header"
              onClick={() => setExpandedKey(expandedKey === agent.key ? null : agent.key)}
              style={{ cursor: 'pointer' }}
            >
              <div className="agent-item-left">
                <span className={`agent-status-icon ${agent.status === 'running' ? 'spinning' : ''}`}>
                  {STATUS_ICONS[agent.status] || '❓'}
                </span>
                <div>
                  <div className="agent-item-name">
                    {agent.agentType === 'discussion' ? `Discussion · ${agent.feedbackId}` : agent.profileName}
                  </div>
                  <div className="agent-item-meta">
                    PID {agent.pid} · {timeAgo(agent.startedAt)}
                  </div>
                </div>
              </div>
              <div className="agent-item-right">
                <span className={`badge agent-badge-${agent.status}`}>{agent.status}</span>
                {agent.exitCode !== null && agent.exitCode !== 0 && (
                  <span className="badge badge-high">exit {agent.exitCode}</span>
                )}
                <span className="agent-expand">{expandedKey === agent.key ? '▼' : '▶'}</span>
              </div>
            </div>

            {agent.error && (
              <div className="agent-error">{agent.error}</div>
            )}

            {/* Action buttons - only show when there are actions */}
            {(agent.status === 'running' || agent.status === 'failed') && (
            <div style={{ padding: '6px 16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {agent.status === 'running' && (
                  <button
                    className="btn btn-reject btn-sm"
                    disabled={killing === agent.key}
                    onClick={(e) => { e.stopPropagation(); handleKill(agent); }}
                  >
                    {killing === agent.key ? 'Killing...' : 'Kill'}
                  </button>
                )}
                {agent.status === 'failed' && (
                  <button
                    className="btn btn-sm"
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (showRelaunchFor !== agent.key) {
                        setRelaunchPrompt(p => ({
                          ...p,
                          [agent.key]: 'The last review run exited prematurely. Resume the review of this PR from where it left off.',
                        }));
                      }
                      setShowRelaunchFor(showRelaunchFor === agent.key ? null : agent.key);
                    }}
                  >
                    Retry Agent
                  </button>
                )}
              </div>
              {showRelaunchFor === agent.key && (
                <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                  <textarea
                    className="instructions-editor"
                    style={{ minHeight: 50, marginBottom: 6 }}
                    value={relaunchPrompt[agent.key] || ''}
                    onChange={e => setRelaunchPrompt(p => ({ ...p, [agent.key]: e.target.value }))}
                    placeholder="Additional instructions..."
                    spellCheck={false}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-post btn-sm"
                      disabled={relaunching === agent.key}
                      onClick={() => handleRelaunch(agent)}
                    >
                      {relaunching === agent.key ? 'Launching...' : 'Launch'}
                    </button>
                    <button className="btn btn-sm" onClick={() => setShowRelaunchFor(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Collapsed: show tail only while running */}
            {expandedKey !== agent.key && agent.status === 'running' && agent.outputTail && (
              <div className="agent-output-preview">
                <AnsiPre text={agent.outputTail.trim().split('\n').slice(-3).join('\n')} />
              </div>
            )}

            {/* Expanded: full output */}
            {expandedKey === agent.key && (
              <div className="agent-output-full" ref={outputRef}>
                {agent.command && (
                  <div style={{ marginBottom: 8 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, padding: 8, background: 'var(--bg-primary)', borderRadius: 4 }}>{agent.command}</pre>
                  </div>
                )}
                {fullOutput?.stderr && (
                  <div className="agent-stderr">
                    <div className="agent-output-label">stderr</div>
                    <AnsiPre text={fullOutput.stderr} />
                  </div>
                )}
                <div className="agent-stdout">
                  <div className="agent-output-label">
                    output ({((fullOutput?.stdout?.length || 0) / 1024).toFixed(1)} KB)
                  </div>
                  <AnsiPre text={fullOutput?.stdout || '(no output yet)'} />
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Past runs as separate rows */}
        {historyRuns.map((run, i) => (
          <div key={`hist-${i}`} className={`agent-item agent-${run.status}`}>
            <div
              className="agent-item-header"
              onClick={() => setExpandedHistoryIdx(expandedHistoryIdx === i ? null : i)}
              style={{ cursor: 'pointer' }}
            >
              <div className="agent-item-left">
                <span className="agent-status-icon">
                  {STATUS_ICONS[run.status] || '·'}
                </span>
                <div>
                  <div className="agent-item-name">{run.profileName || 'unknown'}</div>
                  <div className="agent-item-meta">
                    PID {run.pid} · {run.startedAt ? timeAgo(run.startedAt) : 'unknown'}
                  </div>
                </div>
              </div>
              <div className="agent-item-right">
                <span className={`badge agent-badge-${run.status}`}>{run.status}</span>
                {run.exitCode != null && run.exitCode !== 0 && (
                  <span className="badge badge-high">exit {run.exitCode}</span>
                )}
                <span className="agent-expand">{expandedHistoryIdx === i ? '▼' : '▶'}</span>
              </div>
            </div>

            {run.error && (
              <div className="agent-error">{run.error}</div>
            )}

            {expandedHistoryIdx === i && (
              <div className="agent-output-full">
                {run.command && (
                  <div style={{ marginBottom: 8 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, padding: 8, background: 'var(--bg-primary)', borderRadius: 4 }}>{run.command}</pre>
                  </div>
                )}
                {run.stdout && (
                  <div className="agent-stdout">
                    <div className="agent-output-label">
                      output ({(run.stdout.length / 1024).toFixed(1)} KB)
                    </div>
                    <AnsiPre text={run.stdout} />
                  </div>
                )}
                {!run.stdout && <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>(no output captured)</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

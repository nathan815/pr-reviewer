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

export default function AgentStatusPanel({ onRelaunched }) {
  const [agents, setAgents] = useState([]);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [fullOutput, setFullOutput] = useState(null);
  const [relaunching, setRelaunching] = useState(null);
  const [killing, setKilling] = useState(null);
  const outputRef = useRef(null);

  // Poll agent status
  useEffect(() => {
    const load = () => fetch('/api/agent/status').then(r => r.json()).then(setAgents).catch(() => {});
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll full output for expanded agent
  useEffect(() => {
    if (!expandedAgent) { setFullOutput(null); return; }
    const load = () =>
      fetch(`/api/agent/output/${expandedAgent.repo}/${expandedAgent.prId}`)
        .then(r => r.json())
        .then(data => {
          setFullOutput(data);
          if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
          }
        })
        .catch(() => {});
    load();
    const interval = expandedAgent.status === 'running' ? setInterval(load, 2000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [expandedAgent?.key, expandedAgent?.status]);

  // Update expanded agent status from poll
  useEffect(() => {
    if (expandedAgent) {
      const updated = agents.find(a => a.key === expandedAgent.key);
      if (updated && updated.status !== expandedAgent.status) {
        setExpandedAgent(updated);
      }
    }
  }, [agents]);

  const handleRelaunch = async (agent) => {
    setRelaunching(agent.key);
    try {
      const res = await fetch('/api/agent/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: agent.prUrl, force: true }),
      });
      if (res.ok) {
        onRelaunched?.();
        fetch('/api/agent/status').then(r => r.json()).then(setAgents).catch(() => {});
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

  if (agents.length === 0) return null;

  return (
    <div className="agent-panel">
      <h3 className="agent-panel-title">🤖 Review Agents</h3>
      <div className="agent-list">
        {agents.map(agent => (
          <div key={agent.key} className={`agent-item agent-${agent.status}`}>
            <div
              className="agent-item-header"
              onClick={() => setExpandedAgent(expandedAgent?.key === agent.key ? null : agent)}
              style={{ cursor: 'pointer' }}
            >
              <div className="agent-item-left">
                <span className={`agent-status-icon ${agent.status === 'running' ? 'spinning' : ''}`}>
                  {STATUS_ICONS[agent.status] || '❓'}
                </span>
                <div>
                  <div className="agent-item-name">{agent.repo} #{agent.prId}</div>
                  <div className="agent-item-meta">
                    {agent.profileName} · PID {agent.pid} · {timeAgo(agent.startedAt)}
                  </div>
                </div>
              </div>
              <div className="agent-item-right">
                <span className={`badge agent-badge-${agent.status}`}>{agent.status}</span>
                {agent.exitCode !== null && agent.exitCode !== 0 && (
                  <span className="badge badge-high">exit {agent.exitCode}</span>
                )}
                <span className="agent-expand">{expandedAgent?.key === agent.key ? '▼' : '▶'}</span>
              </div>
            </div>

            {agent.error && (
              <div className="agent-error">❌ {agent.error}</div>
            )}

            {/* Action buttons */}
            <div style={{ padding: '6px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              {agent.status === 'running' && (
                <button
                  className="btn btn-reject btn-sm"
                  disabled={killing === agent.key}
                  onClick={(e) => { e.stopPropagation(); handleKill(agent); }}
                >
                  {killing === agent.key ? '⏳ Killing...' : '🛑 Kill'}
                </button>
              )}
              {agent.status !== 'running' && (
                <button
                  className="btn btn-sm"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  disabled={relaunching === agent.key}
                  onClick={(e) => { e.stopPropagation(); handleRelaunch(agent); }}
                >
                  {relaunching === agent.key ? '⏳ Relaunching...' : '🔄 Relaunch'}
                </button>
              )}
            </div>

            {/* Collapsed: show tail */}
            {expandedAgent?.key !== agent.key && agent.outputTail && (
              <div className="agent-output-preview">
                <AnsiPre text={agent.outputTail.split('\n').slice(-3).join('\n')} />
              </div>
            )}

            {/* Expanded: full output */}
            {expandedAgent?.key === agent.key && fullOutput && (
              <div className="agent-output-full" ref={outputRef}>
                {fullOutput.stderr && (
                  <div className="agent-stderr">
                    <div className="agent-output-label">stderr</div>
                    <AnsiPre text={fullOutput.stderr} />
                  </div>
                )}
                <div className="agent-stdout">
                  <div className="agent-output-label">
                    output ({(fullOutput.stdout.length / 1024).toFixed(1)} KB)
                  </div>
                  <AnsiPre text={fullOutput.stdout || '(no output yet)'} />
                </div>
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

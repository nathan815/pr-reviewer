import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import AnsiToHtml from 'ansi-to-html';

const ansiConverter = new AnsiToHtml({
  fg: '#e6edf3', bg: '#0d1117',
  colors: { 0:'#8b949e',1:'#f85149',2:'#3fb950',3:'#d29922',4:'#58a6ff',5:'#bc8cff',6:'#39d2c0',7:'#e6edf3' },
});

export default function Learnings() {
  const [stats, setStats] = useState(null);
  const [guidelines, setGuidelines] = useState(null);
  const [curationStatus, setCurationStatus] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState('guidelines');
  const [selectedRepo, setSelectedRepo] = useState(null);

  const loadData = () => {
    fetch('/api/learnings/stats').then(r => r.json()).then(setStats).catch(() => {});
    fetch('/api/learnings/guidelines').then(r => r.json()).then(setGuidelines).catch(() => {});
    fetch('/api/learnings/curate/status').then(r => r.json()).then(setCurationStatus).catch(() => {});
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadRepoGuidelines = (repo) => {
    setSelectedRepo(repo);
    fetch(`/api/learnings/guidelines?repo=${encodeURIComponent(repo)}`)
      .then(r => r.json())
      .then(data => setGuidelines(prev => ({ ...prev, perRepo: data.perRepo })))
      .catch(() => {});
  };

  const handleCurate = async () => {
    setLaunching(true);
    try {
      const res = await fetch('/api/learnings/curate', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'skipped') {
        alert(data.reason);
      }
      loadData();
    } finally {
      setLaunching(false);
    }
  };

  const curationOutput = useMemo(() => {
    if (!curationStatus?.outputTail) return '';
    return ansiConverter.toHtml(curationStatus.outputTail);
  }, [curationStatus?.outputTail]);

  return (
    <>
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      <div className="overview-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>📊 Learnings & Guidelines</h1>
          <button
            className="btn btn-rerun"
            onClick={handleCurate}
            disabled={launching || curationStatus?.status === 'running'}
          >
            {curationStatus?.status === 'running' ? '🔄 Curating…' : '🧠 Run Curation'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Decisions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.accepted}</div>
            <div className="stat-label">Accepted</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.rejected}</div>
            <div className="stat-label">Rejected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.acceptRate}%</div>
            <div className="stat-label">Accept Rate</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.newSinceCuration}</div>
            <div className="stat-label">New Since Curation</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.withNotes}</div>
            <div className="stat-label">With Notes</div>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {stats?.byCategory && Object.keys(stats.byCategory).length > 0 && (
        <div className="overview-section">
          <h2>By Category</h2>
          <div className="risk-grid">
            {Object.entries(stats.byCategory).map(([cat, counts]) => (
              <div key={cat} className="risk-card">
                <h4 style={{ textTransform: 'capitalize' }}>{cat}</h4>
                <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                  <span style={{ color: 'var(--green)' }}>✓ {counts.accepted} accepted</span>
                  <span style={{ color: 'var(--red)' }}>✗ {counts.rejected} rejected</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Curation agent status */}
      {curationStatus && curationStatus.status !== 'idle' && (
        <div className="overview-section">
          <h2>Curation Agent</h2>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <span className={`badge agent-badge-${curationStatus.status}`}>{curationStatus.status}</span>
            {curationStatus.startedAt && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                Started {new Date(curationStatus.startedAt).toLocaleString()}
              </span>
            )}
          </div>
          {curationStatus.outputTail && (
            <pre
              className="agent-output-preview"
              style={{ maxHeight: 200, overflow: 'auto', fontSize: 12 }}
              dangerouslySetInnerHTML={{ __html: curationOutput }}
            />
          )}
        </div>
      )}

      {/* Guidelines tabs */}
      <div className="overview-section" style={{ background: 'transparent', border: 'none', padding: 0 }}>
        <div className="filter-bar">
          <button
            className={`filter-btn ${activeTab === 'guidelines' ? 'active' : ''}`}
            onClick={() => setActiveTab('guidelines')}
          >
            Global Guidelines
          </button>
          {guidelines?.reposWithGuidelines?.map(repo => (
            <button
              key={repo}
              className={`filter-btn ${activeTab === `repo-${repo}` ? 'active' : ''}`}
              onClick={() => { setActiveTab(`repo-${repo}`); loadRepoGuidelines(repo); }}
            >
              {repo}
            </button>
          ))}
        </div>

        {activeTab === 'guidelines' && (
          <div className="overview-section">
            {guidelines?.global ? (
              <div className="markdown-body"><Markdown>{guidelines.global}</Markdown></div>
            ) : (
              <div className="empty-state">
                No global guidelines yet. Accept/reject some review feedback, then run curation.
              </div>
            )}
          </div>
        )}

        {activeTab.startsWith('repo-') && (
          <div className="overview-section">
            {guidelines?.perRepo ? (
              <div className="markdown-body"><Markdown>{guidelines.perRepo}</Markdown></div>
            ) : (
              <div className="empty-state">
                No repo-specific guidelines for {selectedRepo} yet.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

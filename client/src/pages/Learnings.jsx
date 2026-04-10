import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import AnsiToHtml from 'ansi-to-html';
import { IconChart, IconBrain, IconCheck, IconX, IconNote } from '../components/Icons';

const ansiConverter = new AnsiToHtml({
  fg: '#e6edf3', bg: '#0d1117',
  colors: { 0:'#8b949e',1:'#f85149',2:'#3fb950',3:'#d29922',4:'#58a6ff',5:'#bc8cff',6:'#39d2c0',7:'#e6edf3' },
});

export default function Learnings() {
  const [stats, setStats] = useState(null);
  const [guidelines, setGuidelines] = useState(null);
  const [examples, setExamples] = useState(null);
  const [curationStatus, setCurationStatus] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState('guidelines');
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [exampleFilter, setExampleFilter] = useState('all');

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

  const filteredExamples = useMemo(() => {
    if (!examples) return [];
    return examples.filter(e => {
      const type = e.exampleType || 'decision';
      if (exampleFilter === 'all') return true;
      if (exampleFilter === 'with-notes') return !!e.userNote;
      if (exampleFilter === 'discussion-edits') return type === 'discussion-edit';
      if (exampleFilter === 'ado-replies') return type === 'ado-reply';
      return type === 'decision' && e.decision === exampleFilter;
    });
  }, [exampleFilter, examples]);

  const renderExampleBadge = (example) => {
    const type = example.exampleType || 'decision';
    if (type === 'discussion-edit') {
      return <span className="badge badge-info"><IconNote style={{ width: 12, height: 12 }} /> Discussion Edit</span>;
    }
    if (type === 'ado-reply') {
      return <span className="badge" style={{ background: 'rgba(188,140,255,0.15)', color: 'var(--purple)' }}>ADO Reply</span>;
    }
    if (example.decision === 'accepted') {
      return <span className="badge badge-low"><IconCheck style={{ width: 12, height: 12 }} /> Accepted</span>;
    }
    if (example.decision === 'noted') {
      return <span className="badge status-noted"><IconCheck style={{ width: 12, height: 12 }} /> Noted</span>;
    }
    return <span className="badge badge-high"><IconX style={{ width: 12, height: 12 }} /> Rejected</span>;
  };

  return (
    <>
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      <div className="overview-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 22, margin: 0 }}><IconChart /> Learnings & Guidelines</h1>
          <button
            className="btn btn-rerun"
            onClick={handleCurate}
            disabled={launching || curationStatus?.status === 'running'}
          >
            {curationStatus?.status === 'running' ? 'Curating…' : <><IconBrain /> Run Curation</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="stats-row" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Signals</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.accepted}</div>
            <div className="stat-label">Accepted{stats.noted > 0 ? ` (${stats.noted} noted)` : ''}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.rejected}</div>
            <div className="stat-label">Rejected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.acceptRate}%</div>
            <div className="stat-label">Decision Accept Rate</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.newSinceCuration}</div>
            <div className="stat-label">New Since Curation</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.withNotes}</div>
            <div className="stat-label">With Notes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.discussionEdits}</div>
            <div className="stat-label">Discussion Edits</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--purple)' }}>{stats.adoReplies}</div>
            <div className="stat-label">ADO Replies</div>
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
                  <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconCheck style={{ width: 12, height: 12 }} /> {counts.accepted} accepted</span>
                  <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconX style={{ width: 12, height: 12 }} /> {counts.rejected} rejected</span>
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
          <button
            className={`filter-btn ${activeTab === 'examples' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('examples');
              if (!examples) fetch('/api/learnings/examples').then(r => r.json()).then(setExamples).catch(() => {});
            }}
          >
            Examples {stats ? `(${stats.total})` : ''}
          </button>
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

        {activeTab === 'examples' && (
          <div className="overview-section">
            {!examples || examples.length === 0 ? (
              <div className="empty-state">No signals yet. Accept/reject feedback, revise it through discussion, or sync ADO replies to start building learnings.</div>
            ) : (
              <>
                <div className="filter-bar" style={{ marginBottom: 12 }}>
                  {['all', 'accepted', 'noted', 'rejected', 'discussion-edits', 'ado-replies', 'with-notes'].map(f => {
                    const count = f === 'all' ? examples.length
                      : f === 'discussion-edits' ? examples.filter(e => e.exampleType === 'discussion-edit').length
                      : f === 'ado-replies' ? examples.filter(e => e.exampleType === 'ado-reply').length
                      : f === 'with-notes' ? examples.filter(e => e.userNote).length
                      : examples.filter(e => (e.exampleType || 'decision') === 'decision' && e.decision === f).length;
                    const label = f === 'with-notes'
                      ? 'With Notes'
                      : f === 'discussion-edits'
                        ? 'Discussion Edits'
                        : f === 'ado-replies'
                          ? 'ADO Replies'
                          : f.charAt(0).toUpperCase() + f.slice(1);
                    return (
                      <button
                        key={f}
                        className={`filter-btn ${exampleFilter === f ? 'active' : ''}`}
                        onClick={() => setExampleFilter(f)}
                      >
                        {label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="examples-list">
                  {filteredExamples
                    .slice()
                    .reverse()
                    .map((ex, i) => (
                      <div
                        key={i}
                        className={`example-item example-${ex.exampleType || ex.decision}`}
                      >
                        <div className="example-header">
                          {renderExampleBadge(ex)}
                          <span className="badge" style={{ textTransform: 'capitalize' }}>{ex.category}</span>
                          <span className="badge">{ex.severity}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 'auto' }}>
                            {ex.repo} · {new Date(ex.timestamp).toLocaleDateString()}
                          </span>
                          <Link
                            to={`/review/${ex.repo}/${ex.prId}?highlight=${ex.feedbackId}`}
                            target="_blank"
                            className="example-link"
                            title="View in context"
                          >
                            View in PR ↗
                          </Link>
                        </div>
                        <div className="example-body">
                          <strong>{ex.title}</strong>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{ex.comment}</div>
                          {ex.editSummary?.changes?.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>
                              Updated fields: {ex.editSummary.changes.map(change => change.field).join(', ')}
                            </div>
                          )}
                          {ex.adoReply?.content && (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                              Reply from <strong>{ex.adoReply.author}</strong>: {ex.adoReply.content}
                            </div>
                          )}
                          {ex.file && (
                            <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, fontFamily: 'monospace' }}>
                              {ex.file}:{ex.startLine}
                            </div>
                          )}
                        </div>
                        {ex.userNote && (
                          <div className="example-note"><IconNote style={{ width: 12, height: 12 }} /> {ex.userNote}</div>
                        )}
                      </div>
                    ))
                  }
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

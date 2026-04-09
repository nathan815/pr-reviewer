import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import FeedbackCard from '../components/FeedbackCard';
import RiskBadge from '../components/RiskBadge';
import AgentStatusPanel from '../components/AgentStatusPanel';
import ChangedFiles from '../components/ChangedFiles';
import { IconCheck, IconX, IconSend, IconTrash } from '../components/Icons';

export default function ReviewDetail() {
  const { repo, prId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);
  const [relaunching, setRelaunching] = useState(false);
  const [showRelaunchPrompt, setShowRelaunchPrompt] = useState(false);
  const [relaunchText, setRelaunchText] = useState('');
  const [activeFile, setActiveFile] = useState(null);
  const [adoInfo, setAdoInfo] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const feedbackRefs = useRef({});

  const loadReview = useCallback(() => {
    fetch(`/api/reviews/${repo}/${prId}`)
      .then(r => r.json())
      .then(data => { setReview(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repo, prId]);

  useEffect(() => { loadReview(); }, [loadReview]);

  useEffect(() => {
    fetch(`/api/reviews/${repo}/${prId}/ado-info`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAdoInfo(data);
          // If title was synced, update local review
          if (data.title && review?.metadata?.title !== data.title) {
            loadReview();
          }
        }
      })
      .catch(() => {});
  }, [repo, prId]);

  useEffect(() => {
    if (highlightId && review?.feedback) {
      setTimeout(() => {
        const el = document.getElementById(`feedback-${highlightId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-pulse');
          setTimeout(() => el.classList.remove('highlight-pulse'), 3000);
        }
      }, 200);
    }
  }, [highlightId, review]);

  const updateStatus= async (feedbackId, status, userNote) => {
    await fetch(`/api/reviews/${repo}/${prId}/feedback/${feedbackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(userNote ? { userNote } : {}) }),
    });
    loadReview();
  };

  const postSingle = async (feedbackId) => {
    const res = await fetch('/api/ado/post-comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, prId: Number(prId), feedbackId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Post failed (${res.status})`);
    }
    if (data.success) loadReview();
    return data;
  };

  const postAllAccepted = async () => {
    setPosting(true);
    setPostResult(null);
    try {
      const res = await fetch('/api/ado/post-accepted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, prId: Number(prId) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostResult({ success: false, error: data.error || `Request failed (${res.status})` });
      } else {
        setPostResult(data);
      }
      loadReview();
    } catch (err) {
      setPostResult({ success: false, error: err.message });
    } finally {
      setPosting(false);
    }
  };

  const acceptAll = async () => {
    const pendingIds = review.feedback.items
      .filter(i => i.status === 'pending')
      .map(i => i.id);
    if (pendingIds.length === 0) return;
    await fetch(`/api/reviews/${repo}/${prId}/feedback/batch-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: pendingIds, status: 'accepted' }),
    });
    loadReview();
  };

  const deleteAllFeedback = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/delete-all`, { method: 'POST' });
      if (res.ok) {
        setShowDeleteConfirm(false);
        loadReview();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleRelaunch = async () => {
    if (!review?.metadata?.url) return;
    setRelaunching(true);
    try {
      await fetch('/api/agent/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prUrl: review.metadata.url,
          force: true,
          extraPrompt: relaunchText || undefined,
        }),
      });
      setShowRelaunchPrompt(false);
      setRelaunchText('');
      setTimeout(loadReview, 2000);
    } finally {
      setRelaunching(false);
    }
  };

  if (loading) return <div className="loading">Loading review</div>;
  if (!review) return <div className="empty-state">Review not found</div>;

  const { metadata, feedback, risk, overview } = review;
  const isFailed = metadata.status === 'agent_review_failed';
  const isRequested = metadata.status === 'agent_review_requested';
  const items = feedback.items || [];
  const filtered = items.filter(i => {
    if (activeFile && i.file !== activeFile) return false;
    if (filter !== 'all' && i.status !== filter) return false;
    return true;
  });
  const acceptedCount = items.filter(i => i.status === 'accepted').length;

  const handleFileClick = (filePath) => {
    if (activeFile === filePath) {
      setActiveFile(null);
    } else {
      setActiveFile(filePath);
    }
  };

  return (
    <>
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      {/* PR Header */}
      <div className="overview-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 4 }}>{metadata.title || `PR #${prId}`}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {adoInfo?.author || metadata.author} → {metadata.targetBranch} &nbsp;|&nbsp; {repo} #{prId}
              {adoInfo?.isDraft && <span className="badge" style={{ marginLeft: 8, background: 'rgba(210,153,34,0.15)', color: 'var(--orange)' }}>Draft</span>}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
              {metadata.url && (
                <a href={metadata.url} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
                  Open in ADO ↗
                </a>
              )}
              {adoInfo && (
                <span className={`badge status-pr-${adoInfo.prStatus}`} style={{ fontSize: 12 }}>
                  {adoInfo.prStatus}{adoInfo.mergeStatus === 'conflicts' ? ' (conflicts)' : ''}
                </span>
              )}
              {metadata.status && (
                <span className={`badge ${
                  metadata.status === 'agent_review_failed' ? 'badge-high'
                  : metadata.status === 'agent_review_requested' ? 'status-pending'
                  : metadata.status === 'agent_review_done' ? 'badge-low'
                  : 'badge-unknown'
                }`} style={{ fontSize: 12 }}>
                  {metadata.status === 'agent_review_done' ? 'review complete'
                   : metadata.status === 'agent_review_requested' ? 'reviewing...'
                   : metadata.status === 'agent_review_failed' ? 'review failed'
                   : metadata.status}
                </span>
              )}
            </div>
            {adoInfo?.reviewers?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {adoInfo.reviewers.map((r, i) => (
                  <span key={i} className="badge" style={{
                    background: r.vote === 10 ? 'rgba(63,185,80,0.15)' : r.vote === 5 ? 'rgba(63,185,80,0.1)' :
                      r.vote === -10 ? 'rgba(248,81,73,0.15)' : r.vote === -5 ? 'rgba(210,153,34,0.15)' : 'rgba(139,148,158,0.1)',
                    color: r.vote === 10 ? 'var(--green)' : r.vote === 5 ? 'var(--green)' :
                      r.vote === -10 ? 'var(--red)' : r.vote === -5 ? 'var(--orange)' : 'var(--text-muted)',
                    fontSize: 12,
                  }}>
                    {r.vote === 10 ? '✓' : r.vote === 5 ? '~' : r.vote === -10 ? '✗' : r.vote === -5 ? '⏳' : '·'} {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {metadata.url && (
              <button
                className="btn btn-rerun"
                onClick={() => {
                  if (!showRelaunchPrompt && isFailed) {
                    setRelaunchText('The last review run exited prematurely. Resume the review of this PR from where it left off.');
                  }
                  setShowRelaunchPrompt(!showRelaunchPrompt);
                }}
              >
                Re-run Review
              </button>
            )}
            <RiskBadge level={risk.overallRisk} />
          </div>
        </div>
        {showRelaunchPrompt && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <textarea
              className="instructions-editor"
              style={{ minHeight: 60, marginBottom: 8 }}
              value={relaunchText}
              onChange={e => setRelaunchText(e.target.value)}
              placeholder="Additional instructions (optional) — e.g. 'Only write remaining files, worktree and feedback already exist' or 'Focus on security issues'"
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-post" onClick={handleRelaunch} disabled={relaunching}>
                {relaunching ? 'Launching…' : 'Launch'}
              </button>
              <button className="btn" onClick={() => { setShowRelaunchPrompt(false); setRelaunchText(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Agent Status for this PR */}
      <AgentStatusPanel repo={repo} prId={prId} onRelaunched={loadReview} />

      {/* Overview */}
      {overview && (
        <div className="overview-section">
          <h2>Overview</h2>
          <div className="markdown-body"><Markdown>{overview}</Markdown></div>
        </div>
      )}

      {/* Risk Assessment */}
      {risk.areas?.length > 0 && (
        <div className="overview-section">
          <h2>Risk Areas</h2>
          <div className="risk-grid">
            {risk.areas.map((a, i) => (
              <div key={i} className="risk-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>{a.area}</h4>
                  <RiskBadge level={a.risk} />
                </div>
                <p>{a.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Changed Files */}
      <ChangedFiles
        files={metadata.changedFiles || [...new Set(items.map(i => i.file).filter(Boolean))]}
        feedbackItems={items}
        activeFile={activeFile}
        onFileClick={handleFileClick}
      />

      {/* Feedback Section */}
      <div className="overview-section" style={{ background: 'transparent', border: 'none', padding: '0' }}>
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>
            {activeFile
              ? <>Feedback for <code style={{ fontSize: 14, color: 'var(--accent)' }}>{activeFile}</code> <button className="btn btn-sm" onClick={() => setActiveFile(null)} style={{ marginLeft: 8 }}>✕ Clear filter</button></>
              : `Feedback (${items.length})`
            }
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={acceptAll} disabled={!items.some(i => i.status === 'pending')}>
              <IconCheck /> Accept All Pending
            </button>
            <button
              className="btn btn-post"
              onClick={postAllAccepted}
              disabled={posting || acceptedCount === 0}
            >
              {posting ? 'Posting...' : <><IconSend /> Post {acceptedCount} Accepted to ADO</>}
            </button>
            <button
              className="btn btn-reject"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={items.length === 0}
              title="Delete all feedback"
            >
              <IconTrash />
            </button>
          </div>
        </div>

        {showDeleteConfirm && (
          <div className="card" style={{
            borderColor: 'var(--red)', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span>Delete all {items.length} feedback items? They will be moved to a backup folder.</span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn btn-reject btn-sm" onClick={deleteAllFeedback} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Yes, Delete All'}
              </button>
              <button className="btn btn-sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {postResult && (
          <div className="card" style={{
            borderColor: postResult.success ? 'var(--green)' : 'var(--red)',
            marginBottom: 16
          }}>
            {postResult.error
              ? <><IconX /> {postResult.error}</>
              : postResult.success
                ? <><IconCheck /> Successfully posted {postResult.posted} comment(s) to ADO</>
                : <>Posted {postResult.posted}, failed {postResult.failed}: {postResult.errors?.map(e => e.error).join('; ')}</>
            }
          </div>
        )}

        <div className="filter-bar">
          {['all', 'pending', 'accepted', 'noted', 'rejected', 'posted'].map(f => {
            const scope = activeFile ? items.filter(i => i.file === activeFile) : items;
            const count = f === 'all' ? scope.length : scope.filter(i => i.status === f).length;
            return (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">No feedback items match this filter</div>
        ) : (
          filtered.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              repo={repo}
              prId={prId}
              onAccept={(note) => updateStatus(item.id, 'accepted', note)}
              onNote={(note) => updateStatus(item.id, 'noted', note)}
              onReject={(note) => updateStatus(item.id, 'rejected', note)}
              onReset={() => updateStatus(item.id, 'pending')}
              onPost={() => postSingle(item.id)}
              onItemUpdated={loadReview}
            />
          ))
        )}
      </div>
    </>
  );
}

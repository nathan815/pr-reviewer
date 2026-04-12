import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import FeedbackCard from '../components/FeedbackCard';
import RiskBadge from '../components/RiskBadge';
import AgentStatusPanel from '../components/AgentStatusPanel';
import ChangedFiles from '../components/ChangedFiles';
import { IconArrowDown, IconArrowUp, IconCheck, IconX, IconSend, IconTrash } from '../components/Icons';

export default function ReviewDetail() {
  const { repo, prId } = useParams();
  const location = useLocation();
  const highlightId = location.hash ? location.hash.replace('#feedback-', '') : null;
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);
  const [relaunching, setRelaunching] = useState(false);
  const [showRelaunchPrompt, setShowRelaunchPrompt] = useState(false);
  const [relaunchText, setRelaunchText] = useState('');
  const [relaunchMode, setRelaunchMode] = useState('re-review');
  const [syncBeforeRelaunch, setSyncBeforeRelaunch] = useState(true);
  const [activeFile, setActiveFile] = useState(null);
  const [adoInfo, setAdoInfo] = useState(null);
  const [lockInfo, setLockInfo] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toolbarIsSticky, setToolbarIsSticky] = useState(false);
  const [currentFeedbackIndex, setCurrentFeedbackIndex] = useState(0);
  const [adoReplySyncStarted, setAdoReplySyncStarted] = useState(false);
  const [staleness, setStaleness] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [resolutions, setResolutions] = useState(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);
  const summaryRef = useRef(null);
  const riskRef = useRef(null);
  const changedFilesRef = useRef(null);
  const feedbackSectionRef = useRef(null);
  const toolbarRef = useRef(null);
  const items = review?.feedback?.items || [];
  const filtered = items.filter(i => {
    if (activeFile && i.file !== activeFile) return false;
    if (filter !== 'all' && i.status !== filter) return false;
    return true;
  });
  const itemNumbers = new Map(items.map((item, index) => [item.id, index + 1]));

  const loadReview = useCallback(() => {
    fetch(`/api/reviews/${repo}/${prId}`)
      .then(r => r.json())
      .then(data => { setReview(data); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`/api/reviews/${repo}/${prId}/resolutions`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setResolutions(data))
      .catch(() => {});
  }, [repo, prId]);

  useEffect(() => { loadReview(); }, [loadReview]);

  useEffect(() => {
    setAdoReplySyncStarted(false);
  }, [repo, prId]);

  useEffect(() => {
    if (adoReplySyncStarted) return;

    let cancelled = false;
    setAdoReplySyncStarted(true);

    fetch(`/api/reviews/${repo}/${prId}/sync-ado-replies`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) {
          loadReview();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [adoReplySyncStarted, loadReview, repo, prId]);

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

  // Check staleness on load
  useEffect(() => {
    fetch(`/api/reviews/${repo}/${prId}/staleness`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStaleness(data); })
      .catch(() => {});
  }, [repo, prId]);

  // Close ⋯ menu on click outside
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/reviews/${repo}/${prId}/sync`, { method: 'POST' });
      if (res.ok) {
        const result = await res.json();
        setStaleness({ stale: false, localCommit: result.newCommit, remoteCommit: result.newCommit });
        loadReview();
      }
    } catch { /* ignore */ }
    setSyncing(false);
  };

  // Poll lockfile status
  useEffect(() => {
    const loadLock = () =>
      fetch(`/api/reviews/${repo}/${prId}/lock-status`)
        .then(r => r.json())
        .then(setLockInfo)
        .catch(() => {});
    loadLock();
    const interval = setInterval(loadLock, 5000);
    return () => clearInterval(interval);
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

  useEffect(() => {
    const title = review?.metadata?.title || `PR #${prId}`;
    document.title = `${title} — PR Review`;
    return () => { document.title = 'PR Review Agent'; };
  }, [review?.metadata?.title, prId]);

  useEffect(() => {
    const updateStickyState = () => {
      const top = toolbarRef.current?.getBoundingClientRect().top;
      setToolbarIsSticky(typeof top === 'number' && top <= 0);
    };

    updateStickyState();
    window.addEventListener('scroll', updateStickyState, { passive: true });
    window.addEventListener('resize', updateStickyState);
    return () => {
      window.removeEventListener('scroll', updateStickyState);
      window.removeEventListener('resize', updateStickyState);
    };
  }, []);

  useEffect(() => {
    const updateCurrentFeedbackIndex = () => {
      const elements = filtered
        .map(item => document.getElementById(`feedback-${item.id}`))
        .filter(Boolean);

      if (!elements.length) {
        setCurrentFeedbackIndex(0);
        return;
      }

      const toolbarHeight = toolbarRef.current?.offsetHeight || 0;
      const anchorY = window.scrollY + toolbarHeight + 24;
      let index = elements.findIndex((element, i) => {
        const nextTop = elements[i + 1]?.offsetTop ?? Number.POSITIVE_INFINITY;
        return element.offsetTop <= anchorY && nextTop > anchorY;
      });

      if (index === -1) {
        index = anchorY < elements[0].offsetTop ? 0 : elements.length - 1;
      }

      setCurrentFeedbackIndex(index);
    };

    updateCurrentFeedbackIndex();
    window.addEventListener('scroll', updateCurrentFeedbackIndex, { passive: true });
    window.addEventListener('resize', updateCurrentFeedbackIndex);
    return () => {
      window.removeEventListener('scroll', updateCurrentFeedbackIndex);
      window.removeEventListener('resize', updateCurrentFeedbackIndex);
    };
  }, [filtered]);

  const updateStatus= async (feedbackId, status, userNote) => {
    const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/${feedbackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(userNote ? { userNote } : {}) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to update feedback (${res.status})`);
    }
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
    if (!window.confirm(`Accept all ${pendingIds.length} pending feedback item${pendingIds.length === 1 ? '' : 's'}?`)) {
      return;
    }
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
      // Sync worktree first if requested
      if (syncBeforeRelaunch) {
        const syncRes = await fetch(`/api/reviews/${repo}/${prId}/sync`, { method: 'POST' });
        if (syncRes.ok) {
          const result = await syncRes.json();
          setStaleness({ stale: false, localCommit: result.newCommit, remoteCommit: result.newCommit });
          if (result.updated) loadReview();
        }
      }
      await fetch('/api/agent/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prUrl: review.metadata.url,
          force: true,
          extraPrompt: relaunchText || undefined,
          reReviewMode: relaunchMode === 're-review' ? 'resolutions-only' : relaunchMode === 'full-re-review' ? 'full' : undefined,
        }),
      });
      setShowRelaunchPrompt(false);
      setRelaunchText('');
      setRelaunchMode('full');
      setTimeout(loadReview, 2000);
    } finally {
      setRelaunching(false);
    }
  };

  const handleResolutionAction = async (feedbackId, action, edits) => {
    let res;
    if (action === 'post' || action === 'resolve-only') {
      const endpoint = action === 'resolve-only' ? 'resolve-only' : 'post';
      res = await fetch(`/api/reviews/${repo}/${prId}/resolutions/${feedbackId}/${endpoint}`, { method: 'POST' });
    } else {
      res = await fetch(`/api/reviews/${repo}/${prId}/resolutions/${feedbackId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edits || {}),
      });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Action '${action}' failed`);
    }
    loadReview();
  };

  const resolveAllResolutions = async () => {
    setPosting(true);
    try {
      // Accept all first, then resolve-only all
      await fetch(`/api/reviews/${repo}/${prId}/resolutions-accept-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdicts: ['resolved'] }),
      });
      const res = await fetch(`/api/reviews/${repo}/${prId}/resolutions-post-accepted`, { method: 'POST' });
      const data = await res.json();
      setPostResult({ success: data.failed === 0, posted: data.posted, failed: data.failed });
    } catch (err) {
      setPostResult({ success: false, error: err.message });
    } finally {
      setPosting(false);
      loadReview();
    }
  };

  // Build resolution map: feedbackId → proposal
  const resolutionMap = {};
  if (resolutions?.proposals) {
    for (const p of resolutions.proposals) {
      resolutionMap[p.feedbackId] = p;
    }
  }
  const hasResolutions = Object.keys(resolutionMap).length > 0;
  const unpostedResolutions = resolutions?.proposals?.filter(p => (p.verdict === 'resolved' || p.verdict === 'partially-addressed') && !p.posted).length || 0;

  if (loading) return <div className="loading">Loading review</div>;
  if (!review) return <div className="empty-state">Review not found</div>;

  const { metadata, feedback, risk, overview } = review;
  const isFailed = metadata.status === 'agent_review_failed';
  const isRequested = metadata.status === 'agent_review_requested';
  const acceptedCount = items.filter(i => i.status === 'accepted').length;
  const pendingCount = items.filter(i => i.status === 'pending').length;
  const canGoPrevious = filtered.length > 0 && currentFeedbackIndex > 0;
  const canGoNext = filtered.length > 0 && currentFeedbackIndex < filtered.length - 1;

  const handleFileClick = (filePath) => {
    if (activeFile === filePath) {
      setActiveFile(null);
    } else {
      setActiveFile(filePath);
    }
  };

  const scrollToChangedFiles = () => {
    changedFilesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToSection = (ref) => {
    if (!ref.current) return;
    window.scrollTo({
      top: Math.max(0, ref.current.offsetTop - 12),
      behavior: 'smooth',
    });
  };

  const scrollToFeedback = (direction) => {
    const elements = filtered
      .map(item => document.getElementById(`feedback-${item.id}`))
      .filter(Boolean);

    if (!elements.length) return;

    const toolbarHeight = toolbarRef.current?.offsetHeight || 0;
    const targetIndex = direction > 0
      ? Math.min(elements.length - 1, currentFeedbackIndex + 1)
      : Math.max(0, currentFeedbackIndex - 1);
    const element = elements[targetIndex];
    setCurrentFeedbackIndex(targetIndex);

    window.scrollTo({
      top: Math.max(0, element.offsetTop - toolbarHeight - 12),
      behavior: 'smooth',
    });
  };

  return (
    <>

      {/* Staleness banner */}
      {staleness?.stale && (
        <div className="staleness-banner">
          <span>⚠ PR has been updated{staleness.updatesBehind != null ? ` (${staleness.updatesBehind} update${staleness.updatesBehind !== 1 ? 's' : ''} behind)` : ''}. Review may be stale. Sync now and optionally re-review.</span>
          <button className="btn btn-sm" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync PR'}
          </button>
        </div>
      )}
      {staleness?.error && !staleness?.stale && (
        <div className="staleness-banner staleness-warning">
          <span>⚠ Could not check for PR updates: {staleness.error}</span>
        </div>
      )}

      {/* PR Header */}
      <div className="overview-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 4 }}>{metadata.title || `PR #${prId}`}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {adoInfo?.author || metadata.author} &nbsp;|&nbsp; {metadata.sourceBranch || '?'} → {metadata.targetBranch || '?'} &nbsp;|&nbsp; {repo} #{prId}
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
                  PR: {adoInfo.prStatus}{adoInfo.mergeStatus === 'conflicts' ? ' (conflicts)' : ''}
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
              {lockInfo?.locked && (
                <span className={`badge ${lockInfo.alive ? 'status-pending' : 'badge-unknown'}`} style={{ fontSize: 12 }}>
                  {lockInfo.alive
                    ? <>agent running (PID {lockInfo.pid})</>
                    : <>lock stale (PID {lockInfo.pid} dead)</>}
                </span>
              )}
              {staleness && (
                <span className={`badge sync-status-badge ${staleness.error ? 'badge-unknown' : staleness.stale ? 'badge-medium' : 'badge-low'}`} style={{ fontSize: 12, position: 'relative', cursor: 'default' }}>
                  {staleness.error ? '⚠ sync unknown' : staleness.stale ? `⚠ ${staleness.updatesBehind != null ? `${staleness.updatesBehind} update${staleness.updatesBehind !== 1 ? 's' : ''} behind` : 'behind'}` : '✓ up to date'}
                  <span className="sync-status-popover">
                    <strong>Sync Status</strong>
                    <br />Local SHA: <code>{staleness.localCommit?.slice(0, 10) || '—'}</code>
                    <br />Remote SHA: <code>{staleness.remoteCommit?.slice(0, 10) || '—'}</code>
                    {staleness.updatesBehind != null && <><br />Updates behind: {staleness.updatesBehind}</>}
                    {staleness.totalIterations != null && <><br />Total iterations: {staleness.totalIterations}</>}
                    <br />Last checked: {staleness.checkedAt ? new Date(staleness.checkedAt).toLocaleString() : '—'}
                    {staleness.prUpdatedAt && <><br />PR last pushed: {new Date(staleness.prUpdatedAt).toLocaleString()}</>}
                    {staleness.firstReviewedAt && <><br />First reviewed: {new Date(staleness.firstReviewedAt).toLocaleString()}</>}
                    {staleness.reviewedAt && <><br />Last reviewed: {new Date(staleness.reviewedAt).toLocaleString()}</>}
                    {staleness.error && <><br /><em style={{ color: 'var(--red, #f85149)' }}>{staleness.error}</em></>}
                  </span>
                </span>
              )}
              <RiskBadge level={risk.overallRisk} prefix="risk:" />
            </div>

          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            {metadata.url && (
              <button
                className="btn btn-rerun"
                onClick={() => {
                  if (!showRelaunchPrompt && isFailed) {
                    setRelaunchText('');
                  }
                  setShowRelaunchPrompt(!showRelaunchPrompt);
                }}
              >
                Review Again
              </button>
            )}
            <div ref={moreMenuRef} style={{ position: 'relative' }}>
              <button
                className="btn btn-sm"
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                title="More actions"
                style={{ padding: '4px 8px', fontSize: 16, lineHeight: 1 }}
              >
                ⋯
              </button>
              {showMoreMenu && (
                <div className="more-menu-dropdown">
                  <button className="more-menu-item" onClick={() => { setShowMoreMenu(false); handleSync(); }} disabled={syncing}>
                    {syncing ? '⟳ Syncing…' : '⟳ Sync PR'}
                  </button>
                  <button className="more-menu-item" onClick={() => { setShowMoreMenu(false); setShowDeleteConfirm(true); }}>
                    🗑 Delete Review
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="review-jump-links">
          {overview && (
            <button className="btn btn-sm" onClick={() => scrollToSection(summaryRef)}>
              AI Summary
            </button>
          )}
          {risk.areas?.length > 0 && (
            <button className="btn btn-sm" onClick={() => scrollToSection(riskRef)}>
              Risk Areas
            </button>
          )}
          <button className="btn btn-sm" onClick={() => scrollToSection(changedFilesRef)}>
            Changed Files
          </button>
          <button className="btn btn-sm" onClick={() => scrollToSection(feedbackSectionRef)}>
            Feedback
          </button>
        </div>
        {showRelaunchPrompt && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <label style={{ fontSize: '0.85em', fontWeight: 600 }}>Mode:</label>
              <select
                value={relaunchMode}
                onChange={e => setRelaunchMode(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'inherit', fontSize: '0.85em' }}
              >
                <option value="full" style={{ background: '#1e1e1e', color: '#e0e0e0' }}>Full review (from scratch)</option>
                <option value="re-review" style={{ background: '#1e1e1e', color: '#e0e0e0' }}>Check resolutions only</option>
                <option value="full-re-review" style={{ background: '#1e1e1e', color: '#e0e0e0' }}>Re-review + new feedback</option>
              </select>
              <label style={{ fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                <input type="checkbox" checked={syncBeforeRelaunch} onChange={e => setSyncBeforeRelaunch(e.target.checked)} />
                Sync first
              </label>
            </div>
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
                {relaunching ? (syncBeforeRelaunch ? 'Syncing & Reviewing…' : 'Reviewing…') : 'Review'}
              </button>
              <button className="btn" onClick={() => { setShowRelaunchPrompt(false); setRelaunchText(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Reviewers */}
      {adoInfo?.reviewers?.length > 0 && (
        <div className="overview-section">
          <h2>Reviewers</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...adoInfo.reviewers].sort((a, b) => a.name.localeCompare(b.name)).map((r, i) => (
              <span key={i} className="badge" style={{
                background: r.vote === 10 ? 'rgba(63,185,80,0.15)' : r.vote === 5 ? 'rgba(63,185,80,0.1)' :
                  r.vote === -10 ? 'rgba(248,81,73,0.15)' : r.vote === -5 ? 'rgba(210,153,34,0.15)' : 'rgba(139,148,158,0.1)',
                color: r.vote === 10 ? 'var(--green)' : r.vote === 5 ? 'var(--green)' :
                  r.vote === -10 ? 'var(--red)' : r.vote === -5 ? 'var(--orange)' : 'var(--text-muted)',
              }}>
                {r.vote === 10 ? '✓' : r.vote === 5 ? '~' : r.vote === -10 ? '✗' : r.vote === -5 ? '⏳' : '·'} {r.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Agent Status for this PR */}
      <AgentStatusPanel repo={repo} prId={prId} onRelaunched={loadReview} />

      {/* Overview */}
      {overview && (
        <div className="overview-section" ref={summaryRef}>
          <h2>AI Summary</h2>
          <div className="markdown-body"><Markdown>{overview}</Markdown></div>
        </div>
      )}

      {/* Risk Assessment */}
      {risk.areas?.length > 0 && (
        <div className="overview-section" ref={riskRef}>
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
      <div ref={changedFilesRef}>
        <ChangedFiles
          files={metadata.changedFiles || [...new Set(items.map(i => i.file).filter(Boolean))]}
          feedbackItems={items}
          activeFile={activeFile}
          onFileClick={handleFileClick}
        />
      </div>

      {/* Feedback Section */}
      <div className="overview-section" style={{ background: 'transparent', border: 'none', padding: '0' }} ref={feedbackSectionRef}>
        <div className={`review-feedback-toolbar ${toolbarIsSticky ? 'is-sticky' : ''}`} ref={toolbarRef}>
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>Feedback ({items.length})</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => scrollToFeedback(-1)} disabled={!canGoPrevious}>
                <IconArrowUp /> Previous
              </button>
              <button className="btn btn-sm" onClick={() => scrollToFeedback(1)} disabled={!canGoNext}>
                <IconArrowDown /> Next
              </button>
              <button className="btn" onClick={acceptAll} disabled={pendingCount === 0}>
                <IconCheck /> Accept All Pending
              </button>
              <button
                className="btn btn-post"
                onClick={postAllAccepted}
                disabled={posting || acceptedCount === 0}
              >
                {posting ? 'Posting...' : <><IconSend /> Post {acceptedCount} Accepted to ADO</>}
              </button>
              {hasResolutions && (
                <>
                  <span style={{ borderLeft: '1px solid var(--border)', height: 20, margin: '0 4px' }} />
                  {unpostedResolutions > 0 && (
                    <button className="btn btn-sm" onClick={resolveAllResolutions} disabled={posting}>
                      <IconCheck /> Resolve All ({unpostedResolutions})
                    </button>
                  )}
                </>
              )}
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

          <div className="review-file-filter-row">
            <span className="review-file-filter-label">File Filter:</span>
            <button className="review-file-filter-button" onClick={scrollToChangedFiles}>
              {activeFile ? <code>{activeFile}</code> : <span className="review-file-filter-link-text">All files</span>}
            </button>
            {activeFile && (
              <button className="btn btn-sm" onClick={() => setActiveFile(null)}>
                Clear file filter
              </button>
            )}
          </div>

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

        {filtered.length === 0 ? (
          <div className="empty-state">No feedback items match this filter</div>
        ) : (
          filtered.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              itemNumber={itemNumbers.get(item.id)}
              repo={repo}
              prId={prId}
              prUrl={metadata.url}
              currentCommitSha={metadata.commitSha}
              onAccept={(note) => updateStatus(item.id, 'accepted', note)}
              onNote={(note) => updateStatus(item.id, 'noted', note)}
              onReject={(note) => updateStatus(item.id, 'rejected', note)}
              onReset={() => updateStatus(item.id, 'pending')}
              onPost={() => postSingle(item.id)}
              onItemUpdated={loadReview}
              resolution={resolutionMap[item.id] || null}
              onResolutionAction={handleResolutionAction}
            />
          ))
        )}
      </div>
    </>
  );
}

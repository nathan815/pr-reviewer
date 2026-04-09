import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import FeedbackCard from '../components/FeedbackCard';
import RiskBadge from '../components/RiskBadge';

export default function ReviewDetail() {
  const { repo, prId } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);

  const loadReview = useCallback(() => {
    fetch(`/api/reviews/${repo}/${prId}`)
      .then(r => r.json())
      .then(data => { setReview(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repo, prId]);

  useEffect(() => { loadReview(); }, [loadReview]);

  const updateStatus = async (feedbackId, status) => {
    await fetch(`/api/reviews/${repo}/${prId}/feedback/${feedbackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
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
      setPostResult(data);
      loadReview();
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

  if (loading) return <div className="loading">Loading review</div>;
  if (!review) return <div className="empty-state">Review not found</div>;

  const { metadata, feedback, risk, overview } = review;
  const items = feedback.items || [];
  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const acceptedCount = items.filter(i => i.status === 'accepted').length;

  return (
    <>
      <Link to="/" className="back-link">← Back to Dashboard</Link>

      {/* PR Header */}
      <div className="overview-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 4 }}>{metadata.title || `PR #${prId}`}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {metadata.author} → {metadata.targetBranch} &nbsp;|&nbsp; {repo} #{prId}
            </div>
            {metadata.url && (
              <a href={metadata.url} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
                Open in ADO ↗
              </a>
            )}
          </div>
          <RiskBadge level={risk.overallRisk} />
        </div>
      </div>

      {/* Overview */}
      {overview && (
        <div className="overview-section">
          <h2>Overview</h2>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{overview}</div>
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

      {/* Feedback Section */}
      <div className="overview-section" style={{ background: 'transparent', border: 'none', padding: '0' }}>
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Feedback ({items.length})</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={acceptAll} disabled={!items.some(i => i.status === 'pending')}>
              ✓ Accept All Pending
            </button>
            <button
              className="btn btn-post"
              onClick={postAllAccepted}
              disabled={posting || acceptedCount === 0}
            >
              {posting ? 'Posting...' : `📤 Post ${acceptedCount} Accepted to ADO`}
            </button>
          </div>
        </div>

        {postResult && (
          <div className="card" style={{
            borderColor: postResult.success ? 'var(--green)' : 'var(--red)',
            marginBottom: 16
          }}>
            {postResult.success
              ? `✅ Successfully posted ${postResult.posted} comment(s) to ADO`
              : `⚠️ Posted ${postResult.posted}, failed ${postResult.failed}`
            }
          </div>
        )}

        <div className="filter-bar">
          {['all', 'pending', 'accepted', 'rejected', 'posted'].map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && ` (${items.filter(i => i.status === f).length})`}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">No feedback items match this filter</div>
        ) : (
          filtered.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              onAccept={() => updateStatus(item.id, 'accepted')}
              onReject={() => updateStatus(item.id, 'rejected')}
              onReset={() => updateStatus(item.id, 'pending')}
              onPost={() => postSingle(item.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

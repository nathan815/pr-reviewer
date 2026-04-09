import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import RiskBadge from '../components/RiskBadge';

export default function Dashboard() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reviews')
      .then(r => r.json())
      .then(data => { setReviews(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading reviews</div>;

  if (reviews.length === 0) {
    return (
      <div className="empty-state">
        <h2>No PR reviews yet</h2>
        <p style={{ marginTop: 8 }}>
          Use the Copilot <code>/review-pr</code> skill to queue a PR for review.
          <br />
          Reviews will appear here once generated.
        </p>
      </div>
    );
  }

  // Stats
  const totalFeedback = reviews.reduce((s, r) => s + r.feedbackCount, 0);
  const totalPending = reviews.reduce((s, r) => s + r.pendingCount, 0);
  const totalPosted = reviews.reduce((s, r) => s + r.postedCount, 0);

  return (
    <>
      <div className="stats-row">
        <div className="stat-box">
          <div className="stat-value">{reviews.length}</div>
          <div className="stat-label">PRs Reviewed</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{totalFeedback}</div>
          <div className="stat-label">Total Feedback</div>
        </div>
        <div className="stat-box">
          <div className="stat-value" style={{ color: 'var(--orange)' }}>{totalPending}</div>
          <div className="stat-label">Pending Review</div>
        </div>
        <div className="stat-box">
          <div className="stat-value" style={{ color: 'var(--purple)' }}>{totalPosted}</div>
          <div className="stat-label">Posted to ADO</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="pr-table">
          <thead>
            <tr>
              <th>PR</th>
              <th>Author</th>
              <th>Risk</th>
              <th>Feedback</th>
              <th>Status</th>
              <th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map(r => (
              <tr key={`${r.repo}-${r.prId}`}>
                <td>
                  <Link to={`/review/${r.repo}/${r.prId}`}>
                    <strong>{r.title || `PR #${r.prId}`}</strong>
                  </Link>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.repo} #{r.prId}
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{r.author || '—'}</td>
                <td><RiskBadge level={r.overallRisk} /></td>
                <td>
                  <span>{r.feedbackCount} items</span>
                  {r.pendingCount > 0 && (
                    <span className="badge status-pending" style={{ marginLeft: 6 }}>
                      {r.pendingCount} pending
                    </span>
                  )}
                </td>
                <td>
                  {r.postedCount > 0 && (
                    <span className="badge status-posted">{r.postedCount} posted</span>
                  )}
                  {r.acceptedCount > 0 && (
                    <span className="badge status-accepted" style={{ marginLeft: 4 }}>
                      {r.acceptedCount} accepted
                    </span>
                  )}
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

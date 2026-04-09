import { useState } from 'react';
import RiskBadge from './RiskBadge';
import CodeSnippet from './CodeSnippet';

const CATEGORY_ICONS = {
  bug: '🐛',
  security: '🔒',
  performance: '⚡',
  style: '🎨',
  design: '📐',
  testing: '🧪',
  documentation: '📝',
};

export default function FeedbackCard({ item, repo, prId, onAccept, onReject, onReset, onPost }) {
  const [postingThis, setPostingThis] = useState(false);
  const [error, setError] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNote, setShowNote] = useState(false);

  const icon = CATEGORY_ICONS[item.category] || '💬';
  const isActionable = item.status === 'pending';
  const isAccepted = item.status === 'accepted';
  const isPosted = item.status === 'posted';
  const isRejected = item.status === 'rejected';

  const handlePost = async () => {
    setPostingThis(true);
    setError(null);
    try {
      await onPost();
    } catch (err) {
      setError(err.message);
    } finally {
      setPostingThis(false);
    }
  };

  return (
    <div className={`feedback-card severity-${item.severity}`}>
      <div className="feedback-header">
        <div className="feedback-header-left">
          <span>{icon}</span>
          {item.file && <span className="feedback-file">{item.file}</span>}
          {item.startLine && (
            <span className="feedback-lines">
              L{item.startLine}{item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ''}
            </span>
          )}
          <RiskBadge level={item.severity} />
          <span className="badge" style={{ textTransform: 'capitalize' }}>
            {item.category}
          </span>
        </div>
        <span className={`badge status-${item.status}`}>
          {item.status}
          {isPosted && item.adoThreadId && ` #${item.adoThreadId}`}
        </span>
      </div>

      <div className="feedback-body">
        {item.title && <strong style={{ display: 'block', marginBottom: 4 }}>{item.title}</strong>}
        <div className="feedback-comment">{item.comment}</div>
        {item.suggestion && (
          <div className="feedback-suggestion">{item.suggestion}</div>
        )}
      </div>

      {item.file && item.startLine && repo && prId && (
        <CodeSnippet
          repo={repo}
          prId={prId}
          file={item.file}
          startLine={item.startLine}
          endLine={item.endLine}
        />
      )}

      {error && (
        <div style={{
          margin: '0 16px 8px',
          padding: '8px 12px',
          background: 'rgba(248,81,73,0.1)',
          border: '1px solid rgba(248,81,73,0.3)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--red)',
        }}>
          ❌ {error}
        </div>
      )}

      <div className="feedback-actions">
        {isActionable && (
          <>
            <div className="feedback-note-row">
              <button
                className="btn btn-sm"
                onClick={() => setShowNote(!showNote)}
                style={{ color: 'var(--text-muted)', fontSize: 11 }}
              >
                {showNote ? '▼' : '▶'} Add note
              </button>
              {showNote && (
                <input
                  type="text"
                  className="feedback-note-input"
                  placeholder="Why accept/reject? (optional — helps train future reviews)"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') onAccept(noteText); }}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-accept btn-sm" onClick={() => onAccept(noteText)}>✓ Accept</button>
              <button className="btn btn-reject btn-sm" onClick={() => onReject(noteText)}>✗ Reject</button>
            </div>
          </>
        )}
        {(isAccepted || isRejected) && item.userNote && (
          <div className="feedback-user-note">📝 {item.userNote}</div>
        )}
        {isAccepted && (
          <>
            <button className="btn btn-post btn-sm" onClick={handlePost} disabled={postingThis}>
              {postingThis ? '⏳ Posting...' : '📤 Post to ADO'}
            </button>
            <button className="btn btn-sm" onClick={onReset}>↩ Reset</button>
          </>
        )}
        {isRejected && (
          <button className="btn btn-sm" onClick={onReset}>↩ Reconsider</button>
        )}
        {isPosted && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 10px' }}>
            ✅ Posted to ADO
          </span>
        )}
      </div>
    </div>
  );
}

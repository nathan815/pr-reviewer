import { useState, useEffect } from 'react';
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

export default function FeedbackCard({ item, repo, prId, onAccept, onNote, onReject, onReset, onPost, onItemUpdated }) {
  const [postingThis, setPostingThis] = useState(false);
  const [error, setError] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [discussionInput, setDiscussionInput] = useState('');
  const [discussing, setDiscussing] = useState(false);
  const [discussionStatus, setDiscussionStatus] = useState(null);
  const [showEditHistory, setShowEditHistory] = useState(false);

  const icon = CATEGORY_ICONS[item.category] || '💬';
  const isActionable = item.status === 'pending';
  const isAccepted = item.status === 'accepted';
  const isNoted = item.status === 'noted';
  const isPosted = item.status === 'posted';
  const isRejected = item.status === 'rejected';
  const discussion = item.discussion || [];

  // Check if a discussion agent is already running on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/${item.id}/discuss`);
        const data = await res.json();
        if (!cancelled && data.status === 'running') {
          setDiscussing(true);
          setShowDiscussion(true);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [repo, prId, item.id]);

  // Poll discussion agent status when active
  useEffect(() => {
    if (!discussing) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/${item.id}/discuss`);
        const data = await res.json();
        setDiscussionStatus(data);
        if (data.status === 'completed' || data.status === 'failed') {
          setDiscussing(false);
          onItemUpdated?.(); // reload review to get updated discussion + potential edits
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [discussing, repo, prId, item.id]);


  const handleAsk = async () => {
    if (!discussionInput.trim()) return;
    setDiscussing(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/${item.id}/discuss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: discussionInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start discussion');
      }
      setDiscussionInput('');
      onItemUpdated?.(); // reload to show user message immediately
    } catch (err) {
      setError(err.message);
      setDiscussing(false);
    }
  };

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
    <div id={`feedback-${item.id}`} className={`feedback-card severity-${item.severity}`}>
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
          {item.editHistory?.length > 0 && (
            <span
              className="badge badge-info"
              style={{ cursor: 'pointer', fontSize: 10 }}
              onClick={() => setShowEditHistory(!showEditHistory)}
            >
              edited {item.editHistory.length}x
            </span>
          )}
        </div>
        <span className={`badge status-${item.status}`}>
          {item.status}
          {isPosted && item.adoThreadId && ` #${item.adoThreadId}`}
        </span>
      </div>

      {/* Edit history */}
      {showEditHistory && item.editHistory?.map((edit, i) => (
        <div key={i} style={{
          margin: '0 16px 4px', padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)',
          background: 'rgba(88,166,255,0.05)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: 4,
        }}>
          <div style={{ marginBottom: 2 }}>Edited by {edit.editedBy} · {new Date(edit.editedAt).toLocaleString()}</div>
          {Object.entries(edit.previous).map(([field, val]) => (
            <div key={field}><strong>{field}</strong> was: <em style={{ whiteSpace: 'pre-wrap' }}>{String(val)}</em></div>
          ))}
        </div>
      ))}

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
          commitSha={item.commitSha}
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
          {error}
        </div>
      )}

      {/* Discussion thread */}
      <div style={{ padding: '0 16px 4px' }}>
        <button
          className="btn btn-sm"
          onClick={() => setShowDiscussion(!showDiscussion)}
          style={{ color: 'var(--text-muted)', fontSize: 11 }}
        >
          {showDiscussion ? '▼' : '▶'} Discuss{discussion.length > 0 ? ` (${discussion.length})` : ''}
        </button>
      </div>

      {showDiscussion && (
        <div style={{ margin: '0 16px 8px', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {discussion.map((msg, i) => (
            <div key={i} style={{
              marginBottom: 8,
              padding: '8px 10px',
              borderRadius: 6,
              fontSize: 13,
              lineHeight: 1.5,
              background: msg.role === 'user' ? 'rgba(88,166,255,0.08)' : 'rgba(63,185,80,0.08)',
              borderLeft: `3px solid ${msg.role === 'user' ? 'var(--accent)' : 'var(--green)'}`,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {msg.role === 'user' ? 'You' : 'Agent'} · {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.message}</div>
            </div>
          ))}
          {discussing && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
              Agent is thinking...
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              type="text"
              className="feedback-note-input"
              style={{ flex: 1 }}
              placeholder="Ask about this feedback..."
              value={discussionInput}
              onChange={e => setDiscussionInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !discussing) handleAsk(); }}
              disabled={discussing}
            />
            <button
              className="btn btn-sm btn-post"
              onClick={handleAsk}
              disabled={discussing || !discussionInput.trim()}
            >
              Ask
            </button>
          </div>
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
                {showNote ? '▼' : '▶'} Add feedback to agent
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
              <button className="btn btn-noted btn-sm" onClick={() => onNote(noteText)}>✓ Accept As Note</button>
              <button className="btn btn-reject btn-sm" onClick={() => onReject(noteText)}>✗ Reject</button>
            </div>
          </>
        )}
        {(isAccepted || isRejected || isNoted) && item.userNote && (
          <div className="feedback-user-note">📝 {item.userNote}</div>
        )}
        {isAccepted && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-post btn-sm" onClick={handlePost} disabled={postingThis}>
              {postingThis ? '⏳ Posting...' : '📤 Post to ADO'}
            </button>
            <button className="btn btn-sm" onClick={onReset}>↩ Reset</button>
          </div>
        )}
        {isNoted && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 0' }}>Noted — won't post to ADO</span>
            <button className="btn btn-sm" onClick={onReset}>↩ Reset</button>
          </div>
        )}
        {isRejected && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={onReset}>↩ Reconsider</button>
          </div>
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

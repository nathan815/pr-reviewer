import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import RiskBadge from './RiskBadge';
import CodeSnippet from './CodeSnippet';
import { IconBug, IconLock, IconZap, IconPalette, IconRuler, IconTestTube, IconDocs, IconComment, IconCheck, IconX, IconSend, IconReset, IconNote, IconClock } from './Icons';

const CATEGORY_ICONS = {
  bug: <IconBug />,
  security: <IconLock />,
  performance: <IconZap />,
  style: <IconPalette />,
  design: <IconRuler />,
  testing: <IconTestTube />,
  documentation: <IconDocs />,
};

const EDIT_FIELD_LABELS = {
  title: 'title',
  comment: 'comment',
  suggestion: 'suggestion',
  severity: 'severity',
  category: 'category',
  startLine: 'start line',
  endLine: 'end line',
  file: 'file',
};

function formatEditSummary(editSummary) {
  const labels = (editSummary?.changes || []).map(change => EDIT_FIELD_LABELS[change.field] || change.field);
  if (labels.length === 0) return null;
  return labels.map(label => `updated ${label}`);
}

const DECISION_CONFIG = {
  accepted: {
    label: 'Accept',
    pastLabel: 'Accepted',
    buttonClass: 'btn-accept',
    labelColor: 'var(--green)',
    icon: <IconCheck />,
  },
  noted: {
    label: 'Accept As Note',
    pastLabel: 'Noted',
    buttonClass: 'btn-noted',
    labelColor: 'var(--accent)',
    icon: <IconCheck />,
  },
  rejected: {
    label: 'Reject',
    pastLabel: 'Rejected',
    buttonClass: 'btn-reject',
    labelColor: 'var(--red)',
    icon: <IconX />,
  },
};

const VERDICT_STYLES = {
  resolved: { bg: 'rgba(63,185,80,0.1)', border: 'rgba(63,185,80,0.3)', color: '#3fb950', label: '✓ Resolved' },
  'partially-addressed': { bg: 'rgba(210,153,34,0.1)', border: 'rgba(210,153,34,0.3)', color: '#d29922', label: '◐ Partially addressed' },
  'still-open': { bg: 'rgba(139,148,158,0.08)', border: 'rgba(139,148,158,0.2)', color: 'var(--text-muted)', label: '○ Still open' },
  'cant-determine': { bg: 'rgba(139,148,158,0.08)', border: 'rgba(139,148,158,0.2)', color: 'var(--text-muted)', label: '? Cannot determine' },
};

function ResolutionBanner({ resolution, onAction, feedbackId }) {
  const [editingReply, setEditingReply] = useState(false);
  const [replyText, setReplyText] = useState(resolution.proposedReply || '');
  const [activeAction, setActiveAction] = useState(null); // 'accept' | 'acceptReply' | null
  const [error, setError] = useState(null);

  const style = VERDICT_STYLES[resolution.verdict] || VERDICT_STYLES['still-open'];
  const isDismissed = resolution.accepted === 'dismissed';
  const isPosted = !!resolution.posted;

  useEffect(() => {
    setReplyText(resolution.proposedReply || '');
  }, [resolution.proposedReply]);

  const runAction = async (fn) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const handleDismiss = () => runAction(() => onAction?.(feedbackId, 'dismiss'));
  const handleUndo = () => runAction(() => onAction?.(feedbackId, 'undismiss', { proposedReply: replyText }));
  const handleAcceptAndReply = () => runAction(async () => {
    setActiveAction('acceptReply');
    try {
      await onAction?.(feedbackId, 'accept', { proposedReply: replyText });
      await onAction?.(feedbackId, 'post');
    } finally {
      setActiveAction(null);
    }
  });
  const handleAccept = () => runAction(async () => {
    setActiveAction('accept');
    try {
      await onAction?.(feedbackId, 'resolve-only');
    } finally {
      setActiveAction(null);
    }
  });
  const handleSaveReply = async () => {
    setEditingReply(false);
  };

  return (
    <div className="resolution-banner" style={{ background: style.bg, borderColor: style.border }}>
      <div className="resolution-banner-header">
        <span style={{ color: style.color, fontWeight: 600 }}>Agent Says: &nbsp;{style.label}</span>
        {resolution.confidence && (
          <span className="badge" style={{ fontSize: 10 }}>{resolution.confidence} confidence</span>
        )}
        {isPosted && (
          <span className="badge badge-low" style={{ fontSize: 10 }}>✓ Accepted</span>
        )}
      </div>

      {resolution.reasoning && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0' }}>
          {resolution.reasoning}
        </div>
      )}

      {resolution.proposedReply && !isPosted && (
        <div style={{ margin: '8px 0 4px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Proposed ADO reply:</div>
          {editingReply ? (
            <div>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                style={{ width: '100%', minHeight: 60, fontSize: 13, background: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="btn btn-sm btn-accept" onClick={handleSaveReply}>Done</button>
                <button className="btn btn-sm" onClick={() => { setReplyText(resolution.proposedReply || ''); setEditingReply(false); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div
              style={{ fontSize: 13, padding: '6px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 4, cursor: 'pointer' }}
              onClick={() => setEditingReply(true)}
              title="Click to edit reply"
            >
              <Markdown>{replyText}</Markdown>
            </div>
          )}
        </div>
      )}

      {!isPosted && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          {!isDismissed && (resolution.verdict === 'resolved' || resolution.verdict === 'partially-addressed') && (
            <>
              <button className="btn btn-sm btn-accept" onClick={handleAcceptAndReply} disabled={!!activeAction}>
                {activeAction === 'acceptReply' ? 'Posting…' : 'Resolve & Reply'}
              </button>
              <button className="btn btn-sm btn-accept" onClick={handleAccept} disabled={!!activeAction} title="Resolve thread in ADO without posting a reply">
                {activeAction === 'accept' ? 'Resolving…' : 'Resolve'}
              </button>
              <button className="btn btn-sm" onClick={handleDismiss} disabled={!!activeAction}>Dismiss</button>
              <button className="btn btn-sm" onClick={() => setEditingReply(true)}>Edit Reply</button>
            </>
          )}
          {isDismissed && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Dismissed — <button className="btn btn-sm" onClick={handleUndo} style={{ fontSize: 11 }}>undo</button>
            </span>
          )}
        </div>
      )}
      {error && (
        <div style={{ color: '#f44', fontSize: 12, marginTop: 6, padding: '4px 8px', background: 'rgba(255,68,68,0.1)', borderRadius: 4 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function buildAdoFileUrl(prUrl, filePath, startLine, endLine) {
  if (!prUrl || !filePath) return null;

  try {
    const url = new URL(prUrl);
    const normalizedPath = filePath.startsWith('/') ? filePath.replace(/\\/g, '/') : `/${filePath.replace(/\\/g, '/')}`;
    url.searchParams.set('_a', 'files');
    url.searchParams.set('path', normalizedPath);
    if (startLine) {
      url.searchParams.set('line', String(startLine));
      url.searchParams.set('lineStartColumn', '1');
      url.searchParams.set('lineEndColumn', '1');
      url.searchParams.set('lineStyle', 'plain');
      if (endLine && endLine !== startLine) {
        url.searchParams.set('lineEnd', String(endLine));
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export default function FeedbackCard({ item, itemNumber, repo, prId, prUrl, currentCommitSha, resolution, onAccept, onNote, onReject, onReset, onPost, onItemUpdated, onResolutionAction }) {
  const [postingThis, setPostingThis] = useState(false);
  const [error, setError] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(false);
  const [discussionInput, setDiscussionInput] = useState('');
  const [discussing, setDiscussing] = useState(false);
  const [discussionStatus, setDiscussionStatus] = useState(null);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [showAdoThread, setShowAdoThread] = useState(false);
  const [adoThreadLoading, setAdoThreadLoading] = useState(false);
  const [adoThreadError, setAdoThreadError] = useState(null);
  const [adoReplies, setAdoReplies] = useState(item.adoReplies || []);
  const noteInputRef = useRef(null);

  const icon = CATEGORY_ICONS[item.category] || <IconComment />;
  const isActionable = item.status === 'pending';
  const isAccepted = item.status === 'accepted';
  const isNoted = item.status === 'noted';
  const isPosted = item.status === 'posted';
  const isRejected = item.status === 'rejected';
  const discussion = item.discussion || [];
  const fileUrl = buildAdoFileUrl(prUrl, item.file, item.startLine, item.endLine);
  const persistedDecision = isPosted ? 'accepted' : isAccepted ? 'accepted' : isNoted ? 'noted' : isRejected ? 'rejected' : null;
  const activeDecision = isActionable ? selectedDecision : persistedDecision;
  const decisionButtonsDisabled = !isActionable || submittingDecision;

  useEffect(() => {
    setAdoReplies(item.adoReplies || []);
    setAdoThreadError(null);
  }, [item.id, item.adoReplies]);

  useEffect(() => {
    setSelectedDecision(null);
    setSubmittingDecision(false);
    setNoteText(item.userNote || '');
    setError(null);
  }, [item.id, item.status, item.userNote]);

  useEffect(() => {
    if (!isActionable || !selectedDecision || submittingDecision) return;
    noteInputRef.current?.focus();
  }, [isActionable, selectedDecision, submittingDecision]);

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

  const handleDecisionSubmit = async () => {
    if (!selectedDecision) return;

    const submitters = {
      accepted: onAccept,
      noted: onNote,
      rejected: onReject,
    };

    const submit = submitters[selectedDecision];
    if (!submit) return;

    setSubmittingDecision(true);
    setError(null);
    try {
      await submit(noteText);
    } catch (err) {
      setError(err.message);
      setSubmittingDecision(false);
    }
  };

  const handleToggleAdoThread = async () => {
    const nextOpen = !showAdoThread;
    setShowAdoThread(nextOpen);
    if (!nextOpen || !item.adoThreadId || adoThreadLoading) return;

    setAdoThreadLoading(true);
    setAdoThreadError(null);
    try {
      const res = await fetch(`/api/reviews/${repo}/${prId}/feedback/${item.id}/ado-thread`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ADO thread');
      setAdoReplies(data.replies || []);
    } catch (err) {
      setAdoThreadError(err.message);
    } finally {
      setAdoThreadLoading(false);
    }
  };

  return (
    <div id={`feedback-${item.id}`} className={`feedback-card severity-${item.severity}`}>
      <div className="feedback-header">
        <div className="feedback-header-left">
          <a href={`#feedback-${item.id}`} className="feedback-number-link">
            <span className="feedback-number-badge">#{itemNumber}</span>
          </a>
          <span>{icon}</span>
          {item.file && (
            fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="feedback-file feedback-file-link"
                title="Open this file in ADO"
              >
                {item.file}
              </a>
            ) : (
              <span className="feedback-file">{item.file}</span>
            )
          )}
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span className={`badge status-${item.status}`}>
            {item.status}
            {isPosted && item.adoThreadId && ` #${item.adoThreadId}`}
          </span>
          {isPosted && item.adoThreadStatus && (
            <span className={`badge status-ado-${item.adoThreadStatus}`} title="ADO thread status">
              {item.adoThreadStatus === 'active' ? '💬 Active' :
               item.adoThreadStatus === 'fixed' ? '✓ Fixed' :
               item.adoThreadStatus === 'closed' ? '✓ Closed' :
               item.adoThreadStatus === 'wontFix' ? '✕ Won\'t Fix' :
               item.adoThreadStatus === 'byDesign' ? '✓ By Design' :
               item.adoThreadStatus === 'pending' ? '⏳ Pending' :
               item.adoThreadStatus === 'unknown' ? '? Unknown' :
               item.adoThreadStatus}
            </span>
          )}
        </div>
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
        <div className="feedback-comment">
          <Markdown>{item.comment}</Markdown>
          {item.suggestion && (
            <Markdown>{`**Suggestion:**\n${item.suggestion}`}</Markdown>
          )}
        </div>
      </div>

      {item.file && item.startLine && repo && prId && (
        <CodeSnippet
          repo={repo}
          prId={prId}
          file={item.file}
          startLine={item.startLine}
          endLine={item.endLine}
          commitSha={item.commitSha}
          currentCommitSha={currentCommitSha}
        />
      )}

      {/* Resolution proposal banner */}
      {resolution && (
        <ResolutionBanner
          resolution={resolution}
          onAction={onResolutionAction}
          feedbackId={item.id}
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

      <div className="feedback-thread-toggles">
        <button
          className="btn btn-sm"
          onClick={() => setShowDiscussion(!showDiscussion)}
          style={{ color: 'var(--text-muted)', fontSize: 11 }}
        >
          {showDiscussion ? '▼' : '▶'} Discuss with Agent{discussion.length > 0 ? ` (${discussion.length})` : ''}
        </button>
        {item.adoThreadId && (
          <button
            className="btn btn-sm"
            onClick={handleToggleAdoThread}
            style={{ color: 'var(--text-muted)', fontSize: 11 }}
          >
            {showAdoThread ? '▼' : '▶'} ADO Thread{adoReplies.length > 0 ? ` (${adoReplies.length})` : ''}
          </button>
        )}
      </div>

      {showDiscussion && (
        <div className="feedback-thread-panel">
          {discussion.map((msg, i) => (
            <div key={i} className={`discussion-message discussion-message-${msg.role}`}>
              <div className="discussion-message-meta">
                {msg.role === 'user' ? 'You' : 'Agent'} · {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
              <div className="feedback-comment" style={{ fontSize: 13 }}><Markdown>{msg.message}</Markdown></div>
              {msg.role === 'agent' && formatEditSummary(msg.editSummary) && (
                <div className="discussion-edit-summary">
                  <div className="discussion-edit-summary-label">Changes made</div>
                  <div className="discussion-edit-summary-items">
                    {formatEditSummary(msg.editSummary).map(change => (
                      <span key={change} className="discussion-edit-chip">{change}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {discussing && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="discuss-spinner" /> Agent is thinking...
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              type="text"
              className="feedback-note-input"
              style={{ flex: 1 }}
              placeholder="Request agent make changes or answer questions about this feedback"
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
              Send
            </button>
          </div>
        </div>
      )}

      {showAdoThread && item.adoThreadId && (
        <div className="feedback-thread-panel">
          {adoThreadLoading && (
            <div className="thread-inline-status">
              <span className="discuss-spinner" /> Loading ADO thread...
            </div>
          )}
          {adoThreadError && (
            <div className="thread-inline-error">{adoThreadError}</div>
          )}
          {!adoThreadLoading && !adoThreadError && adoReplies.length === 0 && (
            <div className="ado-thread-empty">No replies yet on this ADO thread.</div>
          )}
          {adoReplies.map(reply => (
            <div key={reply.commentId} className="ado-thread-message">
              <div className="discussion-message-meta">
                {reply.author} · {new Date(reply.timestamp).toLocaleString()}
              </div>
              <div className="feedback-comment" style={{ fontSize: 13 }}>
                <Markdown>{reply.content}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="feedback-actions">
        <div className="feedback-decision-section">
          <div className="feedback-decision-buttons">
            {isActionable ? (
              Object.entries(DECISION_CONFIG).map(([decision, config]) => (
                <button
                  key={decision}
                  className={`btn btn-sm ${config.buttonClass} ${activeDecision === decision ? 'is-selected' : ''}`}
                  onClick={() => {
                    if (submittingDecision) return;
                    setSelectedDecision(decision);
                  }}
                  disabled={submittingDecision}
                >
                  {config.icon} {config.label}
                </button>
              ))
            ) : persistedDecision && DECISION_CONFIG[persistedDecision] ? (
              <span className="feedback-decision-label" style={{ color: DECISION_CONFIG[persistedDecision].labelColor }}>
                {DECISION_CONFIG[persistedDecision].icon} {DECISION_CONFIG[persistedDecision].pastLabel}
              </span>
            ) : null}
          </div>
          {isActionable && selectedDecision && (
            <div className="feedback-decision-form">
              <input
                ref={noteInputRef}
                type="text"
                className="feedback-note-input"
                placeholder="Optional feedback about this decision — helps train future reviews"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !submittingDecision) {
                    handleDecisionSubmit();
                  }
                }}
                disabled={submittingDecision}
              />
              <div className="feedback-decision-form-actions">
                <button
                  className={`btn btn-sm ${DECISION_CONFIG[selectedDecision].buttonClass}`}
                  onClick={handleDecisionSubmit}
                  disabled={submittingDecision}
                >
                  {submittingDecision ? <><IconClock /> Submitting...</> : <><IconSend /> Submit {DECISION_CONFIG[selectedDecision].label}</>}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setSelectedDecision(null);
                    setNoteText('');
                  }}
                  disabled={submittingDecision}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {(isAccepted || isRejected || isNoted || isPosted) && item.userNote && (
          <div className="feedback-user-note"><IconNote /> <strong>Internal Note to Agent:</strong> {item.userNote}</div>
        )}
        {isAccepted && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-post btn-sm" onClick={handlePost} disabled={postingThis}>
              {postingThis ? <><IconClock /> Posting...</> : <><IconSend /> Post to ADO</>}
            </button>
            <button className="btn btn-sm" onClick={onReset}><IconReset /> Reset</button>
          </div>
        )}
        {isNoted && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 0' }}>Noted — won't post to ADO</span>
            <button className="btn btn-sm" onClick={onReset}><IconReset /> Reset</button>
          </div>
        )}
        {isRejected && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={onReset}><IconReset /> Reconsider</button>
          </div>
        )}
        {isPosted && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconCheck /> Posted to ADO
          </span>
        )}
      </div>
      <div className="feedback-footer-meta">
        <span className="feedback-id-meta">{item.id}</span>
      </div>
    </div>
  );
}

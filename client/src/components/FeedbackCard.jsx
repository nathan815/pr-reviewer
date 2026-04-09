import RiskBadge from './RiskBadge';

const CATEGORY_ICONS = {
  bug: '🐛',
  security: '🔒',
  performance: '⚡',
  style: '🎨',
  design: '📐',
  testing: '🧪',
  documentation: '📝',
};

export default function FeedbackCard({ item, onAccept, onReject, onReset, onPost }) {
  const icon = CATEGORY_ICONS[item.category] || '💬';
  const isActionable = item.status === 'pending';
  const isAccepted = item.status === 'accepted';
  const isPosted = item.status === 'posted';
  const isRejected = item.status === 'rejected';

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

      <div className="feedback-actions">
        {isActionable && (
          <>
            <button className="btn btn-accept btn-sm" onClick={onAccept}>✓ Accept</button>
            <button className="btn btn-reject btn-sm" onClick={onReject}>✗ Reject</button>
          </>
        )}
        {isAccepted && (
          <>
            <button className="btn btn-post btn-sm" onClick={onPost}>📤 Post to ADO</button>
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

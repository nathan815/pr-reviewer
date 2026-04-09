import { useState, useEffect } from 'react';

export default function NewReviewModal({ open, onClose, onLaunched }) {
  const [prUrl, setPrUrl] = useState('');
  const [config, setConfig] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      fetch('/api/agent/config').then(r => r.json()).then(setConfig).catch(() => {});
      setResult(null);
      setError(null);
      setPrUrl('');
    }
  }, [open]);

  const handleLaunch = async () => {
    if (!prUrl.trim()) return;
    setLaunching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/agent/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
      } else {
        setResult(data);
        onLaunched?.(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLaunching(false);
    }
  };

  const switchProfile = async (profile) => {
    try {
      const res = await fetch('/api/agent/config/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (res.ok) setConfig(data);
    } catch {}
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔍 New PR Review</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <label className="form-label">PR URL</label>
          <input
            className="form-input"
            type="text"
            placeholder="https://dev.azure.com/org/project/_git/repo/pullrequest/12345"
            value={prUrl}
            onChange={e => setPrUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLaunch()}
            autoFocus
          />

          {config?.profiles && (
            <div style={{ marginTop: 16 }}>
              <label className="form-label">Agent Profile</label>
              <div className="profile-selector">
                {Object.keys(config.profiles).map(name => (
                  <button
                    key={name}
                    className={`profile-btn ${config.activeProfile === name ? 'active' : ''}`}
                    onClick={() => switchProfile(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {config.activeProfile && config.profiles[config.activeProfile] && (
                <div className="profile-detail">
                  <code>{config.profiles[config.activeProfile].program} {config.profiles[config.activeProfile].args.join(' ')}</code>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="modal-error">❌ {error}</div>
          )}

          {result && (
            <div className="modal-success">
              {result.status === 'launched'
                ? `✅ Review agent launched (PID ${result.pid}, profile: ${result.profileName})`
                : result.status === 'already_running'
                  ? `⚠️ A review agent is already running for this PR (PID ${result.pid})`
                  : `Status: ${result.status}`
              }
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-post"
            onClick={handleLaunch}
            disabled={launching || !prUrl.trim() || !!result}
          >
            {launching ? '⏳ Launching...' : '🚀 Launch Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

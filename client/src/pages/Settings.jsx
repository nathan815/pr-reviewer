import { useState, useEffect, useRef } from 'react';

export default function Settings() {
  const [content, setContent] = useState('');
  const [instrSaved, setInstrSaved] = useState(false);
  const [config, setConfig] = useState(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState(null);
  const [loading, setLoading] = useState(true);
  const instrTimer = useRef(null);
  const configTimer = useRef(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/extra-instructions').then(r => r.json()),
      fetch('/api/agent/config').then(r => r.json()),
    ]).then(([instrData, cfgData]) => {
      setContent(instrData.content || '');
      setConfig(cfgData);
      setConfigText(JSON.stringify(cfgData, null, 2));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const saveInstructions = async () => {
    await fetch('/api/settings/extra-instructions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    setInstrSaved(true);
    clearTimeout(instrTimer.current);
    instrTimer.current = setTimeout(() => setInstrSaved(false), 2000);
  };

  const saveConfig = async () => {
    setConfigError(null);
    let parsed;
    try {
      parsed = JSON.parse(configText);
    } catch (e) {
      setConfigError('Invalid JSON: ' + e.message);
      return;
    }
    try {
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data);
      setConfigText(JSON.stringify(data, null, 2));
      setConfigSaved(true);
      clearTimeout(configTimer.current);
      configTimer.current = setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      setConfigError(e.message);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title">Configuration</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>
          Active agent profile: <strong style={{ color: 'var(--accent)' }}>{config?.activeProfile || 'default'}</strong>
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Define agent profiles under <code>profiles</code> — each needs <code>program</code> and <code>args</code>.
          Use <code>{'{{prUrl}}'}</code> as a placeholder for the PR URL in args.
          ADO defaults are in <code>ado.org</code> / <code>ado.project</code>; env vars <code>ADO_ORG</code> and <code>ADO_PROJECT</code> override them.
        </p>
        <textarea
          className="instructions-editor"
          value={configText}
          onChange={e => { setConfigText(e.target.value); setConfigError(null); }}
          spellCheck={false}
          style={{ minHeight: 200 }}
        />
        {configError && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 6 }}>{configError}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
          <button className="btn btn-post" onClick={saveConfig}>Save</button>
          {configSaved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Saved ✓</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title">Extra Instructions</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Custom instructions passed to the review agent on every run. Use this to tell it where repos live,
          which patterns to focus on, coding conventions, or any other context it should know.
          This file is saved at <code>~/pr-reviews/extra_instructions.md</code>.
        </p>
        <textarea
          className="instructions-editor"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`Example:\n\n# Repo Locations\nRepos can be found at C:\\projects or $HOME. Check both before cloning.\n\n# Review Preferences\n- Focus on null-safety and error handling\n- Ignore minor formatting issues`}
          spellCheck={false}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
          <button className="btn btn-post" onClick={saveInstructions}>Save</button>
          {instrSaved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Saved ✓</span>}
        </div>
      </div>
    </>
  );
}

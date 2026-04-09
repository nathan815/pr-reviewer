import { useState, useEffect, useRef } from 'react';

export default function Settings() {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch('/api/settings/extra-instructions')
      .then(r => r.json())
      .then(data => { setContent(data.content || ''); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    await fetch('/api/settings/extra-instructions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    setSaved(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <>
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
          <button className="btn btn-post" onClick={save}>Save</button>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Saved ✓</span>}
        </div>
      </div>
    </>
  );
}

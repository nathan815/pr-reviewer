import { useState, useEffect } from 'react';
import { IconComment } from './Icons';
const CONTEXT_LINES = 5;

export default function CodeSnippet({ repo, prId, file, startLine, endLine, commitSha, comment }) {
  const [fileContent, setFileContent] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchFile = () => {
    if (fileContent !== null) return;
    setLoading(true);
    const params = new URLSearchParams({ path: file });
    if (commitSha) params.set('commit', commitSha);
    fetch(`/api/reviews/${repo}/${prId}/file?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'File not in worktree' : `HTTP ${r.status}`);
        return r.text();
      })
      .then(text => { setFileContent(text); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  // Auto-fetch on mount
  useEffect(() => { fetchFile(); }, []);

  if (loading) return <div className="code-snippet-loading">Loading source…</div>;
  if (error) return <div className="code-snippet-error">⚠ {error}</div>;
  if (!fileContent) return null;

  const allLines = fileContent.split('\n');
  const start = Math.max(0, (startLine || 1) - 1);
  const end = Math.min(allLines.length, (endLine || startLine || 1));

  // Snippet: target lines + context
  const snippetStart = Math.max(0, start - CONTEXT_LINES);
  const snippetEnd = Math.min(allLines.length, end + CONTEXT_LINES);

  const displayStart = expanded ? 0 : snippetStart;
  const displayEnd = expanded ? allLines.length : snippetEnd;
  const displayLines = allLines.slice(displayStart, displayEnd);

  const gutterWidth = String(displayEnd).length;

  return (
    <div className="code-snippet">
      <div className="code-snippet-header">
        <span className="code-snippet-filename">
          {file}
          {commitSha && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>@ {commitSha.slice(0, 7)}</span>}
        </span>
        <button className="btn btn-sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? '↕ Collapse' : '↕ Full file'}
        </button>
      </div>
      <div className="code-snippet-body">
        {displayStart > 0 && (
          <div className="code-line code-line-ellipsis">
            <span className="code-gutter" style={{ width: `${gutterWidth}ch` }}>…</span>
            <span className="code-text"></span>
          </div>
        )}
        {displayLines.map((line, i) => {
          const lineNum = displayStart + i + 1;
          const isTarget = lineNum >= (startLine || 0) && lineNum <= (endLine || startLine || 0);
          return (
            <div key={lineNum} className={`code-line ${isTarget ? 'code-line-target' : ''}`}>
              <span className="code-gutter" style={{ width: `${gutterWidth}ch` }}>{lineNum}</span>
              <span className="code-text">{line || ' '}</span>
            </div>
          );
        })}
        {displayEnd < allLines.length && (
          <div className="code-line code-line-ellipsis">
            <span className="code-gutter" style={{ width: `${gutterWidth}ch` }}>…</span>
            <span className="code-text"></span>
          </div>
        )}
        {/* Inline comment marker on target region */}
        {!expanded && comment && (
          <div className="code-inline-comment">
            <span className="code-inline-comment-icon"><IconComment /></span>
            <span>{comment}</span>
          </div>
        )}
      </div>
    </div>
  );
}

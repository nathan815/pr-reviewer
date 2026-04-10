import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Diff,
  Hunk,
  parseDiff,
  tokenize,
  markEdits,
  textLinesToHunk,
} from 'react-diff-view';
import refractor from 'refractor';

const INITIAL_CONTEXT = 5;
const EXPAND_STEP = 10;
const FULL_DIFF_CONTEXT = 1000000;
const diffCache = new Map();

function splitLines(text = '') {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function detectLanguage(filePath = '') {
  const fileName = filePath.toLowerCase();
  const extension = fileName.includes('.') ? fileName.split('.').pop() : '';

  if (fileName.endsWith('.csproj') || fileName.endsWith('.props') || fileName.endsWith('.targets')) return 'xml';

  const byExtension = {
    cs: 'csharp',
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    ps1: 'powershell',
    sh: 'bash',
    sql: 'sql',
    xml: 'xml',
    html: 'markup',
    css: 'css',
    go: 'go',
    java: 'java',
  };

  return byExtension[extension] || null;
}

function getHunkNewRange(hunk) {
  const start = typeof hunk.newStart === 'number' ? hunk.newStart : 1;
  const lineCount = typeof hunk.newLines === 'number' ? hunk.newLines : 0;
  const end = lineCount > 0 ? start + lineCount - 1 : start;
  return { start, end };
}

function getChangeNewLineNumber(change) {
  if (typeof change?.newLineNumber === 'number') return change.newLineNumber;
  if (change?.isInsert && typeof change?.lineNumber === 'number') return change.lineNumber;
  return null;
}

function getChangeOldLineNumber(change) {
  if (typeof change?.oldLineNumber === 'number') return change.oldLineNumber;
  if (change?.isDelete && typeof change?.lineNumber === 'number') return change.lineNumber;
  return null;
}

function overlapsWindow(hunk, start, end) {
  const range = getHunkNewRange(hunk);
  return range.end >= start - 1 && range.start <= end + 1;
}

function getRenderedRange(hunks, fallbackStart, fallbackEnd) {
  if (!hunks.length) {
    return { start: fallbackStart, end: fallbackEnd };
  }

  let start = Number.POSITIVE_INFINITY;
  let end = 0;

  for (const hunk of hunks) {
    const range = getHunkNewRange(hunk);
    start = Math.min(start, range.start);
    end = Math.max(end, range.end);
  }

  if (!Number.isFinite(start) || end <= 0) {
    return { start: fallbackStart, end: fallbackEnd };
  }

  return { start, end };
}

function buildHunkHeader(oldStart, oldLines, newStart, newLines) {
  const oldCount = Math.max(0, oldLines);
  const newCount = Math.max(0, newLines);
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

function clipHunkToWindow(hunk, start, end) {
  const changes = hunk?.changes || [];
  if (!changes.length) return null;

  const includedIndices = changes
    .map((change, index) => {
      const newLineNumber = getChangeNewLineNumber(change);
      const matchesNew = typeof newLineNumber === 'number' && newLineNumber >= start && newLineNumber <= end;
      return matchesNew ? index : -1;
    })
    .filter(index => index >= 0);

  if (!includedIndices.length) return null;

  let sliceStart = includedIndices[0];
  let sliceEnd = includedIndices[includedIndices.length - 1];

  while (sliceStart > 0 && changes[sliceStart - 1]?.isDelete) {
    sliceStart -= 1;
  }
  while (sliceEnd < changes.length - 1 && changes[sliceEnd + 1]?.isDelete) {
    sliceEnd += 1;
  }

  const clippedChanges = changes.slice(sliceStart, sliceEnd + 1);
  const firstNewLine = clippedChanges.map(getChangeNewLineNumber).find(line => typeof line === 'number');
  const firstOldLine = clippedChanges.map(getChangeOldLineNumber).find(line => typeof line === 'number');
  const oldLines = clippedChanges.filter(change => getChangeOldLineNumber(change) !== null).length;
  const newLines = clippedChanges.filter(change => getChangeNewLineNumber(change) !== null).length;
  const oldStart = firstOldLine ?? hunk.oldStart;
  const newStart = firstNewLine ?? hunk.newStart;

  return {
    ...hunk,
    content: buildHunkHeader(oldStart, oldLines, newStart, newLines),
    oldStart,
    newStart,
    oldLines,
    newLines,
    changes: clippedChanges,
  };
}

function getDiffType(file) {
  if (!file?.type) return 'modify';
  return file.type;
}

async function readJsonIfPossible(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  return response.json();
}

function buildFallbackHunks(lines, start, end) {
  if (!lines.length) return [];
  const sliceStart = Math.max(1, start);
  const sliceEnd = Math.max(sliceStart, end);
  const hunk = textLinesToHunk(lines.slice(sliceStart - 1, sliceEnd), sliceStart, sliceStart);
  return hunk ? [hunk] : [];
}

function getRequestCacheKey(repo, prId, file, commitSha) {
  return [repo, prId, file, commitSha || '', 'full-diff'].join('::');
}

export default function CodeSnippet({ repo, prId, file, startLine, endLine, commitSha }) {
  const [diffData, setDiffData] = useState(null);
  const [showFullFile, setShowFullFile] = useState(false);
  const [expandUp, setExpandUp] = useState(INITIAL_CONTEXT);
  const [expandDown, setExpandDown] = useState(INITIAL_CONTEXT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    setShowFullFile(false);
    setExpandUp(INITIAL_CONTEXT);
    setExpandDown(INITIAL_CONTEXT);
  }, [repo, prId, file, commitSha]);

  const cacheKey = useMemo(
    () => getRequestCacheKey(repo, prId, file, commitSha),
    [repo, prId, file, commitSha]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDiff() {
      const cached = diffCache.get(cacheKey);
      if (cached) {
        setDiffData(cached);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

        try {
          const params = new URLSearchParams({ path: file });
          if (commitSha) params.set('commit', commitSha);
          params.set('context', String(FULL_DIFF_CONTEXT));

        const response = await fetch(`/api/reviews/${repo}/${prId}/file-diff?${params}`);
        const data = response.ok ? await readJsonIfPossible(response) : null;

        if (data) {
          diffCache.set(cacheKey, data);
          if (!cancelled) {
            setDiffData(data);
          }
          return;
        }

        const fileResponse = await fetch(`/api/reviews/${repo}/${prId}/file?${params}`);
        if (!fileResponse.ok) {
          throw new Error(fileResponse.status === 404 ? 'File not in worktree' : `HTTP ${fileResponse.status}`);
        }

        const fileText = await fileResponse.text();
        const fallbackData = {
          path: file,
          oldSource: fileText,
          newSource: fileText,
          diffText: '',
          baseUnavailable: true,
          fallbackReason: 'Inline diff is unavailable until the server is restarted. Showing file contents instead.',
        };
        if (!cancelled) {
          setDiffData(fallbackData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setDiffData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDiff();

    return () => {
      cancelled = true;
    };
  }, [repo, prId, file, commitSha, cacheKey]);

  const targetStart = startLine || 1;
  const targetEnd = endLine || startLine || targetStart;
  const language = useMemo(() => detectLanguage(file), [file]);
  const newLines = useMemo(() => splitLines(diffData?.newSource || ''), [diffData?.newSource]);

  const parsedFile = useMemo(() => {
    if (!diffData?.diffText) return null;
    try {
      return parseDiff(diffData.diffText, { nearbySequences: 'zip' })[0] || null;
    } catch {
      return null;
    }
  }, [diffData?.diffText]);

  const visibleStart = showFullFile ? 1 : Math.max(1, targetStart - expandUp);
  const visibleEnd = showFullFile
    ? Math.max(newLines.length, 1)
    : Math.min(Math.max(newLines.length, targetEnd), targetEnd + expandDown);

  const visibleHunks = useMemo(() => {
    if (!diffData) return [];
    const sourceHunks = parsedFile?.hunks || [];
    if (sourceHunks.length) {
      if (showFullFile) return sourceHunks;
      const focused = sourceHunks
        .filter(hunk => overlapsWindow(hunk, visibleStart, visibleEnd))
        .map(hunk => clipHunkToWindow(hunk, visibleStart, visibleEnd))
        .filter(Boolean);
      return focused.length ? focused : sourceHunks;
    }

    return buildFallbackHunks(
      newLines,
      showFullFile ? 1 : visibleStart,
      showFullFile ? newLines.length : visibleEnd
    );
  }, [diffData, newLines, parsedFile?.hunks, showFullFile, visibleStart, visibleEnd]);

  const renderedRange = useMemo(
    () => getRenderedRange(visibleHunks, visibleStart, visibleEnd),
    [visibleEnd, visibleHunks, visibleStart]
  );

  // Only tokenize (syntax highlight) when showing full file — clipped hunks
  // cause tokenize to misalign oldSource reconstruction with partial changes.
  const tokens = useMemo(() => {
    if (!showFullFile || !visibleHunks.length || !language) return null;

    try {
      return tokenize(visibleHunks, {
        highlight: true,
        language,
        refractor,
        oldSource: diffData?.oldSource || diffData?.newSource || '',
        enhancers: [markEdits(visibleHunks)],
      });
    } catch {
      return null;
    }
  }, [showFullFile, diffData?.newSource, diffData?.oldSource, language, visibleHunks]);

  const canExpandUp = !showFullFile && renderedRange.start > 1;
  const canExpandDown = !showFullFile && renderedRange.end < newLines.length;

  // Auto-scroll to target only on initial load and full-file toggle, not on expand
  const hasScrolledRef = useRef(false);
  const prevShowFullFileRef = useRef(showFullFile);

  useEffect(() => {
    // Reset scroll flag when toggling full file / focus region
    if (prevShowFullFileRef.current !== showFullFile) {
      hasScrolledRef.current = false;
      prevShowFullFileRef.current = showFullFile;
    }

    if (loading || !bodyRef.current || hasScrolledRef.current) return;

    const frame = requestAnimationFrame(() => {
      const container = bodyRef.current;
      const targetRow = container?.querySelector('.code-line-target');
      if (!container || !targetRow) return;

      const targetTop = targetRow.offsetTop;
      const offset = Math.max(0, targetTop - Math.floor(container.clientHeight / 3));
      container.scrollTop = offset;
      hasScrolledRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [loading, visibleHunks, showFullFile, targetStart, targetEnd]);

  if (loading) {
    return (
      <div className="code-snippet-loading">
        <span className="discuss-spinner code-snippet-loading-spinner" />
        <span>Loading code diff...</span>
      </div>
    );
  }
  if (error) return <div className="code-snippet-error">⚠ {error}</div>;
  if (!diffData) return null;

  return (
    <div className="code-snippet">
      <div className="code-snippet-header">
        <span className="code-snippet-filename">
          {file}
          {commitSha && <span className="code-snippet-sha">@ {commitSha.slice(0, 7)}</span>}
        </span>
        <div className="code-snippet-controls">
          <button className="btn btn-sm" onClick={() => setShowFullFile(value => !value)}>
            {showFullFile ? 'Focus region' : 'Full file'}
          </button>
        </div>
      </div>

      {(diffData.baseUnavailable || diffData.fallbackReason) && (
        <div className="code-snippet-note">
          {diffData.fallbackReason || 'Base branch diff unavailable; showing the current file region.'}
        </div>
      )}

      <div className="code-snippet-body" ref={bodyRef}>
        {canExpandUp && (
          <button className="diff-gutter-expand" title={`Show ${Math.min(EXPAND_STEP, renderedRange.start - 1)} more lines`} onClick={() => setExpandUp(value => value + EXPAND_STEP)}>
            ▴
          </button>
        )}
        <Diff
          viewType="unified"
          diffType={getDiffType(parsedFile)}
          hunks={visibleHunks}
          tokens={tokens}
          className="code-diff-view"
          generateLineClassName={({ changes, defaultGenerate }) => {
            const classes = [defaultGenerate()];
            if (changes.some(change => {
              const lineNumber = getChangeNewLineNumber(change);
              return lineNumber >= targetStart && lineNumber <= targetEnd;
            })) {
              classes.push('code-line-target');
            }
            return classes.filter(Boolean).join(' ');
          }}
        >
          {hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
        {canExpandDown && (
          <button className="diff-gutter-expand" title={`Show ${Math.min(EXPAND_STEP, newLines.length - renderedRange.end)} more lines`} onClick={() => setExpandDown(value => value + EXPAND_STEP)}>
            ▾
          </button>
        )}
      </div>
    </div>
  );
}

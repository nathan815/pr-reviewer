// SVG icon components — consistent 16px sizing to align with CSS spinners

const s = { width: 16, height: 16, verticalAlign: 'middle', flexShrink: 0 };

export function IconCheck(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export function IconX(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

export function IconStop(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" fill="rgba(248,81,73,0.15)" /><rect x="5.5" y="5.5" width="5" height="5" rx="0.5" fill="var(--red)" />
    </svg>
  );
}

export function IconBot(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="10" height="8" rx="2" /><circle cx="6" cy="9" r="1" fill="var(--accent)" /><circle cx="10" cy="9" r="1" fill="var(--accent)" /><line x1="8" y1="2" x2="8" y2="5" /><circle cx="8" cy="1.5" r="1" />
    </svg>
  );
}

export function IconSearch(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

export function IconSend(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l12 6-12 6V9.5L10 8 2 6.5z" />
    </svg>
  );
}

export function IconArrowUp(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13V3" /><polyline points="4.5 6.5 8 3 11.5 6.5" />
    </svg>
  );
}

export function IconArrowDown(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v10" /><polyline points="4.5 9.5 8 13 11.5 9.5" />
    </svg>
  );
}

export function IconNote(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" /><line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="7.5" x2="10.5" y2="7.5" /><line x1="5.5" y1="10" x2="8" y2="10" />
    </svg>
  );
}

export function IconBug(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--red)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="9.5" rx="3.5" ry="4" /><path d="M6 6c0-1.1.9-2 2-2s2 .9 2 2" /><line x1="1.5" y1="8" x2="4.5" y2="8" /><line x1="11.5" y1="8" x2="14.5" y2="8" /><line x1="2" y1="12" x2="4.5" y2="11" /><line x1="14" y1="12" x2="11.5" y2="11" /><line x1="3" y1="5" x2="5" y2="6.5" /><line x1="13" y1="5" x2="11" y2="6.5" />
    </svg>
  );
}

export function IconLock(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--orange)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  );
}

export function IconZap(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="var(--orange)" stroke="none">
      <path d="M9.5 1L4 9h4l-1.5 6L13 7H9l.5-6z" />
    </svg>
  );
}

export function IconPalette(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--purple)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" /><circle cx="6" cy="6" r="1" fill="var(--red)" /><circle cx="10" cy="6" r="1" fill="var(--green)" /><circle cx="5.5" cy="9.5" r="1" fill="var(--accent)" /><circle cx="10" cy="10" r="1.5" fill="var(--surface)" stroke="var(--purple)" />
    </svg>
  );
}

export function IconRuler(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="14" height="4" rx="1" transform="rotate(-45 8 8)" /><line x1="5" y1="7" x2="5" y2="9" transform="rotate(-45 8 8)" />
    </svg>
  );
}

export function IconTestTube(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v7.5l-2.5 3.5a1.5 1.5 0 001.2 2.4h6.6a1.5 1.5 0 001.2-2.4L10 9.5V2" /><line x1="5" y1="2" x2="11" y2="2" /><line x1="6" y1="9.5" x2="10" y2="9.5" />
    </svg>
  );
}

export function IconDocs(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" /><line x1="5.5" y1="5" x2="10.5" y2="5" /><line x1="5.5" y1="7.5" x2="10.5" y2="7.5" /><line x1="5.5" y1="10" x2="8" y2="10" />
    </svg>
  );
}

export function IconComment(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
    </svg>
  );
}

export function IconReset(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8a5 5 0 019.5-1.5M13 8a5 5 0 01-9.5 1.5" /><polyline points="3 3 3 6.5 6.5 6.5" /><polyline points="13 13 13 9.5 9.5 9.5" />
    </svg>
  );
}

export function IconClock(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--orange)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" /><polyline points="8 4.5 8 8 10.5 9.5" />
    </svg>
  );
}

export function IconRocket(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5c3 0 5.5 3.5 5.5 7s-2 4-5.5 4-5.5-.5-5.5-4 2.5-7 5.5-7z" /><circle cx="8" cy="7" r="1.5" fill="currentColor" /><path d="M5 12.5l-2 2M11 12.5l2 2" />
    </svg>
  );
}

export function IconChart(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="13" x2="4" y2="7" /><line x1="8" y1="13" x2="8" y2="3" /><line x1="12" y1="13" x2="12" y2="9" />
    </svg>
  );
}

export function IconBrain(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14V8M5.5 3.5a2.5 2.5 0 015 0M4 6a2 2 0 00-1 3.5M12 6a2 2 0 011 3.5M5 9.5c0 1.5 1.3 2.5 3 2.5s3-1 3-2.5" />
    </svg>
  );
}

export function IconTrash(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 4 4 14 12 14 13 4" /><line x1="2" y1="4" x2="14" y2="4" /><path d="M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4" /><line x1="6.5" y1="7" x2="6.5" y2="11" /><line x1="9.5" y1="7" x2="9.5" y2="11" />
    </svg>
  );
}

// File type icons — small colored circles/shapes
export function IconFile({ ext, ...props }) {
  const colors = {
    cs: '#9b4dca', ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e',
    fs: '#378bba', fsx: '#378bba', fsproj: '#378bba',
    py: '#3776ab', json: '#8b949e', md: '#8b949e', yaml: '#d29922', yml: '#d29922',
    xml: '#8b949e', css: '#563d7c', html: '#e34c26', ps1: '#012456', sh: '#89e051',
  };
  const c = colors[ext] || 'var(--text-muted)';
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" /><polyline points="9 2 9 6 13 6" />
      <circle cx="8" cy="10" r="1.5" fill={c} opacity="0.3" />
    </svg>
  );
}

export function IconFolder(props) {
  return (
    <svg {...s} {...props} viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h4l2 2h6v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
    </svg>
  );
}

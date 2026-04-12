export default function RiskBadge({ level, prefix }) {
  const l = (level || 'unknown').toLowerCase();
  return <span className={`badge badge-${l}`}>{prefix ? `${prefix} ${l}` : l}</span>;
}

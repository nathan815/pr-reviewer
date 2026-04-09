export default function RiskBadge({ level }) {
  const l = (level || 'unknown').toLowerCase();
  return <span className={`badge badge-${l}`}>{l}</span>;
}

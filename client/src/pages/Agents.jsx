import AgentStatusPanel from '../components/AgentStatusPanel';
import { IconBot } from '../components/Icons';

export default function Agents() {
  return (
    <>
      <div className="overview-section">
        <h1 style={{ fontSize: 22, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconBot style={{ width: 22, height: 22 }} /> All Agents
        </h1>
      </div>
      <AgentStatusPanel />
    </>
  );
}

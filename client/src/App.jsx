import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ReviewDetail from './pages/ReviewDetail';
import Learnings from './pages/Learnings';
import Settings from './pages/Settings';
import Agents from './pages/Agents';
import { IconSearch } from './components/Icons';

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="container">
          <h1><IconSearch style={{ width: 20, height: 20 }} /> PR Review Agent</h1>
          <nav style={{ display: 'flex', gap: 16 }}>
            <Link to="/">Dashboard</Link>
            <Link to="/agents">Agents</Link>
            <Link to="/learnings">Learnings</Link>
            <Link to="/settings">Settings</Link>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review/:repo/:prId" element={<ReviewDetail />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/learnings" element={<Learnings />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  );
}

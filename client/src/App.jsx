import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ReviewDetail from './pages/ReviewDetail';
import Learnings from './pages/Learnings';

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="container">
          <h1>🔍 PR Review Agent</h1>
          <nav style={{ display: 'flex', gap: 16 }}>
            <Link to="/">Dashboard</Link>
            <Link to="/learnings">📊 Learnings</Link>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review/:repo/:prId" element={<ReviewDetail />} />
          <Route path="/learnings" element={<Learnings />} />
        </Routes>
      </main>
    </>
  );
}

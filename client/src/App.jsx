import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ReviewDetail from './pages/ReviewDetail';

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="container">
          <h1>🔍 PR Review Agent</h1>
          <nav>
            <Link to="/">Dashboard</Link>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review/:repo/:prId" element={<ReviewDetail />} />
        </Routes>
      </main>
    </>
  );
}

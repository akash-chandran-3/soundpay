import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import TerminalPage from './pages/TerminalPage.jsx';
import PassengerPage from './pages/PassengerPage.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <strong>SoundPay</strong>
        <nav>
          <NavLink to="/terminal">Terminal</NavLink>
          <NavLink to="/passenger">Passenger</NavLink>
        </nav>
      </header>

      <p className="banner">Prototype – payments are simulated, no real money moves.</p>

      <Routes>
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/passenger" element={<PassengerPage />} />
        <Route path="*" element={<Navigate to="/terminal" replace />} />
      </Routes>
    </div>
  );
}

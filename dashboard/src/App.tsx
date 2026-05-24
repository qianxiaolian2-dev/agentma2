import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Playground from './pages/Playground';
import Agents from './pages/Agents';
import AgentChat from './pages/AgentChat';
import Conversations from './pages/Conversations';
import Sessions from './pages/Sessions';
import Tools from './pages/Tools';
import Hooks from './pages/Hooks';
import Skills from './pages/Skills';
import Subagents from './pages/Subagents';
import Permissions from './pages/Permissions';
import Observability from './pages/Observability';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/playground" element={<Playground />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:id/chat" element={<AgentChat />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/hooks" element={<Hooks />} />
        <Route path="/subagents" element={<Subagents />} />
        <Route path="/permissions" element={<Permissions />} />
        <Route path="/observability" element={<Observability />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

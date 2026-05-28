import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { StyleManage } from '@/pages/StyleManage';
import { StudioTryOn } from '@/pages/StudioTryOn';
import { DetailCanvas } from '@/pages/DetailCanvas';
import { SettingsPage } from '@/pages/SettingsPage';
import { GeneralStudio } from '@/pages/GeneralStudio';
import { TaskHistoryPage } from '@/pages/TaskHistoryPage';
import { PromptTemplatesPage } from '@/pages/PromptTemplatesPage';
import { BatchGenerate } from '@/pages/BatchGenerate';
import { InfiniteCanvas } from '@/pages/InfiniteCanvas';
import { ModelLibrary } from '@/pages/ModelLibrary';
import { TemplateLibrary } from '@/pages/TemplateLibrary';
import { PoseGenerate } from '@/pages/PoseGenerate';
import { DetailGenerate } from '@/pages/DetailGenerate';
import { ToastContainer } from '@/components/Toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useThemeStore } from '@/store/useThemeStore';
import { useEffect } from 'react';

export default function App() {
  const current = useThemeStore((s) => s.current);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  useEffect(() => { applyTheme(current); }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/infinite-canvas" element={<InfiniteCanvas />} />
          <Route path="*" element={
            <Layout>
              <Routes>
                <Route path="/" element={<StudioTryOn />} />
                <Route path="/styles" element={<StyleManage />} />
                <Route path="/batch" element={<BatchGenerate />} />
                <Route path="/canvas" element={<DetailCanvas />} />
                <Route path="/general" element={<GeneralStudio />} />
                <Route path="/history" element={<TaskHistoryPage />} />
                <Route path="/prompts" element={<PromptTemplatesPage />} />
                <Route path="/models" element={<ModelLibrary />} />
                <Route path="/templates" element={<TemplateLibrary />} />
                <Route path="/pose" element={<PoseGenerate />} />
                <Route path="/detail-gen" element={<DetailGenerate />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </Layout>
          } />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

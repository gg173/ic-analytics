import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import AnalyticsPage from './pages/AnalyticsPage';
import { AuthProvider } from './homecare/hooks/useAuth';
import { HomecareLayout } from './pages/HomecareLayout';
import { LoginPage } from './pages/LoginPage';
import { ProtectedHomecareRoute } from './pages/ProtectedHomecareRoute';
import { ProtectedModuleRoute } from './pages/ProtectedModuleRoute';
import { HomecareBatchesPage } from './pages/HomecareBatchesPage';
import { HomecareWorkstationPage } from './pages/HomecareWorkstationPage';
import { HomecareAdminPage } from './pages/HomecareAdminPage';
import { EpicConversionPage } from './pages/EpicConversionPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomecareLayout />}>
            <Route index element={<LoginPage />} />
            <Route element={<ProtectedHomecareRoute />}>
              <Route element={<ProtectedModuleRoute module="analytics" />}>
                <Route path="analytics" element={<AnalyticsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="/homecare" element={<HomecareLayout />}>
            <Route path="login" element={<Navigate to="/" replace />} />
            <Route element={<ProtectedHomecareRoute />}>
              <Route element={<ProtectedModuleRoute module="homecare" />}>
                <Route index element={<HomecareBatchesPage />} />
                <Route path="batches/:batchId" element={<HomecareWorkstationPage />} />
                <Route path="admin" element={<HomecareAdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="/epic-conversion" element={<HomecareLayout />}>
            <Route element={<ProtectedHomecareRoute />}>
              <Route element={<ProtectedModuleRoute module="epic" />}>
                <Route index element={<EpicConversionPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);

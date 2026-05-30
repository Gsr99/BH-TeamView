import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';

// Pages
import Login from './pages/Login';
import AdminDashboard from './pages/admin/AdminDashboard';
import ManagerDashboard from './pages/manager/ManagerDashboard';
import CashBalance from './pages/manager/CashBalance';
import DailySummary from './pages/manager/DailySummary';
import BillsList from './pages/bills/BillsList';
import AddBill from './pages/bills/AddBill';
import EditBill from './pages/bills/EditBill';
import ExpensesList from './pages/expenses/ExpensesList';
import AddExpense from './pages/expenses/AddExpense';
import EditExpense from './pages/expenses/EditExpense';
import Reports from './pages/reports/Reports';
import OnlineDelivery from './pages/manager/OnlineDelivery';
import Managers from './pages/admin/Managers';
import Backup from './pages/admin/Backup';

// Root redirect based on role
function RootRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 text-sm">Loading...</div>
    </div>
  );
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role === 'admin') return <Navigate to="/dashboard" replace />;
  return <Navigate to="/manager-dashboard" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Root → role-based redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* Admin */}
          <Route path="/dashboard" element={
            <ProtectedRoute adminOnly>
              <AdminDashboard />
            </ProtectedRoute>
          } />

          {/* Manager */}
          <Route path="/manager-dashboard" element={
            <ProtectedRoute>
              <ManagerDashboard />
            </ProtectedRoute>
          } />

          {/* Shared — both roles */}
          <Route path="/bills" element={
            <ProtectedRoute>
              <BillsList />
            </ProtectedRoute>
          } />
          <Route path="/bills/add" element={
            <ProtectedRoute>
              <AddBill />
            </ProtectedRoute>
          } />
          <Route path="/bills/:id/edit" element={
            <ProtectedRoute adminOnly>
              <EditBill />
            </ProtectedRoute>
          } />
          <Route path="/expenses" element={
            <ProtectedRoute>
              <ExpensesList />
            </ProtectedRoute>
          } />
          <Route path="/expenses/add" element={
            <ProtectedRoute>
              <AddExpense />
            </ProtectedRoute>
          } />
          <Route path="/expenses/:id/edit" element={
            <ProtectedRoute adminOnly>
              <EditExpense />
            </ProtectedRoute>
          } />
          <Route path="/cash-balance" element={
            <ProtectedRoute>
              <CashBalance />
            </ProtectedRoute>
          } />
          <Route path="/daily-summary" element={
            <ProtectedRoute>
              <DailySummary />
            </ProtectedRoute>
          } />
          <Route path="/reports" element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          } />
          <Route path="/online-delivery" element={
            <ProtectedRoute>
              <OnlineDelivery />
            </ProtectedRoute>
          } />

          <Route path="/managers" element={
            <ProtectedRoute adminOnly>
              <Managers />
            </ProtectedRoute>
          } />
          <Route path="/backup" element={
            <ProtectedRoute adminOnly>
              <Backup />
            </ProtectedRoute>
          } />

          {/* Catch all */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
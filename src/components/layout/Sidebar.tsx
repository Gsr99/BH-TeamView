import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  managerOnly?: boolean;
  dividerBefore?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  // Admin dashboard
  {
    path: '/dashboard',
    label: 'Admin Dashboard',
    icon: '🏠',
    adminOnly: true,
  },
  // Manager dashboard
  {
    path: '/manager-dashboard',
    label: 'My Dashboard',
    icon: '🏠',
    managerOnly: true,
  },

  // Bills section
  {
    path: '/bills',
    label: 'Bills',
    icon: '🧾',
    dividerBefore: true,
  },
  {
    path: '/bills/add',
    label: 'Add Bill',
    icon: '➕',
  },

  // Expenses section
  {
    path: '/expenses',
    label: 'Expenses',
    icon: '💸',
    dividerBefore: true,
  },
  {
    path: '/expenses/add',
    label: 'Add Expense',
    icon: '➕',
  },

  // Cash
  {
    path: '/cash-balance',
    label: 'Cash Balance',
    icon: '💰',
    dividerBefore: true,
  },
  {
    path: '/daily-summary',
    label: 'Daily Summary',
    icon: '📈',
  },
  {
    path: '/online-delivery',
    label: 'Online Delivery',
    icon: '🚀',
  },

  {
    path: '/reports',
    label: 'Reports',
    icon: '📊',
    dividerBefore: true,
  },
  {
    path: '/managers',
    label: 'Manage Users',
    icon: '👥',
    adminOnly: true,
  },
  {
    path: '/backup',
    label: 'Backup',
    icon: '💾',
    adminOnly: true,
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.managerOnly && isAdmin) return false;
    return true;
  });

  return (
    <>
      {/* Mobile dark overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-gray-900 text-white z-30
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:z-auto
        `}
      >
        {/* App name */}
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white leading-tight">
              Website Manager
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Cash Flow Tracker</p>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden text-gray-400 hover:text-white text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0 uppercase">
              {profile?.full_name?.charAt(0) || '?'}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate leading-tight">
                {profile?.full_name || 'User'}
              </p>
              <span className={`
                inline-block text-xs px-1.5 py-0.5 rounded mt-0.5 font-medium capitalize
                ${isAdmin
                  ? 'bg-yellow-500 text-yellow-900'
                  : 'bg-blue-700 text-blue-100'
                }
              `}>
                {profile?.role || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {visibleItems.map((item, index) => (
            <div key={item.path}>
              {/* Optional divider */}
              {item.dividerBefore && index !== 0 && (
                <div className="border-t border-gray-700 my-2" />
              )}
              <NavLink
                to={item.path}
                onClick={onClose}
                end={item.path === '/dashboard' || item.path === '/manager-dashboard'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5
                  ${isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <span className="text-base w-5 text-center flex-shrink-0">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-3 border-t border-gray-700">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-red-600 hover:text-white transition-colors"
          >
            <span className="text-base w-5 text-center flex-shrink-0">🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
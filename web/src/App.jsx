import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import ProjectEdit from './pages/ProjectEdit'
import ProjectList from './pages/ProjectList'
import ProjectQuickCreate from './pages/ProjectQuickCreate'
import ReportList from './pages/ReportList'
import ScheduleEdit from './pages/ScheduleEdit'
import ScheduleList from './pages/ScheduleList'
import TemplateEdit from './pages/TemplateEdit'
import TemplateList from './pages/TemplateList'

const NAV_ITEMS = [
  { path: '/projects',  label: '巡检项目' },
  { path: '/templates', label: '模板管理' },
  { path: '/schedules', label: '定时任务' },
  { path: '/reports',   label: '巡检报告' },
]

function NavBar() {
  const location = useLocation()
  return (
    <nav className="bg-gray-900 text-white px-6 h-14 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        {/* 雷达扫描图标 */}
        <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
        </svg>
        <span className="font-semibold text-white tracking-wide">dm-inspect</span>
        <span className="text-gray-500 text-sm ml-1">巡检系统</span>
      </div>
      <div className="flex items-center h-full">
        {NAV_ITEMS.map(item => {
          const active = location.pathname.startsWith(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center h-full px-4 text-sm font-medium border-b-2 transition-colors
                ${active
                  ? 'border-blue-400 text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="min-h-screen bg-gray-50 flex flex-col">
          <NavBar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/projects" replace />} />
              <Route path="/projects" element={<ProjectList />} />
              <Route path="/projects/quick-new" element={<ProjectQuickCreate />} />
              <Route path="/projects/new" element={<ProjectEdit />} />
              <Route path="/projects/:id/edit" element={<ProjectEdit />} />
              <Route path="/templates" element={<TemplateList />} />
              <Route path="/templates/new" element={<TemplateEdit />} />
              <Route path="/templates/:id/edit" element={<TemplateEdit />} />
              <Route path="/reports" element={<ReportList />} />
              <Route path="/schedules" element={<ScheduleList />} />
              <Route path="/schedules/new" element={<ScheduleEdit />} />
              <Route path="/schedules/:id/edit" element={<ScheduleEdit />} />
              <Route path="*" element={
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <p className="text-4xl font-bold mb-2">404</p>
                  <p>页面未找到</p>
                </div>
              } />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  )
}

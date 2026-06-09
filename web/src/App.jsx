import { useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Menu, Sun, Moon } from 'lucide-react'
import { ToastProvider } from './components/Toast'
import { useTheme } from './components/ThemeProvider'
import { Sheet, SheetContent, SheetTrigger } from './components/ui/sheet'
import { Separator } from './components/ui/separator'
import Home from './pages/Home'
import ProjectEdit from './pages/ProjectEdit'
import ProjectList from './pages/ProjectList'
import ProjectQuickCreate from './pages/ProjectQuickCreate'
import ReportList from './pages/ReportList'
import ScheduleEdit from './pages/ScheduleEdit'
import ScheduleList from './pages/ScheduleList'
import NotificationConfigList from './pages/NotificationConfigList'
import TemplateEdit from './pages/TemplateEdit'
import TemplateList from './pages/TemplateList'

const NAV_ITEMS = [
  { path: '/',          label: '首页' },
  { path: '/projects',  label: '巡检项目' },
  { path: '/templates', label: '模板管理' },
  { path: '/schedules', label: '定时任务' },
  { path: '/notifications', label: '通知配置' },
  { path: '/reports',   label: '巡检报告' },
]

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-full text-ds-muted hover:text-ds-text hover:bg-ds-surface2 transition-colors"
      title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
    >
      {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  )
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <svg className="w-6 h-6 text-ds-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
      <span className="font-semibold text-ds-text tracking-tight-apple font-heading">dm-inspect</span>
      <span className="text-ds-muted text-sm ml-1 hidden sm:inline font-body">巡检系统</span>
    </Link>
  )
}

function isActive(location, path) {
  // 首页使用精确匹配，避免在其他页面被误高亮
  if (path === '/') return location.pathname === '/'
  return location.pathname.startsWith(path)
}

function NavLink({ item, className, onClick }) {
  const location = useLocation()
  const active = isActive(location, item.path)
  return (
    <Link
      key={item.path}
      to={item.path}
      onClick={onClick}
      className={`text-sm font-medium transition-colors cursor-pointer ${className} ${
        active ? 'text-ds-accent' : 'text-ds-muted hover:text-ds-text'
      }`}
    >
      {item.label}
    </Link>
  )
}

function DesktopNav() {
  const location = useLocation()
  return (
    <div className="hidden md:flex items-center h-full">
      {NAV_ITEMS.map(item => {
        const active = isActive(location, item.path)
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center h-full px-4 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              active
                ? 'border-ds-accent text-ds-text'
                : 'border-transparent text-ds-muted hover:text-ds-text hover:border-ds-border'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

function MobileNav() {
  const [open, setOpen] = useState(false)
  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button className="p-2 text-ds-muted hover:text-ds-text transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="bg-ds-surface border-ds-border w-[280px]">
          <div className="flex flex-col gap-6 mt-6">
            <Logo />
            <Separator className="bg-ds-border" />
            <nav className="flex flex-col gap-4">
              {NAV_ITEMS.map(item => (
                <NavLink
                  key={item.path}
                  item={item}
                  onClick={() => setOpen(false)}
                  className="flex items-center py-2"
                />
              ))}
            </nav>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function NavBar() {
  return (
    <nav className="bg-ds-surface text-ds-text px-4 sm:px-6 h-14 flex items-center justify-between shrink-0 border-b border-ds-border sticky top-0 z-40 backdrop-blur-xl bg-opacity-80">
      <Logo />
      <div className="flex items-center gap-2">
        <DesktopNav />
        <div className="hidden md:block w-px h-6 bg-ds-border mx-2" />
        <ThemeToggle />
        <MobileNav />
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="min-h-screen bg-ds-bg flex flex-col">
          <NavBar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <Routes>
              <Route path="/" element={<Home />} />
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
              <Route path="/notifications" element={<NotificationConfigList />} />
              <Route path="*" element={
                <div className="flex flex-col items-center justify-center h-64 text-ds-muted">
                  <p className="text-4xl font-bold mb-2 tracking-tight-apple">404</p>
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

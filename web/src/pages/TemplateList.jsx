import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function TemplateList() {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)

  useEffect(() => {
    api.get('/templates')
      .then(data => setTemplates(data || []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id) => {
    try {
      await api.del(`/templates/${id}`)
      setTemplates(prev => prev.filter(t => t.id !== id))
      toast.success('模板已删除')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setConfirmId(null)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ds-text">模板管理</h1>
          <p className="text-sm text-ds-muted mt-0.5">
            管理巡检指标模板，模板被项目引用后不可删除
          </p>
        </div>
        <Button asChild className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text">
          <Link to="/templates/new" className="inline-flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            创建模板
          </Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          title="暂无模板"
          description="模板定义了巡检的指标和查询规则，先创建一个模板"
          action={
            <Button asChild className="bg-ds-accent hover:bg-ds-accent-hover text-ds-text">
              <Link to="/templates/new">创建第一个模板</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block bg-ds-surface rounded-xl border border-ds-border overflow-hidden">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ds-border bg-ds-surface2">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider w-16">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">模板名称</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ds-muted uppercase tracking-wider">创建时间</th>
                  <th className="px-4 py-3 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {templates.map(t => (
                  <tr key={t.id} className="hover:bg-ds-surface2 transition-colors">
                    <td className="px-4 py-3 text-ds-muted">{t.id}</td>
                    <td className="px-4 py-3 font-medium text-ds-text">{t.name}</td>
                    <td className="px-4 py-3 text-ds-muted">
                      {new Date(t.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild
                          className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-7 px-2"
                        >
                          <Link to={`/templates/${t.id}/edit`}>编辑</Link>
                        </Button>
                        {confirmId === t.id ? (
                          <span className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(t.id)}
                              className="h-7 px-2 text-xs"
                            >
                              确认
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmId(null)}
                              className="h-7 px-2 text-xs"
                            >
                              取消
                            </Button>
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmId(t.id)}
                            className="text-red-400 hover:text-red-400 hover:bg-red-500/10 h-7 px-2"
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <div className="md:hidden space-y-3">
            {templates.map(t => (
              <Card key={t.id} className="bg-ds-surface border-ds-border">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base text-ds-text">{t.name}</CardTitle>
                  <CardDescription className="text-xs text-ds-muted">
                    ID: {t.id} · {new Date(t.created_at).toLocaleString('zh-CN')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 flex gap-2">
                  <Button variant="ghost" size="sm" asChild
                    className="text-ds-accent hover:text-ds-accent hover:bg-ds-accent/10 h-7 px-2"
                  >
                    <Link to={`/templates/${t.id}/edit`}>编辑</Link>
                  </Button>
                  {confirmId === t.id ? (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(t.id)}
                        className="h-7 px-2 text-xs"
                      >
                        确认
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmId(null)}
                        className="h-7 px-2 text-xs"
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmId(t.id)}
                      className="text-red-400 hover:text-red-400 hover:bg-red-500/10 h-7 px-2"
                    >
                      删除
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

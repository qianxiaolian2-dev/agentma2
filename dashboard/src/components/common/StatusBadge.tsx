type StatusType = 'connected' | 'failed' | 'disabled' | 'pending' | 'needs-auth' | 'success' | 'warning' | 'error' | 'info';

const STATUS_MAP: Record<StatusType, { className: string; label: string }> = {
  connected: { className: 'badge-success', label: '已连接' },
  failed: { className: 'badge-danger', label: '失败' },
  disabled: { className: 'badge-muted', label: '已禁用' },
  pending: { className: 'badge-warning', label: '等待中' },
  'needs-auth': { className: 'badge-info', label: '需认证' },
  success: { className: 'badge-success', label: '成功' },
  warning: { className: 'badge-warning', label: '警告' },
  error: { className: 'badge-danger', label: '错误' },
  info: { className: 'badge-info', label: '信息' },
};

export default function StatusBadge({ status, label }: { status: StatusType; label?: string }) {
  const config = STATUS_MAP[status] || STATUS_MAP.info;
  return <span className={`badge ${config.className}`}>{label || config.label}</span>;
}

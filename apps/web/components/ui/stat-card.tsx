import type { ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface StatCardProps {
  label: string;
  /** A node, so a caller can hand it an animated number (delight #1). */
  value: ReactNode;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
}

export function StatCard({ label, value, change, changeType = 'neutral', icon: Icon }: StatCardProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50">
          <Icon className="h-6 w-6 text-brand-600" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
          {change && (
            <p
              className={clsx(
                'text-xs font-medium',
                changeType === 'positive' && 'text-green-600',
                changeType === 'negative' && 'text-red-600',
                changeType === 'neutral' && 'text-gray-500',
              )}
            >
              {change}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

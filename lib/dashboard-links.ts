export type UserRole = 'admin' | 'owner'

export type DashboardLink = {
  title: string
  href: string
  description: string
  roles: UserRole[]
}

export const dashboardLinks: DashboardLink[] = [
  {
    title: 'Auction',
    href: '/admin/auction',
    description: 'Run and manage the live auction',
    roles: ['admin'],
  },
  {
    title: 'Live Screen',
    href: '/admin/live',
    description: 'Display screen for projector or shared monitor',
    roles: ['admin'],
  },
  {
    title: 'Leaderboard',
    href: '/admin/leaderboard',
    description: 'See team standings, budgets, squad progress, and exports',
    roles: ['admin'],
  },
  {
    title: 'Auction History',
    href: '/admin/history',
    description: 'See sold, reopened, and unsold activity with filters and export',
    roles: ['admin'],
  },
  {
    title: 'Registered Players',
    href: '/players',
    description: 'View all registered players including unsold status',
    roles: ['admin'],
  },
]

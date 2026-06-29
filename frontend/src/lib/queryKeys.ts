export const queryKeys = {
  // Auth
  me: ['me'] as const,

  // Customers
  customers: {
    all: ['customers'] as const,
    list: (params?: Record<string, unknown>) => ['customers', 'list', params] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    jobs: (id: string) => ['customers', id, 'jobs'] as const,
    estimates: (id: string) => ['customers', id, 'estimates'] as const,
    invoices: (id: string) => ['customers', id, 'invoices'] as const,
    equipment: (id: string) => ['customers', id, 'equipment'] as const,
    agreements: (id: string) => ['customers', id, 'agreements'] as const,
  },

  // Jobs
  jobs: {
    all: ['jobs'] as const,
    list: (params?: Record<string, unknown>) => ['jobs', 'list', params] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    byDate: (date: string) => ['jobs', 'byDate', date] as const,
  },

  // Technicians
  technicians: {
    all: ['technicians'] as const,
    list: (params?: Record<string, unknown>) => ['technicians', 'list', params] as const,
    detail: (id: string) => ['technicians', 'detail', id] as const,
  },

  // Estimates
  estimates: {
    all: ['estimates'] as const,
    list: (params?: Record<string, unknown>) => ['estimates', 'list', params] as const,
    detail: (id: string) => ['estimates', 'detail', id] as const,
  },

  // Invoices
  invoices: {
    all: ['invoices'] as const,
    list: (params?: Record<string, unknown>) => ['invoices', 'list', params] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
  },

  // Payments
  payments: {
    all: ['payments'] as const,
    list: (params?: Record<string, unknown>) => ['payments', 'list', params] as const,
  },

  // Pricebook
  pricebook: {
    categories: ['pricebook', 'categories'] as const,
    items: (params?: Record<string, unknown>) => ['pricebook', 'items', params] as const,
  },

  // Inventory
  inventory: {
    warehouses: ['inventory', 'warehouses'] as const,
    items: (params?: Record<string, unknown>) => ['inventory', 'items', params] as const,
    transactions: (itemId: string) => ['inventory', 'transactions', itemId] as const,
  },

  // Agreements
  agreements: {
    all: ['agreements'] as const,
    list: (params?: Record<string, unknown>) => ['agreements', 'list', params] as const,
    detail: (id: string) => ['agreements', 'detail', id] as const,
  },

  // Reports
  reports: {
    revenue: (params?: Record<string, unknown>) => ['reports', 'revenue', params] as const,
    jobs: (params?: Record<string, unknown>) => ['reports', 'jobs', params] as const,
    technicians: (params?: Record<string, unknown>) => ['reports', 'technicians', params] as const,
    customers: (params?: Record<string, unknown>) => ['reports', 'customers', params] as const,
    dashboard: ['reports', 'dashboard'] as const,
  },

  // Marketing
  campaigns: {
    list: (params?: Record<string, unknown>) => ['campaigns', 'list', params] as const,
  },
  calls: {
    list: (params?: Record<string, unknown>) => ['calls', 'list', params] as const,
  },

  // Settings
  settings: ['settings'] as const,
  businessUnits: ['business-units'] as const,
  users: {
    list: ['users', 'list'] as const,
  },
} as const;

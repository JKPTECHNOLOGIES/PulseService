export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Location {
  id: string;
  customerId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat?: number;
  lng?: number;
  type: string;
  isPrimary: boolean;
}

export interface Contact {
  id: string;
  customerId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary: boolean;
}

export interface Customer {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  type: "residential" | "commercial";
  companyName?: string;
  notes?: string;
  balance: number;
  isActive: boolean;
  createdAt: string;
  locations?: Location[];
  jobs?: Job[];
}

export interface Technician {
  id: string;
  userId: string;
  employeeId: string;
  skills: string[];
  isAvailable: boolean;
  user: User;
}

export interface JobTechnician {
  id: string;
  jobId: string;
  technicianId: string;
  isLead: boolean;
  status: string;
  technician?: Technician;
}

export interface Job {
  id: string;
  jobNumber: string;
  customerId: string;
  locationId?: string;
  type: string;
  status: string;
  priority: string;
  summary: string;
  description?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  notes?: string;
  techNotes?: string;
  totalAmount: number;
  createdAt: string;
  customer?: Customer;
  location?: Location;
  technicians?: JobTechnician[];
}

export interface EstimateLineItem {
  id?: string;
  estimateId?: string;
  type: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

export interface Estimate {
  id: string;
  estimateNumber: string;
  customerId: string;
  jobId?: string;
  status: string;
  title: string;
  summary?: string;
  validUntil?: string;
  subtotal: number;
  discountType?: string;
  discountValue?: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string;
  terms?: string;
  sentAt?: string;
  approvedAt?: string;
  createdAt: string;
  customer?: Customer;
  lineItems?: EstimateLineItem[];
}

export interface InvoiceLineItem {
  id?: string;
  invoiceId?: string;
  type: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  method: string;
  status: string;
  referenceNumber?: string;
  notes?: string;
  paidAt: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  jobId?: string;
  estimateId?: string;
  status: string;
  dueDate?: string;
  subtotal: number;
  discountType?: string;
  discountValue?: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balance: number;
  notes?: string;
  terms?: string;
  sentAt?: string;
  paidAt?: string;
  createdAt: string;
  customer?: Customer;
  lineItems?: InvoiceLineItem[];
  payments?: Payment[];
}

export interface PricebookItem {
  id: string;
  categoryId: string;
  sku: string;
  name: string;
  description?: string;
  type: string;
  unitCost: number;
  unitPrice: number;
  unit: string;
  taxable: boolean;
  isActive: boolean;
}

export interface PricebookCategory {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  isActive: boolean;
  items?: PricebookItem[];
}

export interface InventoryItem {
  id: string;
  warehouseId: string;
  pricebookItemId?: string;
  name: string;
  sku: string;
  quantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  unitCost: number;
  location?: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  type: string;
  quantity: number;
  unitCost: number;
  reference?: string;
  jobId?: string;
  notes?: string;
  createdAt: string;
}

export interface AgreementVisit {
  id: string;
  agreementId: string;
  name: string;
  scheduledDate?: string;
  completedDate?: string;
  jobId?: string;
  status: string;
}

export interface ServiceAgreement {
  id: string;
  agreementNumber: string;
  customerId: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  billingFrequency: string;
  amount: number;
  autoRenew: boolean;
  nextBillingDate?: string;
  customer?: Customer;
  visits?: AgreementVisit[];
}

export interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  trackingNumber?: string;
}

export interface Call {
  id: string;
  customerId?: string;
  direction: string;
  status: string;
  fromNumber: string;
  toNumber: string;
  duration?: number;
  reason?: string;
  campaignId?: string;
  notes?: string;
  createdAt: string;
  customer?: Customer;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface CompanySettings {
  id: string;
  name: string;
  logo?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxRate: number;
  currency: string;
  timezone: string;
}

export interface BusinessUnit {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

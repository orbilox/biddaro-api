import { Request } from 'express';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: string[];
}

// ─── Job Filters ──────────────────────────────────────────────────────────────

export interface JobFilters {
  category?: string;
  status?: string;
  location?: string;
  minBudget?: number;
  maxBudget?: number;
  search?: string;
  posterId?: string;
  sortBy?: 'createdAt' | 'budget' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

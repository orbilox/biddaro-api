import { Request } from 'express';
import { config } from '../config';
import type { PaginationParams, PaginatedResult } from '../types';

export function getPagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    config.pagination.maxPageSize,
    Math.max(1, parseInt(req.query.limit as string) || config.pagination.defaultPageSize)
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  pagination: PaginationParams
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / pagination.limit);
  return {
    data,
    pagination: {
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
  };
}

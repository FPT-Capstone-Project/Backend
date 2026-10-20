const rentalModel = require('../models/rental.model');
const AppError = require('../utils/app-error');

const RENTAL_STATUSES = ['CONFIRMED', 'PREPARING', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseStatus(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  const status = String(value).trim().toUpperCase();
  if (!RENTAL_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${RENTAL_STATUSES.join(', ')}`, 400);
  }
  return status;
}

function parseTimestamp(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(`${fieldName} must be a valid timestamp`, 400);
  }
  const datePart = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (datePart) {
    const [year, month, day] = datePart.slice(1).map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year
      || calendarDate.getUTCMonth() !== month - 1
      || calendarDate.getUTCDate() !== day) {
      throw new AppError(`${fieldName} must be a valid timestamp`, 400);
    }
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new AppError(`${fieldName} must be a valid timestamp`, 400);
  }
  return timestamp.toISOString();
}

function parseOptionalTimestamp(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseTimestamp(value, fieldName);
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parsePagination(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) {
    throw new AppError('page must be a positive integer', 400);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`, 400);
  }
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

async function getAllRentalsForAdmin(query = {}) {
  const pagination = parsePagination(query);
  const filters = {
    status: parseStatus(query.status),
    userId: query.userId === undefined || String(query.userId).trim() === ''
      ? undefined
      : parseId(query.userId, 'userId'),
    packageId: query.packageId === undefined || String(query.packageId).trim() === ''
      ? undefined
      : parseId(query.packageId, 'packageId'),
    trayId: query.trayId === undefined || String(query.trayId).trim() === ''
      ? undefined
      : parseId(query.trayId, 'trayId'),
    startDateFrom: parseOptionalTimestamp(query.startDateFrom, 'startDateFrom'),
    startDateTo: parseOptionalTimestamp(query.startDateTo, 'startDateTo'),
    limit: pagination.limit,
    offset: pagination.offset,
  };
  if (filters.startDateFrom && filters.startDateTo
    && new Date(filters.startDateFrom) > new Date(filters.startDateTo)) {
    throw new AppError('startDateFrom must be on or before startDateTo', 400);
  }

  const result = await rentalModel.findAllForAdmin(filters);
  return {
    rentals: result.rentals,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

async function getRentalByIdForAdmin(rentalId) {
  const id = parseId(rentalId, 'rentalId');
  const rental = await rentalModel.findByIdForAdmin(id);
  if (!rental) throw new AppError('Rental not found', 404);
  return rental;
}

async function createRentalFromOrderForAdmin(orderId) {
  const id = parseId(orderId, 'orderId');
  const result = await rentalModel.createFromOrderForAdmin(id);
  const rental = await rentalModel.findByIdForAdmin(result.rentalId);
  if (!rental) throw new AppError('Rental not found after creation', 500);
  return { rental, created: result.created };
}

async function updateRentalForAdmin(rentalId, payload = {}) {
  const id = parseId(rentalId, 'rentalId');
  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError('No update data provided', 400);
  }

  const changes = {};
  if (payload.status !== undefined) {
    const status = parseStatus(payload.status);
    if (!status) throw new AppError('status is required', 400);
    changes.status = status;
  }
  if (payload.trayId !== undefined || payload.tray_id !== undefined) {
    const trayId = payload.trayId !== undefined ? payload.trayId : payload.tray_id;
    changes.trayId = trayId === null || trayId === '' ? null : parseId(trayId, 'trayId');
  }
  if (payload.durationDays !== undefined || payload.duration_days !== undefined) {
    const durationDays = payload.durationDays !== undefined
      ? payload.durationDays
      : payload.duration_days;
    changes.durationDays = parsePositiveInteger(durationDays, 'durationDays');
  }
  if (payload.startDate !== undefined || payload.start_date !== undefined) {
    const startDate = payload.startDate !== undefined ? payload.startDate : payload.start_date;
    changes.startDate = parseOptionalTimestamp(startDate, 'startDate');
  }
  if (payload.endDate !== undefined || payload.end_date !== undefined) {
    const endDate = payload.endDate !== undefined ? payload.endDate : payload.end_date;
    changes.endDate = parseOptionalTimestamp(endDate, 'endDate');
  }
  if (Object.keys(changes).length === 0) {
    throw new AppError('No valid fields provided for update', 400);
  }
  if (changes.startDate && changes.endDate
    && new Date(changes.endDate) <= new Date(changes.startDate)) {
    throw new AppError('endDate must be after startDate', 400);
  }

  return rentalModel.updateForAdmin(id, changes);
}

module.exports = {
  getAllRentalsForAdmin,
  getRentalByIdForAdmin,
  createRentalFromOrderForAdmin,
  updateRentalForAdmin,
};
